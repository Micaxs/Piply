use anyhow::Result;
use dirs::config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyEntry {
    pub id: String,
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    pub comment: String,
}

fn keys_dir() -> PathBuf {
    let mut p = config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("filie");
    p.push("ssh_keys");
    p
}

fn index_path() -> PathBuf {
    let mut p = config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("filie");
    p.push("ssh_keys_index.json");
    p
}

pub fn list_keys() -> Result<Vec<SshKeyEntry>> {
    let path = index_path();
    if !path.exists() { return Ok(vec![]); }
    let data = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&data)?)
}

fn save_index(keys: &[SshKeyEntry]) -> Result<()> {
    let path = index_path();
    if let Some(p) = path.parent() { fs::create_dir_all(p)?; }
    fs::write(&path, serde_json::to_string_pretty(keys)?)?;
    Ok(())
}

pub fn import_key(name: String, private_key_pem: String, _passphrase: Option<String>) -> Result<SshKeyEntry> {
    let id = Uuid::new_v4().to_string();
    let dir = keys_dir();
    fs::create_dir_all(&dir)?;
    let key_file = dir.join(format!("{}.pem", id));
    fs::write(&key_file, &private_key_pem)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600))?;
    }
    let key_type = if private_key_pem.contains("RSA") { "rsa" }
        else if private_key_pem.contains("ED25519") || private_key_pem.contains("OPENSSH") { "ed25519" }
        else if private_key_pem.contains("EC") { "ecdsa" }
        else { "unknown" }.to_string();
    let entry = SshKeyEntry { id, name, key_type, public_key: String::new(), comment: String::new() };
    let mut keys = list_keys()?;
    keys.push(entry.clone());
    save_index(&keys)?;
    Ok(entry)
}

pub fn delete_key(id: &str) -> Result<()> {
    let dir = keys_dir();
    let key_file = dir.join(format!("{}.pem", id));
    let _ = fs::remove_file(&key_file);
    let mut keys = list_keys()?;
    keys.retain(|k| k.id != id);
    save_index(&keys)?;
    Ok(())
}

pub fn key_file_path(id: &str) -> PathBuf {
    keys_dir().join(format!("{}.pem", id))
}
