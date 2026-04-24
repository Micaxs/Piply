use anyhow::{anyhow, Result};
use dashmap::DashMap;
use futures::io::AsyncReadExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use suppaftp::{AsyncFtpStream, AsyncNativeTlsFtpStream};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub size: Option<u64>,
    pub is_dir: bool,
    pub modified: Option<String>,
    pub permissions: Option<String>,
}

pub enum FtpSession {
    Plain(AsyncFtpStream),
    Tls(AsyncNativeTlsFtpStream),
}

// ── Progress-tracking AsyncRead wrapper for uploads ─────────────────────────

struct ProgressRead {
    data: Vec<u8>,
    pos: usize,
    total: u64,
    bytes_done: u64,
    cancelled: bool,
    cb: Box<dyn Fn(u64, u64) -> bool + Send>,
}

impl futures::io::AsyncRead for ProgressRead {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut [u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.cancelled {
            return Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled")));
        }
        let remaining = self.data.len().saturating_sub(self.pos);
        if remaining == 0 {
            return Poll::Ready(Ok(0));
        }
        let n = buf.len().min(remaining);
        buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
        self.pos += n;
        self.bytes_done += n as u64;
        let done = self.bytes_done;
        let total = self.total;
        if !(self.cb)(done, total) {
            self.cancelled = true;
        }
        Poll::Ready(Ok(n))
    }
}

impl Unpin for ProgressRead {}

pub struct FtpClientManager {
    sessions: Arc<DashMap<String, tokio::sync::Mutex<FtpSession>>>,
}

impl FtpClientManager {
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
        use_tls: bool,
    ) -> Result<()> {
        let addr = format!("{}:{}", host, port);
        if use_tls {
            let mut stream = AsyncNativeTlsFtpStream::connect(&addr).await
                .map_err(|e| anyhow!("FTP TLS connect failed: {}", e))?;
            stream.login(username, password).await
                .map_err(|e| anyhow!("FTP login failed: {}", e))?;
            stream.transfer_type(suppaftp::types::FileType::Binary).await
                .map_err(|e| anyhow!("FTP set binary mode failed: {}", e))?;
            self.sessions.insert(
                session_id.to_string(),
                tokio::sync::Mutex::new(FtpSession::Tls(stream)),
            );
        } else {
            let mut stream = AsyncFtpStream::connect(&addr).await
                .map_err(|e| anyhow!("FTP connect failed: {}", e))?;
            stream.login(username, password).await
                .map_err(|e| anyhow!("FTP login failed: {}", e))?;
            stream.transfer_type(suppaftp::types::FileType::Binary).await
                .map_err(|e| anyhow!("FTP set binary mode failed: {}", e))?;
            self.sessions.insert(
                session_id.to_string(),
                tokio::sync::Mutex::new(FtpSession::Plain(stream)),
            );
        }
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        if let Some((_, mutex)) = self.sessions.remove(session_id) {
            let mut session = mutex.into_inner();
            match &mut session {
                FtpSession::Plain(s) => { let _ = s.quit().await; }
                FtpSession::Tls(s) => { let _ = s.quit().await; }
            }
        }
        Ok(())
    }

    pub async fn list_dir(&self, session_id: &str, path: &str) -> Result<Vec<RemoteEntry>> {
        let entry = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;

        let entries = match &mut *session {
            FtpSession::Plain(s) => {
                s.list(Some(path)).await
                    .map_err(|e| anyhow!("FTP list failed: {}", e))?
            }
            FtpSession::Tls(s) => {
                s.list(Some(path)).await
                    .map_err(|e| anyhow!("FTP list failed: {}", e))?
            }
        };

        let parsed = entries
            .iter()
            .filter_map(|line| parse_ftp_list_line(line))
            .collect();
        Ok(parsed)
    }

    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        total_bytes: u64,
        progress_cb: impl Fn(u64, u64) -> bool + Send + 'static,
    ) -> Result<()> {
        let entry = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;

        if let Some(parent) = std::path::Path::new(local_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| anyhow!("Create local file failed: {}", e))?;

        let mut buf = vec![0u8; 65536];
        let mut bytes_done: u64 = 0;

        match &mut *session {
            FtpSession::Plain(s) => {
                let mut stream = s.retr_as_stream(remote_path).await
                    .map_err(|e| anyhow!("FTP retr failed: {}", e))?;
                loop {
                    let n = stream.read(&mut buf).await
                        .map_err(|e| anyhow!("FTP read failed: {}", e))?;
                    if n == 0 { break; }
                    local_file.write_all(&buf[..n])
                        .map_err(|e| anyhow!("Local write failed: {}", e))?;
                    bytes_done += n as u64;
                    if !progress_cb(bytes_done, total_bytes) {
                        return Err(anyhow!("cancelled"));
                    }
                }
                s.finalize_retr_stream(stream).await
                    .map_err(|e| anyhow!("FTP finalize failed: {}", e))?;
            }
            FtpSession::Tls(s) => {
                let mut stream = s.retr_as_stream(remote_path).await
                    .map_err(|e| anyhow!("FTP retr failed: {}", e))?;
                loop {
                    let n = stream.read(&mut buf).await
                        .map_err(|e| anyhow!("FTP read failed: {}", e))?;
                    if n == 0 { break; }
                    local_file.write_all(&buf[..n])
                        .map_err(|e| anyhow!("Local write failed: {}", e))?;
                    bytes_done += n as u64;
                    if !progress_cb(bytes_done, total_bytes) {
                        return Err(anyhow!("cancelled"));
                    }
                }
                s.finalize_retr_stream(stream).await
                    .map_err(|e| anyhow!("FTP finalize failed: {}", e))?;
            }
        }
        Ok(())
    }

    pub async fn upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        progress_cb: impl Fn(u64, u64) -> bool + Send + 'static,
    ) -> Result<()> {
        let data = std::fs::read(local_path)
            .map_err(|e| anyhow!("Read local file failed: {}", e))?;
        let total = data.len() as u64;

        let entry = self.sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;

        let mut reader = ProgressRead {
            data,
            pos: 0,
            total,
            bytes_done: 0,
            cancelled: false,
            cb: Box::new(progress_cb),
        };

        match &mut *session {
            FtpSession::Plain(s) => {
                s.put_file(remote_path, &mut reader).await
                    .map_err(|e| anyhow!("FTP upload failed: {}", e))?;
            }
            FtpSession::Tls(s) => {
                s.put_file(remote_path, &mut reader).await
                    .map_err(|e| anyhow!("FTP upload failed: {}", e))?;
            }
        }
        Ok(())
    }

    pub async fn rename(&self, session_id: &str, old_path: &str, new_path: &str) -> Result<()> {
        let entry = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;
        match &mut *session {
            FtpSession::Plain(s) => s.rename(old_path, new_path).await.map_err(|e| anyhow!("{}", e)),
            FtpSession::Tls(s)   => s.rename(old_path, new_path).await.map_err(|e| anyhow!("{}", e)),
        }
    }

    pub async fn delete(&self, session_id: &str, path: &str, is_dir: bool) -> Result<()> {
        let entry = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;
        if is_dir {
            match &mut *session {
                FtpSession::Plain(s) => s.rmdir(path).await.map_err(|e| anyhow!("{}", e)),
                FtpSession::Tls(s)   => s.rmdir(path).await.map_err(|e| anyhow!("{}", e)),
            }
        } else {
            match &mut *session {
                FtpSession::Plain(s) => s.rm(path).await.map_err(|e| anyhow!("{}", e)),
                FtpSession::Tls(s)   => s.rm(path).await.map_err(|e| anyhow!("{}", e)),
            }
        }
    }

    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<()> {
        let entry = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;
        match &mut *session {
            FtpSession::Plain(s) => s.mkdir(path).await.map_err(|e| anyhow!("{}", e)),
            FtpSession::Tls(s)   => s.mkdir(path).await.map_err(|e| anyhow!("{}", e)),
        }
    }

    pub async fn touch(&self, session_id: &str, path: &str) -> Result<()> {
        let entry = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Session not found: {}", session_id))?;
        let mut session = entry.lock().await;
        let mut empty: &[u8] = &[];
        match &mut *session {
            FtpSession::Plain(s) => s.put_file(path, &mut empty).await.map(|_| ()).map_err(|e| anyhow!("{}", e)),
            FtpSession::Tls(s)   => s.put_file(path, &mut empty).await.map(|_| ()).map_err(|e| anyhow!("{}", e)),
        }
    }
}

fn parse_ftp_list_line(line: &str) -> Option<RemoteEntry> {
    // Unix-style: "drwxr-xr-x  2 user group  4096 Apr  1 12:00 dirname"
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    let permissions = parts[0];
    let is_dir = permissions.starts_with('d');
    let size: Option<u64> = parts[4].parse().ok();
    let name = parts[8..].join(" ");
    if name == "." || name == ".." {
        return None;
    }
    let modified = format!("{} {} {}", parts[5], parts[6], parts[7]);
    Some(RemoteEntry {
        name,
        size,
        is_dir,
        modified: Some(modified),
        permissions: Some(permissions.to_string()),
    })
}
