use anyhow::Result;
use dirs::config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    Ftp,
    Sftp,
    Ftps,
}

/// Nested folder structure for organizing connections
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    #[serde(default)]
    pub children: Vec<Folder>,
}

impl Folder {
    /// Calculate nesting depth
    #[allow(dead_code)]
    fn depth(&self) -> usize {
        if self.children.is_empty() {
            1
        } else {
            1 + self.children.iter().map(|c| c.depth()).max().unwrap_or(0)
        }
    }

    /// Validate folder doesn't exceed max nesting depth (5)
    #[allow(dead_code)]
    fn validate_depth(&self) -> Result<()> {
        const MAX_DEPTH: usize = 5;
        if self.depth() > MAX_DEPTH {
            return Err(anyhow::anyhow!("Folder nesting exceeds maximum depth of {}", MAX_DEPTH));
        }
        Ok(())
    }

    /// Find a folder by path (e.g., ["Folder A", "Folder A-A"])
    #[allow(dead_code)]
    pub fn find_by_path(&self, path: &[String]) -> Option<&Folder> {
        if path.is_empty() {
            return Some(self);
        }
        if self.name == path[0] {
            if path.len() == 1 {
                return Some(self);
            }
            return self.children.iter().find_map(|child| child.find_by_path(&path[1..]));
        }
        None
    }

    /// Find a folder mutably by path
    #[allow(dead_code)]
    pub fn find_by_path_mut(&mut self, path: &[String]) -> Option<&mut Folder> {
        if path.is_empty() {
            return Some(self);
        }
        if self.name == path[0] {
            if path.len() == 1 {
                return Some(self);
            }
            return self.children.iter_mut().find_map(|child| child.find_by_path_mut(&path[1..]));
        }
        None
    }

    /// List all folders at this level and below (for UI dropdowns)
    #[allow(dead_code)]
    pub fn all_paths(&self, prefix: Vec<String>) -> Vec<Vec<String>> {
        let mut paths = vec![prefix.clone()];
        for child in &self.children {
            let mut child_prefix = prefix.clone();
            child_prefix.push(child.name.clone());
            paths.extend(child.all_paths(child_prefix));
        }
        paths
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: Protocol,
    pub username: String,
    pub password: String,
    pub remote_path: String,
    /// Folder path as array (e.g., ["Folder A", "Folder A-A"])
    /// Empty array means root level ("Servers")
    #[serde(default)]
    pub folder: Vec<String>,
    #[serde(default)]
    pub key_id: Option<String>,
}

/// Container for connections and folder metadata (stored together in encrypted database)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsData {
    #[serde(default)]
    pub connections: Vec<ConnectionProfile>,
    /// Nested folder structure
    #[serde(default)]
    pub folders: Vec<Folder>,
}

impl ConnectionProfile {
    #[allow(dead_code)]
    pub fn default_port(protocol: &Protocol) -> u16 {
        match protocol {
            Protocol::Ftp => 21,
            Protocol::Sftp => 22,
            Protocol::Ftps => 21,
        }
    }
}

fn config_path() -> PathBuf {
    let mut path = config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("filie");
    path.push("connections.json");
    path
}

pub fn load_connections() -> Result<Vec<ConnectionProfile>> {
    let path = config_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path)?;
    
    // Try new format first (with nested folders)
    if let Ok(wrapper) = serde_json::from_str::<ConnectionsData>(&data) {
        return Ok(wrapper.connections);
    }
    
    // Fallback to old format (array only) for backward compatibility
    let connections: Vec<ConnectionProfile> = serde_json::from_str(&data)?;
    Ok(connections)
}

fn serialize_connections_data(data: &ConnectionsData) -> Result<Vec<u8>> {
    serde_json::to_vec(data).map_err(|e| anyhow::anyhow!(e))
}

pub fn save_all_encrypted(data: &ConnectionsData) -> Result<()> {
    let key = crate::encryption::EncryptionManager::get_or_create_key()
        .map_err(|e| anyhow::anyhow!(e))?;
    let file_path = crate::encryption::EncryptionManager::get_connections_file_path()
        .map_err(|e| anyhow::anyhow!(e))?;

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let json_data = serialize_connections_data(data)?;
    let encrypted_data = crate::encryption::EncryptionManager::encrypt(&key, &json_data)
        .map_err(|e| anyhow::anyhow!(e))?;
    fs::write(&file_path, encrypted_data)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&file_path, permissions)?;
    }

    Ok(())
}

fn parse_legacy_connections_data(content: &str) -> Result<ConnectionsData> {
    if let Ok(data) = serde_json::from_str::<ConnectionsData>(content) {
        return Ok(ConnectionsData {
            connections: migrate_connection_folders_to_paths(data.connections),
            folders: data.folders,
        });
    }

    let connections: Vec<ConnectionProfile> = serde_json::from_str(content)?;
    Ok(ConnectionsData {
        connections: migrate_connection_folders_to_paths(connections),
        folders: Vec::new(),
    })
}

/// Load all data (connections and folders) from encrypted storage.
/// Handles migration from old flat/plaintext formats to the encrypted nested format.
pub fn load_all_encrypted() -> Result<ConnectionsData> {
    let key = crate::encryption::EncryptionManager::get_or_create_key()
        .map_err(|e| anyhow::anyhow!(e))?;
    let file_path = crate::encryption::EncryptionManager::get_connections_file_path()
        .map_err(|e| anyhow::anyhow!(e))?;

    if file_path.exists() {
        let encrypted_data = fs::read(&file_path)?;
        let decrypted_data = crate::encryption::EncryptionManager::decrypt(&key, &encrypted_data)
            .map_err(|e| anyhow::anyhow!(e))?;
        let old_path = config_path();

        if let Ok(data) = serde_json::from_slice::<ConnectionsData>(&decrypted_data) {
            let migrated = ConnectionsData {
                connections: migrate_connection_folders_to_paths(data.connections),
                folders: data.folders,
            };
            if old_path.exists() {
                let _ = fs::remove_file(&old_path);
            }
            return Ok(migrated);
        }

        let connections: Vec<ConnectionProfile> = serde_json::from_slice(&decrypted_data)?;
        let folders = if old_path.exists() {
            fs::read_to_string(&old_path)
                .ok()
                .and_then(|content| parse_legacy_connections_data(&content).ok())
                .map(|data| data.folders)
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let legacy = ConnectionsData {
            connections: migrate_connection_folders_to_paths(connections),
            folders,
        };
        save_all_encrypted(&legacy)?;
        if old_path.exists() {
            let _ = fs::remove_file(&old_path);
        }
        return Ok(legacy);
    }

    let old_path = config_path();
    if old_path.exists() {
        let content = fs::read_to_string(&old_path)?;
        let data = parse_legacy_connections_data(&content)?;
        save_all_encrypted(&data)?;
        let _ = fs::remove_file(&old_path);
        return Ok(data);
    }

    Ok(ConnectionsData {
        connections: Vec::new(),
        folders: Vec::new(),
    })
}

/// Load connections only (backward compatibility)
pub fn load_connections_encrypted() -> Result<Vec<ConnectionProfile>> {
    let data = load_all_encrypted()?;
    Ok(data.connections)
}

pub fn load_folders_nested_paths_encrypted() -> Result<Vec<String>> {
    let data = load_all_encrypted()?;
    let mut paths = Vec::new();
    for folder in data.folders {
        collect_folder_paths(&folder, "", &mut paths);
    }
    paths.sort();
    Ok(paths)
}

/// Convert old flat folder list to nested structure (all at root level)
fn convert_flat_to_nested(flat_folders: Vec<String>) -> Vec<Folder> {
    flat_folders
        .into_iter()
        .map(|name| Folder {
            name,
            children: Vec::new(),
        })
        .collect()
}

/// Migrate old string folder field to new array path field
fn migrate_connection_folders_to_paths(mut connections: Vec<ConnectionProfile>) -> Vec<ConnectionProfile> {
    for conn in &mut connections {
        // If folder is already an array (new format), it's fine
        // The serde default handles conversion from "" string to [] array
        if conn.folder.is_empty() && !conn.folder.is_empty() {
            // This shouldn't happen with our serde defaults, but just in case
            conn.folder = Vec::new();
        }
    }
    connections
}

#[allow(dead_code)]
fn save_all(connections: &[ConnectionProfile]) -> Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Load existing folders to preserve them
    let folders = load_folders().unwrap_or_default();
    let data = ConnectionsData {
        connections: connections.to_vec(),
        folders,
    };
    let json = serde_json::to_string_pretty(&data)?;
    fs::write(&path, json)?;
    Ok(())
}

/// Save connection with encryption (async version for use in commands)
pub async fn save_connection_encrypted(mut profile: ConnectionProfile) -> Result<ConnectionProfile> {
    let mut data = load_all_encrypted()?;
    
    // Generate ID if new
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
        data.connections.push(profile.clone());
    } else {
        // Update or add
        let pos = data.connections.iter().position(|c| c.id == profile.id);
        if let Some(i) = pos {
            data.connections[i] = profile.clone();
        } else {
            data.connections.push(profile.clone());
        }
    }

    save_all_encrypted(&data)?;
    Ok(profile)
}

/// Delete connection with encryption (async version for use in commands)
pub async fn delete_connection_encrypted(id: &str) -> Result<()> {
    let mut data = load_all_encrypted()?;
    data.connections.retain(|c| c.id != id);
    save_all_encrypted(&data)?;
    Ok(())
}

#[allow(dead_code)]
pub fn save_connection(mut profile: ConnectionProfile) -> Result<ConnectionProfile> {
    let mut connections = load_connections()?;
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
        connections.push(profile.clone());
    } else {
        let pos = connections.iter().position(|c| c.id == profile.id);
        if let Some(i) = pos {
            connections[i] = profile.clone();
        } else {
            connections.push(profile.clone());
        }
    }
    save_all(&connections)?;
    Ok(profile)
}

#[allow(dead_code)]
pub fn delete_connection(id: &str) -> Result<()> {
    let mut connections = load_connections()?;
    connections.retain(|c| c.id != id);
    save_all(&connections)?;
    Ok(())
}

/// Load folders from encrypted storage
pub fn load_folders() -> Result<Vec<Folder>> {
    let path = config_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path)?;
    let data: ConnectionsData = serde_json::from_str(&data).unwrap_or_else(|_| {
        // Fallback: if file contains old format (just array), treat as connections only
        ConnectionsData {
            connections: serde_json::from_str(&data).unwrap_or_default(),
            folders: vec![],
        }
    });
    Ok(data.folders)
}

/// Load folders as flat list of folder names (for backwards compatibility with old commands)
pub fn load_folders_flat_names() -> Result<Vec<String>> {
    let folders = load_folders()?;
    let mut names = Vec::new();
    for folder in folders {
        collect_folder_names(&folder, &mut names);
    }
    names.sort();
    Ok(names)
}

fn collect_folder_names(folder: &Folder, names: &mut Vec<String>) {
    names.push(folder.name.clone());
    for child in &folder.children {
        collect_folder_names(child, names);
    }
}

/// Collect all folder paths (e.g., "Folder A/Folder B") from nested structure
fn collect_folder_paths(folder: &Folder, prefix: &str, paths: &mut Vec<String>) {
    let current_path = if prefix.is_empty() {
        folder.name.clone()
    } else {
        format!("{}/{}", prefix, folder.name)
    };
    paths.push(current_path.clone());
    for child in &folder.children {
        collect_folder_paths(child, &current_path, paths);
    }
}

/// Load all folders as full paths (e.g., "Folder A/Folder B")
pub fn load_folders_nested_paths() -> Result<Vec<String>> {
    let folders = load_folders()?;
    let mut paths = Vec::new();
    for folder in folders {
        collect_folder_paths(&folder, "", &mut paths);
    }
    paths.sort();
    Ok(paths)
}

/// Legacy function: add a folder by name (will add to root level)
/// For backward compatibility with old commands
#[allow(dead_code)]
pub fn add_folder_legacy(folder_name: &str) -> Result<Vec<String>> {
    let mut folders = load_folders()?;
    
    // Check if folder already exists (by name, anywhere in tree)
    let all_names = collect_all_folder_names(&folders);
    if !all_names.contains(&folder_name.to_string()) {
        folders.push(Folder {
            name: folder_name.to_string(),
            children: Vec::new(),
        });
        save_folders(&folders)?;
    }
    
    Ok(load_folders_flat_names()?)
}

/// Legacy function: remove a folder by name (from root level)
/// For backward compatibility with old commands
#[allow(dead_code)]
pub fn remove_folder_legacy(folder_name: &str) -> Result<Vec<String>> {
    let mut folders = load_folders()?;
    folders.retain(|f| f.name != folder_name);
    save_folders(&folders)?;
    Ok(load_folders_flat_names()?)
}

/// Legacy function: rename a folder by name (root level only)
/// For backward compatibility with old commands
#[allow(dead_code)]
pub fn rename_folder_legacy(old_name: &str, new_name: &str) -> Result<Vec<String>> {
    let mut folders = load_folders()?;
    for folder in &mut folders {
        if folder.name == old_name {
            folder.name = new_name.to_string();
            break;
        }
    }
    save_folders(&folders)?;
    Ok(load_folders_flat_names()?)
}

fn collect_all_folder_names(folders: &[Folder]) -> Vec<String> {
    let mut names = Vec::new();
    for folder in folders {
        collect_folder_names(folder, &mut names);
    }
    names
}

/// Remove a folder by full path (e.g., "Folder A/Folder B")
pub fn remove_folder_by_path(folder_path: &str) -> Result<Vec<String>> {
    let mut folders = load_folders()?;
    let path_parts: Vec<&str> = folder_path.split('/').filter(|p| !p.is_empty()).collect();
    
    if path_parts.is_empty() {
        return Ok(load_folders_nested_paths()?);
    }
    
    remove_folder_recursive(&mut folders, &path_parts, 0);
    save_folders(&folders)?;
    Ok(load_folders_nested_paths()?)
}

fn remove_folder_recursive(folders: &mut Vec<Folder>, path_parts: &[&str], depth: usize) {
    if depth == path_parts.len() - 1 {
        // Remove folder at this level
        folders.retain(|f| f.name != path_parts[depth]);
    } else {
        // Recurse into children
        for folder in folders.iter_mut() {
            if folder.name == path_parts[depth] {
                remove_folder_recursive(&mut folder.children, path_parts, depth + 1);
                break;
            }
        }
    }
}

/// Rename a folder by full path
pub fn rename_folder_by_path(folder_path: &str, new_name: &str) -> Result<Vec<String>> {
    let mut folders = load_folders()?;
    let path_parts: Vec<&str> = folder_path.split('/').filter(|p| !p.is_empty()).collect();
    
    if path_parts.is_empty() {
        return Ok(load_folders_nested_paths()?);
    }
    
    rename_folder_recursive(&mut folders, &path_parts, 0, new_name);
    save_folders(&folders)?;
    Ok(load_folders_nested_paths()?)
}

fn rename_folder_recursive(folders: &mut Vec<Folder>, path_parts: &[&str], depth: usize, new_name: &str) {
    if depth == path_parts.len() - 1 {
        // Rename folder at this level
        for folder in folders.iter_mut() {
            if folder.name == path_parts[depth] {
                folder.name = new_name.to_string();
                break;
            }
        }
    } else {
        // Recurse into children
        for folder in folders.iter_mut() {
            if folder.name == path_parts[depth] {
                rename_folder_recursive(&mut folder.children, path_parts, depth + 1, new_name);
                break;
            }
        }
    }
}

/// Save folders to plaintext storage
#[allow(dead_code)]
pub fn save_folders(folders: &[Folder]) -> Result<()> {
    let connections = load_connections()?;
    let data = ConnectionsData {
        connections,
        folders: folders.to_vec(),
    };
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&data)?;
    fs::write(&path, json)?;
    Ok(())
}

/// Add a folder at root level or nested
/// path is the parent folder path (empty = root), name is the new folder name
#[allow(dead_code)]
pub fn add_folder(path: &[String], name: &str) -> Result<Vec<Folder>> {
    let mut folders = load_folders()?;
    
    // Validate nesting depth
    let max_depth = if path.is_empty() { 0 } else { path.len() };
    if max_depth + 1 > 5 {
        return Err(anyhow::anyhow!("Cannot nest folders deeper than 5 levels"));
    }
    
    let new_folder = Folder {
        name: name.to_string(),
        children: Vec::new(),
    };
    
    if path.is_empty() {
        // Add to root
        folders.push(new_folder);
    } else {
        // Find parent and add to it
        if let Some(parent) = find_folder_mut(&mut folders, path) {
            parent.children.push(new_folder);
        }
    }
    
    // Save back to plaintext storage
    save_folders(&folders)?;
    
    Ok(folders)
}

/// Remove a folder from the nested structure
#[allow(dead_code)]
pub fn remove_folder(path: &[String]) -> Result<Vec<Folder>> {
    let mut folders = load_folders()?;
    
    if path.is_empty() {
        return Err(anyhow::anyhow!("Cannot remove root folder"));
    }
    
    // Navigate to parent and remove the folder
    let parent_path = &path[..path.len() - 1];
    let folder_name = &path[path.len() - 1];
    
    if parent_path.is_empty() {
        // Remove from root
        folders.retain(|f| f.name != *folder_name);
    } else {
        // Find parent and remove from it
        if let Some(parent) = find_folder_mut(&mut folders, parent_path) {
            parent.children.retain(|f| f.name != *folder_name);
        }
    }
    
    // Save back
    save_folders(&folders)?;
    Ok(folders)
}

/// Rename a folder  
#[allow(dead_code)]
pub fn rename_folder(path: &[String], new_name: &str) -> Result<Vec<Folder>> {
    let mut folders = load_folders()?;
    
    if path.is_empty() {
        return Err(anyhow::anyhow!("Cannot rename root folder"));
    }
    
    // Navigate to folder and rename it
    if let Some(folder) = find_folder_mut(&mut folders, path) {
        folder.name = new_name.to_string();
    } else {
        return Err(anyhow::anyhow!("Folder not found"));
    }
    
    // Save back
    save_folders(&folders)?;
    Ok(folders)
}

/// Move a folder to a new parent path
#[allow(dead_code)]
pub fn move_folder(path: &[String], to_parent_path: &[String]) -> Result<Vec<Folder>> {
    let mut folders = load_folders()?;

    if path.is_empty() {
        return Err(anyhow::anyhow!("Cannot move root folder"));
    }
    if to_parent_path.starts_with(path) {
        return Err(anyhow::anyhow!("Cannot move folder into itself or its children"));
    }

    let moved = extract_folder(&mut folders, path)
        .ok_or_else(|| anyhow::anyhow!("Source folder not found"))?;

    if to_parent_path.is_empty() {
        folders.push(moved);
    } else if let Some(parent) = find_folder_mut(&mut folders, to_parent_path) {
        parent.children.push(moved);
    } else {
        return Err(anyhow::anyhow!("Destination parent folder not found"));
    }

    save_folders(&folders)?;
    Ok(folders)
}

#[allow(dead_code)]
fn find_folder<'a>(folders: &'a [Folder], path: &[String]) -> Option<&'a Folder> {
    if path.is_empty() {
        return None;
    }
    for folder in folders {
        if folder.name == path[0] {
            if path.len() == 1 {
                return Some(folder);
            }
            return find_folder(&folder.children, &path[1..]);
        }
    }
    None
}

#[allow(dead_code)]
fn find_folder_mut<'a>(folders: &'a mut [Folder], path: &[String]) -> Option<&'a mut Folder> {
    if path.is_empty() {
        return None;
    }
    for folder in folders {
        if folder.name == path[0] {
            if path.len() == 1 {
                return Some(folder);
            }
            return find_folder_mut(&mut folder.children, &path[1..]);
        }
    }
    None
}

fn extract_folder(folders: &mut Vec<Folder>, path: &[String]) -> Option<Folder> {
    if path.is_empty() {
        return None;
    }
    if path.len() == 1 {
        let idx = folders.iter().position(|f| f.name == path[0])?;
        return Some(folders.remove(idx));
    }

    let head = &path[0];
    let tail = &path[1..];
    let parent = folders.iter_mut().find(|f| f.name == *head)?;
    extract_folder(&mut parent.children, tail)
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE B: Encrypted nested folder operations (async with encryption)
// ═══════════════════════════════════════════════════════════════════════════

/// Load the full nested folder structure from encrypted storage as JSON
pub async fn load_folders_nested_encrypted() -> Result<serde_json::Value> {
    let data = load_all_encrypted()?;
    let json = serde_json::to_value(&data.folders)?;
    Ok(json)
}

/// Find a folder by path within the nested structure (mutable version for editing)
fn find_folder_nested<'a>(folders: &'a mut [Folder], path: &[String]) -> Option<&'a mut Folder> {
    if path.is_empty() {
        return None;
    }
    
    for folder in folders {
        if folder.name == path[0] {
            if path.len() == 1 {
                return Some(folder);
            }
            return find_folder_nested(&mut folder.children, &path[1..]);
        }
    }
    None
}

/// Add a new folder at the specified parent path in the nested structure
pub async fn add_folder_nested_encrypted(parent_path: &[String], name: &str) -> Result<serde_json::Value> {
    let mut data = load_all_encrypted()?;
    
    // Validate nesting depth
    let depth = if parent_path.is_empty() { 0 } else { parent_path.len() };
    if depth + 1 > 5 {
        return Err(anyhow::anyhow!("Cannot nest folders deeper than 5 levels"));
    }
    
    let new_folder = Folder {
        name: name.to_string(),
        children: Vec::new(),
    };
    
    // Add to appropriate location
    if parent_path.is_empty() {
        // Add to root
        data.folders.push(new_folder);
    } else {
        // Find parent folder and add to it
        if let Some(parent) = find_folder_nested(&mut data.folders, parent_path) {
            parent.children.push(new_folder);
        } else {
            return Err(anyhow::anyhow!("Parent folder not found"));
        }
    }
    
    save_all_encrypted(&data)?;
    let result = serde_json::to_value(&data.folders)?;
    Ok(result)
}

/// Remove a folder by path from the nested structure
pub async fn remove_folder_nested_encrypted(path: &[String]) -> Result<serde_json::Value> {
    let mut data = load_all_encrypted()?;
    
    if path.is_empty() {
        return Err(anyhow::anyhow!("Cannot remove root folder"));
    }
    
    // Navigate to parent and remove the folder
    let parent_path = &path[..path.len() - 1];
    let folder_name = &path[path.len() - 1];
    
    if parent_path.is_empty() {
        // Remove from root
        data.folders.retain(|f| f.name != *folder_name);
    } else {
        // Find parent and remove from it
        if let Some(parent) = find_folder_nested(&mut data.folders, parent_path) {
            parent.children.retain(|f| f.name != *folder_name);
        } else {
            return Err(anyhow::anyhow!("Parent folder not found"));
        }
    }
    
    save_all_encrypted(&data)?;
    let result = serde_json::to_value(&data.folders)?;
    Ok(result)
}

/// Rename a folder by path in the nested structure
pub async fn rename_folder_nested_encrypted(path: &[String], new_name: &str) -> Result<serde_json::Value> {
    let mut data = load_all_encrypted()?;
    
    if path.is_empty() {
        return Err(anyhow::anyhow!("Cannot rename root folder"));
    }
    
    // Find and rename the folder
    if let Some(folder) = find_folder_nested(&mut data.folders, path) {
        folder.name = new_name.to_string();
    } else {
        return Err(anyhow::anyhow!("Folder not found"));
    }
    
    save_all_encrypted(&data)?;
    let result = serde_json::to_value(&data.folders)?;
    Ok(result)
}

/// Move a folder from one parent to another (for drag-drop reorganization)
pub async fn move_folder_nested_encrypted(from_path: &[String], to_parent_path: &[String]) -> Result<serde_json::Value> {
    let mut data = load_all_encrypted()?;
    
    if from_path.is_empty() {
        return Err(anyhow::anyhow!("Cannot move root folder"));
    }
    
    // Check if trying to move folder into itself or a child
    if to_parent_path.starts_with(from_path) {
        return Err(anyhow::anyhow!("Cannot move folder into itself or its children"));
    }
    
    // Extract the folder to move
    let folder_name = from_path[from_path.len() - 1].clone();
    let from_parent_path = &from_path[..from_path.len() - 1];
    
    let folder_to_move = if from_parent_path.is_empty() {
        // Extract from root
        data.folders.iter().position(|f| f.name == folder_name)
            .map(|i| data.folders.remove(i))
    } else {
        // Extract from parent
        find_folder_nested(&mut data.folders, from_parent_path)
            .and_then(|parent| {
                parent.children.iter().position(|f| f.name == folder_name)
                    .map(|i| parent.children.remove(i))
            })
    };
    
    let folder_to_move = match folder_to_move {
        Some(f) => f,
        None => return Err(anyhow::anyhow!("Source folder not found")),
    };
    
    // Insert at new location
    if to_parent_path.is_empty() {
        // Add to root
        data.folders.push(folder_to_move);
    } else {
        // Add to new parent
        if let Some(new_parent) = find_folder_nested(&mut data.folders, to_parent_path) {
            new_parent.children.push(folder_to_move);
        } else {
            return Err(anyhow::anyhow!("Destination parent folder not found"));
        }
    }
    
    save_all_encrypted(&data)?;
    let result = serde_json::to_value(&data.folders)?;
    Ok(result)
}
