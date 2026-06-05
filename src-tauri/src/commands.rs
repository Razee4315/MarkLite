use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::ipc::Response;
use thiserror::Error;

/// Hard ceiling on text-file content. 50 MB easily covers any sane markdown
/// document while keeping a single careless `read_file` from holding hundreds
/// of MB of UTF-8 in webview memory. Above this we fail fast with a clear
/// error so the user sees a toast instead of a frozen editor.
const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Hard ceiling on a pasted image. Markdown editors get pasted screenshots
/// regularly; 25 MB is generous (a 4K PNG screenshot is ~5–10 MB) but blocks a
/// runaway clipboard payload from filling the user's disk.
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// Whitelist of allowed image extensions for `save_image`. Anything else is
/// refused — prevents a malicious caller from writing an arbitrary `.exe` /
/// `.dll` / `.lnk` into the user's documents folder under the cover of an
/// image-paste flow.
const ALLOWED_IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/// Error type for file operation commands
#[derive(Debug, Error)]
pub enum CommandError {
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Failed to read file: {0}")]
    ReadError(String),
    #[error("Failed to write file: {0}")]
    WriteError(String),
    #[error("File too large: {0}")]
    TooLarge(String),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// File metadata returned when opening a file
#[derive(Debug, Serialize, Deserialize)]
pub struct FileData {
    pub path: String,
    pub name: String,
    pub content: String,
    pub size: u64,
    pub line_count: usize,
}

/// Read a markdown file from disk
#[tauri::command]
pub async fn read_file(path: String) -> Result<FileData, CommandError> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(CommandError::FileNotFound(path));
    }

    // Stat first so we can refuse oversized files before pulling them into
    // memory. Without this, opening a multi-GB log accidentally renamed `.md`
    // would freeze the UI thread for tens of seconds.
    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;

    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "File is {} MB; maximum is {} MB",
            metadata.len() / (1024 * 1024),
            MAX_TEXT_FILE_BYTES / (1024 * 1024),
        )));
    }

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    
    let line_count = content.lines().count();
    
    Ok(FileData {
        path,
        name,
        content,
        size: metadata.len(),
        line_count,
    })
}

/// Save content to a file
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), CommandError> {
    // Mirror the read-side limit. Refusing to write a >50 MB markdown file
    // protects the user from accidentally truncating something pasted from
    // another tool, and matches what `read_file` would refuse to load back.
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "Document is {} MB; maximum is {} MB",
            content.len() / (1024 * 1024),
            MAX_TEXT_FILE_BYTES / (1024 * 1024),
        )));
    }

    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| CommandError::WriteError(e.to_string()))?;

    Ok(())
}

/// Get just the file info without content (for status bar)
#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, CommandError> {
    let file_path = PathBuf::from(&path);
    
    if !file_path.exists() {
        return Err(CommandError::FileNotFound(path));
    }
    
    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    
    Ok(FileInfo {
        path,
        name,
        size: metadata.len(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// File entry for directory listing
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
}

/// List all markdown files in a directory
#[tauri::command]
pub async fn list_directory_files(directory: String) -> Result<Vec<FileEntry>, CommandError> {
    let dir_path = PathBuf::from(&directory);
    
    if !dir_path.exists() {
        return Err(CommandError::FileNotFound(directory));
    }
    
    if !dir_path.is_dir() {
        return Err(CommandError::ReadError("Path is not a directory".to_string()));
    }
    
    let mut entries = Vec::new();
    
    let mut read_dir = tokio::fs::read_dir(&dir_path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    
    while let Some(entry) = read_dir.next_entry().await.map_err(|e| CommandError::ReadError(e.to_string()))? {
        let path = entry.path();
        
        // Only include .md files
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "md" || ext == "markdown" {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    
                    entries.push(FileEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    
    // Sort alphabetically
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    
    Ok(entries)
}

/// Strip any path components from a filename so it can't traverse outside the
/// images directory. Rejects empty / dot-only names and names with separators,
/// drive letters, or NUL bytes. Also enforces an extension whitelist so the
/// "image paste" command can't be used to drop a `.exe` / `.dll` / `.lnk`
/// into the user's documents folder under cover of a markdown image flow.
/// Returns just the basename when valid.
fn sanitize_image_name(name: &str) -> Result<String, CommandError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(CommandError::WriteError("Invalid image filename".to_string()));
    }
    if trimmed.contains('\0') {
        return Err(CommandError::WriteError("Invalid image filename".to_string()));
    }
    // Reject any path-like input — only a bare basename is allowed.
    let basename = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| CommandError::WriteError("Invalid image filename".to_string()))?;
    if basename != trimmed {
        return Err(CommandError::WriteError("Invalid image filename".to_string()));
    }
    // Enforce extension whitelist (case-insensitive). A name with no extension,
    // or one whose extension isn't a known image type, is rejected — this is
    // a defense-in-depth check on top of the basename validation above.
    let ext = std::path::Path::new(basename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext {
        Some(e) if ALLOWED_IMAGE_EXTS.contains(&e.as_str()) => Ok(basename.to_string()),
        _ => Err(CommandError::WriteError(
            "Image filename must end in .png/.jpg/.jpeg/.gif/.webp/.bmp/.svg".to_string(),
        )),
    }
}

/// Save image data to a file in the images subdirectory
/// Returns the relative path to use in markdown
#[tauri::command]
pub async fn save_image(
    md_file_path: String,
    image_data: Vec<u8>,
    image_name: String,
) -> Result<String, CommandError> {
    if image_data.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::TooLarge(format!(
            "Image is {} MB; maximum is {} MB",
            image_data.len() / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024),
        )));
    }
    let safe_name = sanitize_image_name(&image_name)?;
    let md_path = PathBuf::from(&md_file_path);

    // Get the directory containing the markdown file
    let parent_dir = md_path
        .parent()
        .ok_or_else(|| CommandError::WriteError("Cannot determine parent directory".to_string()))?;

    // Create images subdirectory
    let images_dir = parent_dir.join("images");
    if !images_dir.exists() {
        tokio::fs::create_dir_all(&images_dir)
            .await
            .map_err(|e| CommandError::WriteError(format!("Failed to create images directory: {}", e)))?;
    }

    // Full path for the image (basename only, no traversal possible).
    let image_path = images_dir.join(&safe_name);

    // Write the image data
    tokio::fs::write(&image_path, &image_data)
        .await
        .map_err(|e| CommandError::WriteError(format!("Failed to write image: {}", e)))?;

    // Return relative path for markdown (./images/filename.png)
    Ok(format!("./images/{}", safe_name))
}

/// Reject a relative image path that tries to escape the document folder or name
/// an absolute location. Mirrors the front-end `isUnsafeRelativePath` guard so the
/// boundary is enforced in Rust too — the front-end is not a trust boundary.
fn validate_rel_path(rel: &str) -> Result<(), CommandError> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(CommandError::ReadError("Invalid image path".to_string()));
    }
    // Reject Windows drive-letter prefixes (e.g. "C:/...") explicitly — on a
    // non-Windows host they don't parse as an absolute Prefix component, so the
    // checks below would miss them.
    let b = rel.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return Err(CommandError::ReadError("Image path must be relative".to_string()));
    }
    let p = std::path::Path::new(rel);
    if p.is_absolute() {
        return Err(CommandError::ReadError("Image path must be relative".to_string()));
    }
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(CommandError::ReadError(
                    "Image path escapes the document folder".to_string(),
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Read an image that lives under `base_dir` (the open markdown file's directory)
/// and return its raw bytes. Replaces the front-end's `plugin-fs` readFile so we
/// no longer need a broad `fs:allow-read **` capability (SECURITY-02). Validates
/// the relative path, enforces the image size cap, and canonicalizes both base
/// and target to guarantee the resolved file is still inside `base_dir` — which
/// also blocks symlinked escapes (SECURITY-05). Bytes are returned via
/// `tauri::ipc::Response` so large images skip JSON-array serialization.
#[tauri::command]
pub async fn read_image_file(base_dir: String, rel_path: String) -> Result<Response, CommandError> {
    validate_rel_path(&rel_path)?;
    let base = PathBuf::from(&base_dir);
    let full = base.join(&rel_path);

    let metadata = tokio::fs::metadata(&full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err(CommandError::TooLarge(format!(
            "Image is {} MB; maximum is {} MB",
            metadata.len() / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024),
        )));
    }

    // canonicalize() resolves symlinks; the containment check then guarantees the
    // real file is inside the document folder.
    let canon_base = tokio::fs::canonicalize(&base)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    let canon_full = tokio::fs::canonicalize(&full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    if !canon_full.starts_with(&canon_base) {
        return Err(CommandError::ReadError(
            "Image path escapes the document folder".to_string(),
        ));
    }

    let data = tokio::fs::read(&canon_full)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    Ok(Response::new(data))
}

// ===== AI API key — OS keychain (SECURITY-01) =====
//
// Stored in the platform credential store instead of plaintext localStorage.
// The front end keeps endpoint + model in localStorage (non-secret) and routes
// only the key through these commands, with a localStorage fallback on the JS
// side when no keychain is available (e.g. a headless Linux box).
//
// NOTE: the service name stays "marklite" (the app's pre-rename name) on
// purpose — changing it would orphan every existing user's stored API key.
// Same reasoning as the bundle identifier in tauri.conf.json.
const AI_KEY_SERVICE: &str = "marklite";
const AI_KEY_ACCOUNT: &str = "ai-api-key";

#[tauri::command]
pub fn get_ai_key() -> Result<String, String> {
    let entry = keyring::Entry::new(AI_KEY_SERVICE, AI_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(p),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_ai_key(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(AI_KEY_SERVICE, AI_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    if key.is_empty() {
        // Empty key == "clear it". A missing entry is already the desired state.
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(&key).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_image_name, validate_rel_path};

    #[test]
    fn rel_path_accepts_safe_relatives() {
        assert!(validate_rel_path("images/foo.png").is_ok());
        assert!(validate_rel_path("foo.png").is_ok());
        assert!(validate_rel_path("a/b/c.webp").is_ok());
    }

    #[test]
    fn rel_path_rejects_escapes_and_absolutes() {
        assert!(validate_rel_path("").is_err());
        assert!(validate_rel_path("../foo.png").is_err());
        assert!(validate_rel_path("images/../../secret").is_err());
        assert!(validate_rel_path("/etc/passwd").is_err());
        assert!(validate_rel_path("\0").is_err());
        // Windows absolute / drive-prefixed paths.
        assert!(validate_rel_path("C:/Windows/system.ini").is_err());
    }

    #[test]
    fn accepts_basename() {
        assert_eq!(sanitize_image_name("foo.png").unwrap(), "foo.png");
        assert_eq!(sanitize_image_name("image-1234-abc.jpg").unwrap(), "image-1234-abc.jpg");
    }

    #[test]
    fn rejects_traversal() {
        assert!(sanitize_image_name("../foo.png").is_err());
        assert!(sanitize_image_name("..\\foo.png").is_err());
        assert!(sanitize_image_name("foo/bar.png").is_err());
        assert!(sanitize_image_name("foo\\bar.png").is_err());
        assert!(sanitize_image_name("..").is_err());
        assert!(sanitize_image_name(".").is_err());
        assert!(sanitize_image_name("").is_err());
        assert!(sanitize_image_name("\0").is_err());
    }

    #[test]
    fn rejects_non_image_extensions() {
        assert!(sanitize_image_name("malware.exe").is_err());
        assert!(sanitize_image_name("script.lnk").is_err());
        assert!(sanitize_image_name("payload.dll").is_err());
        assert!(sanitize_image_name("noext").is_err());
        assert!(sanitize_image_name("trailing.").is_err());
        // Extension matching is case-insensitive — uppercase OK.
        assert!(sanitize_image_name("photo.PNG").is_ok());
        assert!(sanitize_image_name("photo.JpG").is_ok());
    }

    #[test]
    fn accepts_all_whitelisted_extensions() {
        for ext in &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] {
            let name = format!("img.{}", ext);
            assert!(sanitize_image_name(&name).is_ok(), "rejected {}", name);
        }
    }
}
