use std::fs;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

use crate::connection_store::{self, ConnectionProfile, Protocol};
use crate::ftp_client::{FtpClientManager, RemoteEntry};
use crate::sftp_client::SftpClientManager;
use crate::transfer_manager::{TransferDirection, TransferItem, TransferManager, TransferStatus};
use crate::ssh_key_store;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub struct AppState {
    pub ftp: Arc<FtpClientManager>,
    pub sftp: Arc<SftpClientManager>,
    pub transfers: Arc<TransferManager>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            ftp: Arc::new(FtpClientManager::new()),
            sftp: Arc::new(SftpClientManager::new()),
            transfers: Arc::new(TransferManager::new()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub session_id: Option<String>,
    pub profile: ConnectionProfile,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
    pub is_dir: bool,
    pub modified: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub transfer_id: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub status: TransferStatus,
}

// ─── Connection commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn connect(
    request: ConnectRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ConnectResult, String> {
    let session_id = request
        .session_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let p = &request.profile;
    let browse_id = format!("{}_browse", session_id);
    let connect_timeout = Duration::from_secs(20);
    match p.protocol {
        Protocol::Ftp => {
            timeout(
                connect_timeout,
                state.ftp.connect(&session_id, &p.host, p.port, &p.username, &p.password, false),
            )
            .await
            .map_err(|_| "Connection timed out".to_string())?
            .map_err(|e| e.to_string())?;
            timeout(
                connect_timeout,
                state.ftp.connect(&browse_id, &p.host, p.port, &p.username, &p.password, false),
            )
            .await
            .map_err(|_| "Connection timed out".to_string())?
            .map_err(|e| e.to_string())?;
        }
        Protocol::Sftp => {
            if let Some(ref key_id) = p.key_id {
                let key_path = ssh_key_store::key_file_path(key_id);
                let kp = key_path.to_str().unwrap_or("").to_string();
                let pw = if p.password.is_empty() { None } else { Some(p.password.clone()) };
                timeout(
                    connect_timeout,
                    state.sftp.connect_with_key(&session_id, &p.host, p.port, &p.username, &kp, pw.as_deref()),
                )
                .await
                .map_err(|_| "Connection timed out".to_string())?
                .map_err(|e| e.to_string())?;
                timeout(
                    connect_timeout,
                    state.sftp.connect_with_key(&browse_id, &p.host, p.port, &p.username, &kp, pw.as_deref()),
                )
                .await
                .map_err(|_| "Connection timed out".to_string())?
                .map_err(|e| e.to_string())?;
            } else {
                timeout(
                    connect_timeout,
                    state.sftp.connect(&session_id, &p.host, p.port, &p.username, &p.password),
                )
                .await
                .map_err(|_| "Connection timed out".to_string())?
                .map_err(|e| e.to_string())?;
                timeout(
                    connect_timeout,
                    state.sftp.connect(&browse_id, &p.host, p.port, &p.username, &p.password),
                )
                .await
                .map_err(|_| "Connection timed out".to_string())?
                .map_err(|e| e.to_string())?;
            }
        }
        Protocol::Ftps => {
            timeout(
                connect_timeout,
                state.ftp.connect(&session_id, &p.host, p.port, &p.username, &p.password, true),
            )
            .await
            .map_err(|_| "Connection timed out".to_string())?
            .map_err(|e| e.to_string())?;
            timeout(
                connect_timeout,
                state.ftp.connect(&browse_id, &p.host, p.port, &p.username, &p.password, true),
            )
            .await
            .map_err(|_| "Connection timed out".to_string())?
            .map_err(|e| e.to_string())?;
        }
    }
    emit_activity(&app, "info", &format!("Connected to {}", p.host));
    Ok(ConnectResult { session_id })
}

#[tauri::command]
pub async fn disconnect(
    session_id: String,
    protocol: Protocol,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let browse_id = format!("{}_browse", session_id);
    match protocol {
        Protocol::Ftp | Protocol::Ftps => {
            state.ftp.disconnect(&session_id).await.map_err(|e| e.to_string())?;
            let _ = state.ftp.disconnect(&browse_id).await;
            emit_activity(&app, "info", "Disconnected");
            Ok(())
        }
        Protocol::Sftp => {
            state.sftp.disconnect(&session_id).await.map_err(|e| e.to_string())?;
            let _ = state.sftp.disconnect(&browse_id).await;
            emit_activity(&app, "info", "Disconnected");
            Ok(())
        }
    }
}

// ─── File browsing commands ─────────────────────────────────────────────────

#[tauri::command]
pub fn list_local(path: String) -> Result<Vec<LocalEntry>, String> {
    let dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for entry in dir.flatten() {
        let meta = entry.metadata().ok();
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().and_then(|m| if m.is_file() { Some(m.len()) } else { None });
        let modified = meta.as_ref().and_then(|m| {
            m.modified().ok().and_then(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                Some(dt.format("%Y-%m-%d %H:%M").to_string())
            })
        });
        entries.push(LocalEntry { name, path: full_path, size, is_dir, modified });
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn list_remote(
    session_id: String,
    protocol: Protocol,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<RemoteEntry>, String> {
    let browse_id = format!("{}_browse", session_id);
    match protocol {
        Protocol::Ftp | Protocol::Ftps => {
            let sid = if state.ftp.has_session(&browse_id) { &browse_id } else { &session_id };
            state.ftp.list_dir(sid, &path).await.map_err(|e| e.to_string())
        }
        Protocol::Sftp => {
            let sid = if state.sftp.has_session(&browse_id) { &browse_id } else { &session_id };
            state.sftp.list_dir(sid, &path).await.map_err(|e| e.to_string())
        }
    }
}

// ─── Transfer commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn upload(
    session_id: String,
    protocol: Protocol,
    local_path: String,
    remote_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let file_size = fs::metadata(&local_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let item = state.transfers.new_transfer(
        session_id.clone(),
        local_path.clone(),
        remote_path.clone(),
        TransferDirection::Upload,
        file_size,
    );
    let transfer_id = item.id.clone();
    state.transfers.enqueue(item);

    emit_activity(&app, "info", &format!("Upload queued: {}", local_path));

    let transfers = state.transfers.clone();
    let ftp = state.ftp.clone();
    let sftp = state.sftp.clone();
    let sem = state.transfers.get_semaphore();
    let tid = transfer_id.clone();

    tokio::spawn(async move {
        let _permit = sem.acquire().await.unwrap();

        if transfers.is_cancelled(&tid) {
            return;
        }

        transfers.update_status(&tid, TransferStatus::InProgress);
        emit_progress(&app, &transfers, &tid);

        let app2 = app.clone();
        let t2 = transfers.clone();
        let tid2 = tid.clone();
        let cb = move |bytes: u64, total: u64| -> bool {
            loop {
                if t2.is_cancelled(&tid2) { return false; }
                if !t2.is_paused(&tid2) { break; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            if t2.is_cancelled(&tid2) { return false; }
            t2.update_bytes(&tid2, bytes, total);
            emit_progress(&app2, &t2, &tid2);
            !t2.is_cancelled(&tid2)
        };

        let result = match protocol {
            Protocol::Ftp | Protocol::Ftps => ftp.upload(&session_id, &local_path, &remote_path, cb).await,
            Protocol::Sftp => sftp.upload(&session_id, &local_path, &remote_path, cb).await,
        };

        match result {
            Ok(()) => {
                let actual = transfers.transfers.get(&tid)
                    .map(|t| t.bytes_transferred)
                    .unwrap_or(file_size);
                transfers.complete(&tid, actual.max(file_size));
            }
            Err(_) if transfers.is_cancelled(&tid) => { /* already Cancelled */ }
            Err(e) => {
                transfers.set_error(&tid, e.to_string());
            }
        }
        emit_progress(&app, &transfers, &tid);
    });

    Ok(transfer_id)
}

#[tauri::command]
pub async fn download(
    session_id: String,
    protocol: Protocol,
    remote_path: String,
    local_path: String,
    file_size: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let item = state.transfers.new_transfer(
        session_id.clone(),
        local_path.clone(),
        remote_path.clone(),
        TransferDirection::Download,
        file_size.unwrap_or(0),
    );
    let transfer_id = item.id.clone();
    state.transfers.enqueue(item);

    emit_activity(&app, "info", &format!("Download queued: {}", remote_path));

    let transfers = state.transfers.clone();
    let ftp = state.ftp.clone();
    let sftp = state.sftp.clone();
    let sem = state.transfers.get_semaphore();
    let tid = transfer_id.clone();

    tokio::spawn(async move {
        let _permit = sem.acquire().await.unwrap();

        if transfers.is_cancelled(&tid) {
            return;
        }

        transfers.update_status(&tid, TransferStatus::InProgress);
        emit_progress(&app, &transfers, &tid);

        let app2 = app.clone();
        let t2 = transfers.clone();
        let tid2 = tid.clone();
        let cb = move |bytes: u64, total: u64| -> bool {
            loop {
                if t2.is_cancelled(&tid2) { return false; }
                if !t2.is_paused(&tid2) { break; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            if t2.is_cancelled(&tid2) { return false; }
            t2.update_bytes(&tid2, bytes, total);
            emit_progress(&app2, &t2, &tid2);
            !t2.is_cancelled(&tid2)
        };

        let result = match protocol {
            Protocol::Ftp | Protocol::Ftps => {
                ftp.download(&session_id, &remote_path, &local_path, file_size.unwrap_or(0), cb).await
            }
            Protocol::Sftp => {
                sftp.download(&session_id, &remote_path, &local_path, cb).await
            }
        };

        match result {
            Ok(()) => {
                let actual = transfers.transfers.get(&tid)
                    .map(|t| t.bytes_transferred)
                    .unwrap_or(0);
                transfers.complete(&tid, actual.max(file_size.unwrap_or(0)));
            }
            Err(_) if transfers.is_cancelled(&tid) => { /* already Cancelled */ }
            Err(e) => {
                transfers.set_error(&tid, e.to_string());
            }
        }
        emit_progress(&app, &transfers, &tid);
    });

    Ok(transfer_id)
}

#[tauri::command]
pub fn cancel_transfer(transfer_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.transfers.cancel(&transfer_id);
    Ok(())
}

#[tauri::command]
pub fn pause_transfer(transfer_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.transfers.pause(&transfer_id);
    Ok(())
}

#[tauri::command]
pub fn resume_transfer(transfer_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.transfers.resume(&transfer_id);
    Ok(())
}

#[tauri::command]
pub fn get_transfer_status(state: State<'_, AppState>) -> Vec<TransferItem> {
    state.transfers.get_all()
}

// ─── File utilities ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    fs::metadata(&path).is_ok()
}

// ─── Connection profile persistence commands ────────────────────────────────

#[tauri::command]
pub fn get_connections() -> Result<Vec<ConnectionProfile>, String> {
    connection_store::load_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_connection(profile: ConnectionProfile) -> Result<ConnectionProfile, String> {
    connection_store::save_connection_encrypted(profile).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(id: String) -> Result<(), String> {
    connection_store::delete_connection_encrypted(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_folders() -> Result<Vec<String>, String> {
    connection_store::load_folders_nested_paths_encrypted().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_folder(folder: String) -> Result<Vec<String>, String> {
    let path: Vec<String> = folder.split('/').filter(|p| !p.is_empty()).map(|s| s.to_string()).collect();
    let name = path.last().cloned().unwrap_or_default();
    if name.is_empty() {
        return connection_store::load_folders_nested_paths_encrypted().map_err(|e| e.to_string());
    }
    connection_store::add_folder_nested_encrypted(&path[..path.len().saturating_sub(1)], &name)
        .await
        .map_err(|e| e.to_string())?;
    connection_store::load_folders_nested_paths_encrypted().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_folder(folder: String) -> Result<Vec<String>, String> {
    let path: Vec<String> = folder.split('/').filter(|p| !p.is_empty()).map(|s| s.to_string()).collect();
    connection_store::remove_folder_nested_encrypted(&path)
        .await
        .map_err(|e| e.to_string())?;
    connection_store::load_folders_nested_paths_encrypted().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_folder(old_name: String, new_name: String) -> Result<Vec<String>, String> {
    let path: Vec<String> = old_name.split('/').filter(|p| !p.is_empty()).map(|s| s.to_string()).collect();
    connection_store::rename_folder_nested_encrypted(&path, &new_name)
        .await
        .map_err(|e| e.to_string())?;
    connection_store::load_folders_nested_paths_encrypted().map_err(|e| e.to_string())
}

// ─── Nested folder operations (Phase B) ────────────────────────────────────

#[tauri::command]
pub async fn load_folders_nested() -> Result<serde_json::Value, String> {
    connection_store::load_folders_nested_encrypted().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_folder_nested(parent_path: Vec<String>, name: String) -> Result<serde_json::Value, String> {
    let folders = connection_store::add_folder_nested_encrypted(&parent_path, &name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&folders).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn remove_folder_nested(path: Vec<String>) -> Result<serde_json::Value, String> {
    let folders = connection_store::remove_folder_nested_encrypted(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&folders).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn rename_folder_nested(path: Vec<String>, new_name: String) -> Result<serde_json::Value, String> {
    let folders = connection_store::rename_folder_nested_encrypted(&path, &new_name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&folders).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn move_folder_nested(from_path: Vec<String>, to_parent_path: Vec<String>) -> Result<serde_json::Value, String> {
    let folders = connection_store::move_folder_nested_encrypted(&from_path, &to_parent_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&folders).map_err(|e| e.to_string())?)
}

// ─── Local file operations ────────────────────────────────────────────────

#[tauri::command]
pub fn rename_local(old_path: String, new_name: String) -> Result<(), String> {
    let old = std::path::Path::new(&old_path);
    let new_path = old.parent()
        .ok_or("No parent")?
        .join(&new_name);
    fs::rename(&old, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_local(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn mkdir_local(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_local(path: String) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Remote file operations ──────────────────────────────────────────────

#[tauri::command]
pub async fn rename_remote(
    session_id: String,
    protocol: crate::connection_store::Protocol,
    old_path: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let old_p = std::path::Path::new(&old_path);
    let parent = old_p.parent().unwrap_or(std::path::Path::new("/"));
    let new_path = parent.join(&new_name).to_string_lossy().to_string();
    match protocol {
        crate::connection_store::Protocol::Ftp | crate::connection_store::Protocol::Ftps => {
            state.ftp.rename(&session_id, &old_path, &new_path).await.map_err(|e| e.to_string())
        }
        crate::connection_store::Protocol::Sftp => {
            state.sftp.rename(&session_id, &old_path, &new_path).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn delete_remote(
    session_id: String,
    protocol: crate::connection_store::Protocol,
    path: String,
    is_dir: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match protocol {
        crate::connection_store::Protocol::Ftp | crate::connection_store::Protocol::Ftps => {
            state.ftp.delete(&session_id, &path, is_dir).await.map_err(|e| e.to_string())
        }
        crate::connection_store::Protocol::Sftp => {
            state.sftp.delete(&session_id, &path, is_dir).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn mkdir_remote(
    session_id: String,
    protocol: crate::connection_store::Protocol,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match protocol {
        crate::connection_store::Protocol::Ftp | crate::connection_store::Protocol::Ftps => {
            state.ftp.mkdir(&session_id, &path).await.map_err(|e| e.to_string())
        }
        crate::connection_store::Protocol::Sftp => {
            state.sftp.mkdir(&session_id, &path).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn chmod_remote(
    session_id: String,
    protocol: Protocol,
    path: String,
    mode: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match protocol {
        Protocol::Sftp => {
            state.sftp.chmod(&session_id, &path, mode).await.map_err(|e| e.to_string())
        }
        _ => Err("chmod is only supported for SFTP connections".to_string()),
    }
}

// ─── SSH Key commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_ssh_keys() -> Result<Vec<crate::ssh_key_store::SshKeyEntry>, String> {
    crate::ssh_key_store::list_keys().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_ssh_key(name: String, private_key_pem: String) -> Result<crate::ssh_key_store::SshKeyEntry, String> {
    crate::ssh_key_store::import_key(name, private_key_pem, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_ssh_key(id: String) -> Result<(), String> {
    crate::ssh_key_store::delete_key(&id).map_err(|e| e.to_string())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn emit_progress(app: &AppHandle, transfers: &Arc<TransferManager>, tid: &str) {
    if let Some(item) = transfers.transfers.get(tid) {
        let event = TransferProgressEvent {
            transfer_id: tid.to_string(),
            bytes_transferred: item.bytes_transferred,
            total_bytes: item.total_bytes,
            status: item.status.clone(),
        };
        let _ = app.emit("transfer-progress", event);
    }
}

fn emit_activity(app: &AppHandle, level: &str, message: &str) {
    use serde_json::json;
    let _ = app.emit("piply-activity-log", json!({ "level": level, "message": message }));
}

// ─── Splash / App Info ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn close_splashscreen(app: AppHandle) {
    use tauri::Manager;
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

// ─── Touch commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn touch_local(path: String) -> Result<(), String> {
    std::fs::File::create(&path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn touch_remote(
    session_id: String,
    protocol: crate::connection_store::Protocol,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match protocol {
        crate::connection_store::Protocol::Ftp | crate::connection_store::Protocol::Ftps => {
            state.ftp.touch(&session_id, &path).await.map_err(|e| e.to_string())
        }
        crate::connection_store::Protocol::Sftp => {
            state.sftp.touch(&session_id, &path).await.map_err(|e| e.to_string())
        }
    }
}

// ─── File Export ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_text_file(filename: String, content: String) -> Result<(), String> {
    let path = rfd::AsyncFileDialog::new()
        .set_file_name(&filename)
        .add_filter("Piply Theme", &["json"])
        .save_file()
        .await;

    if let Some(handle) = path {
        std::fs::write(handle.path(), content.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_text_file() -> Result<Option<String>, String> {
    let path = rfd::AsyncFileDialog::new()
        .add_filter("Piply Theme", &["json"])
        .pick_file()
        .await;

    if let Some(handle) = path {
        let content = std::fs::read_to_string(handle.path())
            .map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

// ── Encrypted storage for connections ───────────────────────────────────────

#[tauri::command]
pub async fn load_connections_encrypted() -> Result<Vec<ConnectionProfile>, String> {
    connection_store::load_connections_encrypted().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_connections_encrypted(
    connections: Vec<ConnectionProfile>,
) -> Result<(), String> {
    let mut data = connection_store::load_all_encrypted().map_err(|e| e.to_string())?;
    data.connections = connections;
    connection_store::save_all_encrypted(&data).map_err(|e| e.to_string())
}

// ── Security: Key Management ────────────────────────────────────────────────

#[tauri::command]
pub async fn wipe_encryption_key() -> Result<(), String> {
    // Delete the key
    crate::encryption::EncryptionManager::delete_key()?;

    // Also delete the encrypted connections file
    let file_path = crate::encryption::EncryptionManager::get_connections_file_path()?;
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete encrypted connections: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn regenerate_encryption_key() -> Result<(), String> {
    // Load current connections before regenerating key
    let data = connection_store::load_all_encrypted().map_err(|e| e.to_string())?;

    // Generate new key (this deletes the old one)
    crate::encryption::EncryptionManager::regenerate_key()?;

    // Re-encrypt and save connections with new key
    connection_store::save_all_encrypted(&data).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_encryption_key_status() -> Result<bool, String> {
    Ok(crate::encryption::EncryptionManager::key_exists())
}
