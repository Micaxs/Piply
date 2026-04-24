use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::Rng;
use std::fs;
use std::path::PathBuf;

const NONCE_LENGTH: usize = 12; // 96 bits for GCM
const KEY_SERVICE: &str = "piply";
const KEY_USERNAME: &str = "encryption_key";
const FALLBACK_KEY_FILE: &str = ".piply_key";
const CONFIG_DIR_NAME: &str = "piply";
const OBFUSCATION_VERSION: u8 = 1; // Version for obfuscation format

pub struct EncryptionManager;

/// Multi-layer obfuscation for key file
/// Layers: XOR (multiple rounds) + Byte rotation + Base64 + XOR again
mod obfuscation {
    use rand::RngCore;
    use base64::{engine::general_purpose, Engine as _};

    /// Obfuscate key data with multiple layers
    /// Format: [version:1][salt:16][obfuscated_data:variable]
    pub fn obfuscate(plaintext: &[u8]) -> Vec<u8> {
        let mut rng = rand::thread_rng();
        let mut salt = [0u8; 16];
        rng.fill_bytes(&mut salt);

        let mut data = plaintext.to_vec();

        // Layer 1: XOR round with salt-derived key
        let xor_key_1 = derive_xor_key(&salt, 0);
        data = xor_bytes(&data, &xor_key_1);

        // Layer 2: Bit rotation (left shift by 3 bits)
        data = rotate_bytes_left(&data, 3);

        // Layer 3: XOR round with different salt-derived key
        let xor_key_2 = derive_xor_key(&salt, 1);
        data = xor_bytes(&data, &xor_key_2);

        // Layer 4: Base64 encode (makes it look random but easier to detect)
        data = general_purpose::STANDARD.encode(&data).into_bytes();

        // Layer 5: Final XOR with salt-derived key
        let xor_key_3 = derive_xor_key(&salt, 2);
        data = xor_bytes(&data, &xor_key_3);

        // Prepend version and salt
        let mut result = vec![super::OBFUSCATION_VERSION];
        result.extend_from_slice(&salt);
        result.extend(data);
        result
    }

    /// Deobfuscate key data (reverses all layers)
    pub fn deobfuscate(obfuscated: &[u8]) -> Result<Vec<u8>, String> {
        if obfuscated.len() < 17 {
            return Err("Invalid obfuscated key file (too short)".to_string());
        }

        let version = obfuscated[0];
        if version != super::OBFUSCATION_VERSION {
            return Err(format!("Unsupported obfuscation version: {}", version));
        }

        let salt = &obfuscated[1..17];
        let data = &obfuscated[17..];

        let mut result = data.to_vec();

        // Reverse Layer 5: XOR with salt-derived key
        let xor_key_3 = derive_xor_key(salt, 2);
        result = xor_bytes(&result, &xor_key_3);

        // Reverse Layer 4: Base64 decode
        let base64_string = String::from_utf8(result)
            .map_err(|e| format!("Invalid UTF-8 in base64 layer: {}", e))?;
        result = general_purpose::STANDARD.decode(&base64_string)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        // Reverse Layer 3: XOR with different salt-derived key
        let xor_key_2 = derive_xor_key(salt, 1);
        result = xor_bytes(&result, &xor_key_2);

        // Reverse Layer 2: Bit rotation (right shift by 3 bits to undo left shift)
        result = rotate_bytes_right(&result, 3);

        // Reverse Layer 1: XOR with salt-derived key
        let xor_key_1 = derive_xor_key(salt, 0);
        result = xor_bytes(&result, &xor_key_1);

        Ok(result)
    }

    /// Derive XOR key from salt and round number using SHA256
    fn derive_xor_key(salt: &[u8], round: u32) -> Vec<u8> {
        use sha2::{Sha256, Digest};

        let mut hasher = Sha256::new();
        hasher.update(salt);
        hasher.update(round.to_le_bytes());
        hasher.finalize().to_vec()
    }

    /// XOR data with key (cycles through key if needed)
    fn xor_bytes(data: &[u8], key: &[u8]) -> Vec<u8> {
        data.iter()
            .enumerate()
            .map(|(i, byte)| byte ^ key[i % key.len()])
            .collect()
    }

    /// Rotate bytes left (bitwise left shift)
    fn rotate_bytes_left(data: &[u8], bits: u32) -> Vec<u8> {
        let bits = bits % 8;
        data.iter()
            .map(|byte| byte.rotate_left(bits))
            .collect()
    }

    /// Rotate bytes right (bitwise right shift)
    fn rotate_bytes_right(data: &[u8], bits: u32) -> Vec<u8> {
        let bits = bits % 8;
        data.iter()
            .map(|byte| byte.rotate_right(bits))
            .collect()
    }
}

impl EncryptionManager {
    /// Generate a random 1024-character key (alphanumeric + special chars)
    pub fn generate_random_key() -> String {
        const CHARSET: &[u8] =
            b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
        let mut rng = rand::thread_rng();
        (0..1024)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }

    /// Try to get or create encryption key (keyring first, fallback to file)
    pub fn get_or_create_key() -> Result<String, String> {
        // Try to retrieve from keyring first
        if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, KEY_USERNAME) {
            if let Ok(password) = entry.get_password() {
                return Ok(password);
            }
            // Keyring doesn't have key, generate and store
            let new_key = Self::generate_random_key();
            if entry.set_password(&new_key).is_ok() {
                return Ok(new_key);
            }
        }

        // Fallback: use file-based storage (hex-encoded binary format)
        let config_dir = dirs::config_dir()
            .ok_or_else(|| "Could not determine config directory".to_string())?;
        let config_dir = config_dir.join(CONFIG_DIR_NAME);
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;

        let key_file = config_dir.join(FALLBACK_KEY_FILE);

        if key_file.exists() {
            let key_hex = fs::read_to_string(&key_file)
                .map_err(|e| format!("Failed to read encryption key file: {}", e))?;
            let obfuscated_bytes = hex::decode(key_hex.trim())
                .map_err(|e| format!("Failed to decode encryption key file: {}", e))?;
            let plaintext_bytes = obfuscation::deobfuscate(&obfuscated_bytes)?;
            let key = String::from_utf8(plaintext_bytes)
                .map_err(|e| format!("Invalid encryption key file (not valid UTF-8): {}", e))?;
            Ok(key)
        } else {
            let new_key = Self::generate_random_key();
            // Apply multi-layer obfuscation, then hex encode
            let obfuscated = obfuscation::obfuscate(new_key.as_bytes());
            let key_hex = hex::encode(&obfuscated);
            fs::write(&key_file, &key_hex)
                .map_err(|e| format!("Failed to write encryption key file: {}", e))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let permissions = fs::Permissions::from_mode(0o600);
                fs::set_permissions(&key_file, permissions)
                    .map_err(|e| format!("Failed to set key file permissions: {}", e))?;
            }

            Ok(new_key)
        }
    }

    /// Encrypt data with AES-256-GCM
    pub fn encrypt(key_str: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        // Derive a 32-byte key from the input key string using SHA256
        let key = Self::derive_key_from_string(key_str)?;

        let cipher = Aes256Gcm::new(&key);
        let mut rng = rand::thread_rng();
        let mut nonce_bytes = [0u8; NONCE_LENGTH];
        rng.fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Return nonce + ciphertext
        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    /// Decrypt data with AES-256-GCM
    pub fn decrypt(key_str: &str, encrypted_data: &[u8]) -> Result<Vec<u8>, String> {
        if encrypted_data.len() < NONCE_LENGTH {
            return Err("Encrypted data too short".to_string());
        }

        // Derive the 32-byte key from the input key string
        let key = Self::derive_key_from_string(key_str)?;

        let (nonce_bytes, ciphertext) = encrypted_data.split_at(NONCE_LENGTH);
        let nonce = Nonce::from_slice(nonce_bytes);

        let cipher = Aes256Gcm::new(&key);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))
    }

    /// Derive a 32-byte key from an arbitrary-length key string using SHA256
    fn derive_key_from_string(key_str: &str) -> Result<aes_gcm::Key<Aes256Gcm>, String> {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(key_str.as_bytes());
        let hash = hasher.finalize();
        Ok(*aes_gcm::Key::<Aes256Gcm>::from_slice(&hash[..]))
    }

    /// Get the path to the encrypted connections file
    pub fn get_connections_file_path() -> Result<PathBuf, String> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| "Could not determine config directory".to_string())?;
        Ok(config_dir.join(CONFIG_DIR_NAME).join("connections.enc"))
    }

    /// Check if encryption key exists (in keyring or file)
    pub fn key_exists() -> bool {
        // Check keyring first
        if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, KEY_USERNAME) {
            if entry.get_password().is_ok() {
                return true;
            }
        }

        // Check fallback file
        if let Some(config_dir) = dirs::config_dir() {
            let key_file = config_dir.join(CONFIG_DIR_NAME).join(FALLBACK_KEY_FILE);
            if key_file.exists() {
                return true;
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_key() {
        let key = EncryptionManager::generate_random_key();
        assert_eq!(key.len(), 1024);
    }

    #[test]
    fn test_encrypt_decrypt() {
        let key = EncryptionManager::generate_random_key();
        let plaintext = b"Hello, World!";

        let encrypted = EncryptionManager::encrypt(&key, plaintext).unwrap();
        let decrypted = EncryptionManager::decrypt(&key, &encrypted).unwrap();

        assert_eq!(plaintext, &decrypted[..]);
    }
}

// Additional key management methods
impl EncryptionManager {
    /// Delete the encryption key from keyring and file
    pub fn delete_key() -> Result<(), String> {
        // Try to delete from keyring
        if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, KEY_USERNAME) {
            let _ = entry.delete_password();
        }

        // Try to delete fallback file
        let config_dir = dirs::config_dir()
            .ok_or_else(|| "Could not determine config directory".to_string())?;
        let key_file = config_dir.join(CONFIG_DIR_NAME).join(FALLBACK_KEY_FILE);

        if key_file.exists() {
            fs::remove_file(&key_file)
                .map_err(|e| format!("Failed to delete encryption key file: {}", e))?;
        }

        Ok(())
    }

    /// Regenerate a new encryption key
    pub fn regenerate_key() -> Result<String, String> {
        let new_key = Self::generate_random_key();

        // Delete old key first
        Self::delete_key()?;

        // Store the new key in keyring/file
        if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, KEY_USERNAME) {
            if entry.set_password(&new_key).is_ok() {
                return Ok(new_key);
            }
        }

        // Fallback: use file-based storage (multi-layer obfuscated + hex-encoded)
        let config_dir = dirs::config_dir()
            .ok_or_else(|| "Could not determine config directory".to_string())?;
        let config_dir = config_dir.join(CONFIG_DIR_NAME);
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;

        let key_file = config_dir.join(FALLBACK_KEY_FILE);
        // Apply multi-layer obfuscation, then hex encode
        let obfuscated = obfuscation::obfuscate(new_key.as_bytes());
        let key_hex = hex::encode(&obfuscated);
        fs::write(&key_file, &key_hex)
            .map_err(|e| format!("Failed to write new encryption key file: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&key_file, permissions)
                .map_err(|e| format!("Failed to set key file permissions: {}", e))?;
        }

        Ok(new_key)
    }
}
