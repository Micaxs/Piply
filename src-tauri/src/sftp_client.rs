use anyhow::{anyhow, Result};
use dashmap::DashMap;
use ssh2::{FileStat, Session};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;

use crate::ftp_client::RemoteEntry;

pub struct SftpHandle {
    _stream: TcpStream,
    session: Session,
}

// ssh2::Session is not Send by default; we enforce single-session-per-thread usage.
unsafe impl Send for SftpHandle {}
unsafe impl Sync for SftpHandle {}

pub struct SftpClientManager {
    sessions: Arc<DashMap<String, Arc<tokio::sync::Mutex<SftpHandle>>>>,
}

impl SftpClientManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    pub async fn connect(
        &self,
        session_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<()> {
        let addr = format!("{}:{}", host, port);
        let username = username.to_string();
        let password = password.to_string();

        let handle = tokio::task::spawn_blocking(move || -> Result<SftpHandle> {
            let tcp = TcpStream::connect(&addr)
                .map_err(|e| anyhow!("SFTP TCP connect failed: {}", e))?;
            let tcp2 = tcp.try_clone()
                .map_err(|e| anyhow!("TCP clone failed: {}", e))?;
            let mut sess = Session::new()
                .map_err(|e| anyhow!("SFTP session create failed: {}", e))?;
            sess.set_tcp_stream(tcp2);
            sess.handshake()
                .map_err(|e| anyhow!("SFTP handshake failed: {}", e))?;
            sess.userauth_password(&username, &password)
                .map_err(|e| anyhow!("SFTP auth failed: {}", e))?;
            if !sess.authenticated() {
                return Err(anyhow!("SFTP authentication failed"));
            }
            Ok(SftpHandle { _stream: tcp, session: sess })
        })
        .await
        .map_err(|e| anyhow!("SFTP connect task panicked: {}", e))??;

        self.sessions.insert(session_id.to_string(), Arc::new(tokio::sync::Mutex::new(handle)));
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        if let Some((_, arc)) = self.sessions.remove(session_id) {
            tokio::task::spawn_blocking(move || {
                let handle = arc.blocking_lock();
                let _ = handle.session.disconnect(None, "Goodbye", None);
            })
            .await
            .ok();
        }
        Ok(())
    }

    pub async fn list_dir(&self, session_id: &str, path: &str) -> Result<Vec<RemoteEntry>> {
        let path = path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<Vec<RemoteEntry>> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp()
                .map_err(|e| anyhow!("SFTP subsystem error: {}", e))?;
            let read_dir: Vec<(std::path::PathBuf, FileStat)> = sftp.readdir(Path::new(&path))
                .map_err(|e| anyhow!("SFTP readdir failed: {}", e))?;
            drop(sftp);
            drop(handle);

            let entries: Vec<RemoteEntry> = read_dir
                .into_iter()
                .filter_map(|(pb, stat)| {
                    let name = pb.file_name()?.to_string_lossy().to_string();
                    if name == "." || name == ".." {
                        return None;
                    }
                    Some(stat_to_entry(name, &stat))
                })
                .collect();
            Ok(entries)
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }

    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        progress_cb: impl Fn(u64, u64) -> bool + Send + 'static,
    ) -> Result<()> {
        let remote_path = remote_path.to_string();
        let local_path = local_path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp()
                .map_err(|e| anyhow!("SFTP subsystem error: {}", e))?;

            let total = sftp.stat(Path::new(&remote_path))
                .ok()
                .and_then(|s| s.size)
                .unwrap_or(0);

            let mut remote_file = sftp.open(Path::new(&remote_path))
                .map_err(|e| anyhow!("SFTP open failed: {}", e))?;

            if let Some(parent) = Path::new(&local_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut local_file = std::fs::File::create(&local_path)
                .map_err(|e| anyhow!("Create local file failed: {}", e))?;

            let mut buf = [0u8; 65536];
            let mut bytes_done: u64 = 0;
            loop {
                let n = remote_file.read(&mut buf)
                    .map_err(|e| anyhow!("SFTP read failed: {}", e))?;
                if n == 0 { break; }
                local_file.write_all(&buf[..n])
                    .map_err(|e| anyhow!("Local write failed: {}", e))?;
                bytes_done += n as u64;
                if !progress_cb(bytes_done, total) {
                    return Err(anyhow!("cancelled"));
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking panicked: {}", e))?
    }

    pub async fn upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        progress_cb: impl Fn(u64, u64) -> bool + Send + 'static,
    ) -> Result<()> {
        let local_path = local_path.to_string();
        let remote_path = remote_path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp()
                .map_err(|e| anyhow!("SFTP subsystem error: {}", e))?;

            let total = std::fs::metadata(&local_path)
                .map(|m| m.len())
                .unwrap_or(0);

            let mut local_file = std::fs::File::open(&local_path)
                .map_err(|e| anyhow!("Open local file failed: {}", e))?;
            let mut remote_file = sftp.create(Path::new(&remote_path))
                .map_err(|e| anyhow!("SFTP create failed: {}", e))?;

            let mut buf = [0u8; 65536];
            let mut bytes_done: u64 = 0;
            loop {
                let n = local_file.read(&mut buf)
                    .map_err(|e| anyhow!("Local read failed: {}", e))?;
                if n == 0 { break; }
                remote_file.write_all(&buf[..n])
                    .map_err(|e| anyhow!("SFTP write failed: {}", e))?;
                bytes_done += n as u64;
                if !progress_cb(bytes_done, total) {
                    return Err(anyhow!("cancelled"));
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking panicked: {}", e))?
    }

    pub async fn rename(&self, session_id: &str, old_path: &str, new_path: &str) -> Result<()> {
        let old_path = old_path.to_string();
        let new_path = new_path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp().map_err(|e| anyhow!("{}", e))?;
            sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
                .map_err(|e| anyhow!("SFTP rename failed: {}", e))
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }

    pub async fn delete(&self, session_id: &str, path: &str, is_dir: bool) -> Result<()> {
        let path = path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp().map_err(|e| anyhow!("{}", e))?;
            if is_dir {
                sftp.rmdir(Path::new(&path)).map_err(|e| anyhow!("SFTP rmdir failed: {}", e))
            } else {
                sftp.unlink(Path::new(&path)).map_err(|e| anyhow!("SFTP unlink failed: {}", e))
            }
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }

    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<()> {
        let path = path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp().map_err(|e| anyhow!("{}", e))?;
            sftp.mkdir(Path::new(&path), 0o755).map_err(|e| anyhow!("SFTP mkdir failed: {}", e))
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }

    pub async fn touch(&self, session_id: &str, path: &str) -> Result<()> {
        let path = path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp().map_err(|e| anyhow!("{}", e))?;
            sftp.create(Path::new(&path)).map(|_| ()).map_err(|e| anyhow!("SFTP touch failed: {}", e))
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }

    pub async fn connect_with_key(
        &self,
        session_id: &str,
        host: &str,
        port: u16,
        username: &str,
        key_path: &str,
        passphrase: Option<&str>,
    ) -> Result<()> {
        let addr = format!("{}:{}", host, port);
        let username = username.to_string();
        let key_path = std::path::PathBuf::from(key_path);
        let passphrase = passphrase.map(|s| s.to_string());

        let handle = tokio::task::spawn_blocking(move || -> Result<SftpHandle> {
            let tcp = TcpStream::connect(&addr)
                .map_err(|e| anyhow!("SFTP TCP connect failed: {}", e))?;
            let tcp2 = tcp.try_clone()
                .map_err(|e| anyhow!("TCP clone failed: {}", e))?;
            let mut sess = Session::new()
                .map_err(|e| anyhow!("SFTP session create failed: {}", e))?;
            sess.set_tcp_stream(tcp2);
            sess.handshake()
                .map_err(|e| anyhow!("SFTP handshake failed: {}", e))?;
            sess.userauth_pubkey_file(
                &username,
                None,
                &key_path,
                passphrase.as_deref(),
            ).map_err(|e| anyhow!("SFTP key auth failed: {}", e))?;
            if !sess.authenticated() {
                return Err(anyhow!("SFTP key authentication failed"));
            }
            Ok(SftpHandle { _stream: tcp, session: sess })
        })
        .await
        .map_err(|e| anyhow!("SFTP connect task panicked: {}", e))??;

        self.sessions.insert(session_id.to_string(), Arc::new(tokio::sync::Mutex::new(handle)));
        Ok(())
    }

    pub async fn chmod(&self, session_id: &str, path: &str, mode: u32) -> Result<()> {
        let path = path.to_string();
        let arc = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("SFTP session not found: {}", session_id))?
            .value()
            .clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let handle = arc.blocking_lock();
            let sftp = handle.session.sftp().map_err(|e| anyhow!("{}", e))?;
            let stat = ssh2::FileStat {
                size: None,
                uid: None,
                gid: None,
                perm: Some(mode),
                atime: None,
                mtime: None,
            };
            sftp.setstat(std::path::Path::new(&path), stat)
                .map_err(|e| anyhow!("SFTP setstat failed: {}", e))
        })
        .await
        .map_err(|e| anyhow!("spawn_blocking failed: {}", e))?
    }
}

fn stat_to_entry(name: String, stat: &FileStat) -> RemoteEntry {
    let is_dir = stat.is_dir();
    let size = stat.size;
    let modified = stat.mtime.and_then(|t| {
        chrono::DateTime::<chrono::Utc>::from_timestamp(t as i64, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
    });
    RemoteEntry {
        name,
        size,
        is_dir,
        modified,
        permissions: stat.perm.map(|p| format!("{:o}", p)),
    }
}
