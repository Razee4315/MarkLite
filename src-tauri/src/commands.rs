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
    /// Last-modified time, ms since the Unix epoch. Lets the frontend detect
    /// external edits (file changed on disk while open) on window focus.
    pub modified: u64,
}

/// Line-ending convention of a file.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Eol {
    Lf,
    Crlf,
}

/// Detect a file's dominant line ending by reading just its first chunk and
/// inspecting the first newline. `\r\n` → Crlf, a bare `\n` → Lf, and a file with
/// no newline at all (or that can't be read) falls back to Lf. Cheap: we never
/// read more than the first 64 KB regardless of file size. EOL-01.
async fn detect_file_eol(path: &str) -> Eol {
    use tokio::io::AsyncReadExt;
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return Eol::Lf,
    };
    let mut buf = vec![0u8; 64 * 1024];
    let n = match file.read(&mut buf).await {
        Ok(n) => n,
        Err(_) => return Eol::Lf,
    };
    for i in 0..n {
        if buf[i] == b'\n' {
            return if i > 0 && buf[i - 1] == b'\r' { Eol::Crlf } else { Eol::Lf };
        }
    }
    Eol::Lf
}

/// Re-apply a file's line ending to editor content (which CodeMirror always
/// normalises to `\n`). We first collapse any stray `\r\n`/`\r` to `\n` so a
/// CRLF target can't produce `\r\r\n`. EOL-01.
fn apply_eol(content: &str, eol: Eol) -> String {
    if eol == Eol::Lf && !content.contains('\r') {
        return content.to_string();
    }
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    match eol {
        Eol::Lf => normalized,
        Eol::Crlf => normalized.replace('\n', "\r\n"),
    }
}

/// Last-modified time in ms since the Unix epoch (0 when unavailable).
fn mtime_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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
        modified: mtime_ms(&metadata),
    })
}

/// Save content to a file. Returns the new last-modified time (ms since epoch)
/// so the frontend can track external changes without a second stat call.
///
/// The write is ATOMIC: content goes to a temp file in the same directory,
/// which is then renamed over the target. A crash or power loss mid-write can
/// no longer truncate the user's document — the worst case is a leftover
/// `.paperling-tmp` file. (std/tokio rename replaces the target on Windows
/// via MoveFileEx + MOVEFILE_REPLACE_EXISTING, and is atomic on POSIX.)
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<u64, CommandError> {
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

    // Preserve the on-disk file's line ending. The editor hands us `\n`-only
    // content; if the existing file uses CRLF we write CRLF back, so opening and
    // saving a Windows file doesn't rewrite every line and produce a noisy diff.
    // A brand-new file (save-as / new note) has no existing EOL, so we keep the
    // editor's LF. EOL-01.
    let file_exists = PathBuf::from(&path).exists();
    let content = if file_exists {
        apply_eol(&content, detect_file_eol(&path).await)
    } else {
        content
    };

    // Same directory as the target so the rename never crosses a filesystem
    // boundary (cross-device renames aren't atomic and can fail outright).
    let tmp = format!("{}.{}.paperling-tmp", path, std::process::id());

    // Write, then fsync BEFORE the rename. Without the sync, a crash right after
    // the rename can leave the (renamed) file present but empty/partial on disk,
    // because the directory entry can reach disk before the data does. An editor
    // whose whole job is not losing words should pay this cost. SAVE-02.
    {
        use tokio::io::AsyncWriteExt;
        let mut f = match tokio::fs::File::create(&tmp).await {
            Ok(f) => f,
            Err(e) => return Err(CommandError::WriteError(e.to_string())),
        };
        if let Err(e) = f.write_all(content.as_bytes()).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CommandError::WriteError(e.to_string()));
        }
        if let Err(e) = f.sync_all().await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CommandError::WriteError(e.to_string()));
        }
    }

    if let Err(e) = tokio::fs::rename(&tmp, &path).await {
        // Don't leave the temp file behind on failure.
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(CommandError::WriteError(e.to_string()));
    }

    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?;
    Ok(mtime_ms(&metadata))
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
        modified: mtime_ms(&metadata),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Last-modified time, ms since the Unix epoch.
    pub modified: u64,
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
    
    // Sort alphabetically, case-insensitively.
    entries.sort_by_key(|a| a.name.to_lowercase());

    Ok(entries)
}

/// A single matching line within a file.
#[derive(Debug, Serialize)]
pub struct SearchMatch {
    /// 1-based line number.
    pub line: u32,
    /// The trimmed (and possibly truncated) line text.
    pub text: String,
}

/// All matches for one file.
#[derive(Debug, Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub matches: Vec<SearchMatch>,
}

// Bounds so a search over a huge or pathological folder stays responsive and
// can't balloon webview memory. Hit caps degrade gracefully (partial results).
const SEARCH_MAX_FILES: usize = 5000; // markdown files scanned
const SEARCH_MAX_RESULTS: usize = 300; // files returned with at least one match
const SEARCH_MAX_MATCHES_PER_FILE: usize = 50;
const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // skip very large files
const SEARCH_SNIPPET_CHARS: usize = 240; // truncate long matching lines

/// Search the text of every markdown file under `directory` (recursively) for
/// `query`. Case-insensitive unless `case_sensitive`. Returns per-file matches
/// with 1-based line numbers so the UI can jump straight to a hit. Skips hidden
/// directories plus `node_modules` / `target`, and is bounded by the caps above.
#[tauri::command]
pub async fn search_files(
    directory: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<FileSearchResult>, CommandError> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root = PathBuf::from(&directory);
    if !root.is_dir() {
        return Err(CommandError::FileNotFound(directory));
    }

    // The walk is blocking I/O; keep it off the async runtime's worker threads.
    tokio::task::spawn_blocking(move || Ok(search_markdown_tree(root, &q, case_sensitive)))
        .await
        .map_err(|e| CommandError::ReadError(e.to_string()))?
}

/// Synchronous, bounded recursive search used by `search_files`. Pulled out so
/// it can be unit-tested without a Tauri/async harness. `query` is assumed
/// non-empty and already trimmed.
fn search_markdown_tree(root: PathBuf, query: &str, case_sensitive: bool) -> Vec<FileSearchResult> {
    let needle = if case_sensitive { query.to_string() } else { query.to_lowercase() };
    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut files_scanned = 0usize;
    let mut stack = vec![root];

    while let Some(dir) = stack.pop() {
        if results.len() >= SEARCH_MAX_RESULTS || files_scanned >= SEARCH_MAX_FILES {
            break;
        }
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // unreadable dir — skip, don't fail the whole search
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name == "node_modules" || name == "target" {
                        continue;
                    }
                }
                stack.push(path);
                continue;
            }
            let is_md = path
                .extension()
                .map(|e| e == "md" || e == "markdown")
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            files_scanned += 1;
            if files_scanned > SEARCH_MAX_FILES {
                break;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.len() > SEARCH_MAX_FILE_BYTES {
                    continue;
                }
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // binary / non-UTF8 — skip
            };
            let mut matches = Vec::new();
            for (i, line) in content.lines().enumerate() {
                let haystack = if case_sensitive {
                    line.to_string()
                } else {
                    line.to_lowercase()
                };
                if haystack.contains(&needle) {
                    let trimmed = line.trim();
                    // Char-boundary-safe truncation (byte slicing could panic on
                    // multibyte UTF-8).
                    let text = if trimmed.chars().count() > SEARCH_SNIPPET_CHARS {
                        let mut s: String = trimmed.chars().take(SEARCH_SNIPPET_CHARS).collect();
                        s.push('…');
                        s
                    } else {
                        trimmed.to_string()
                    };
                    matches.push(SearchMatch {
                        line: (i + 1) as u32,
                        text,
                    });
                    if matches.len() >= SEARCH_MAX_MATCHES_PER_FILE {
                        break;
                    }
                }
            }
            if !matches.is_empty() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();
                results.push(FileSearchResult {
                    path: path.to_string_lossy().to_string(),
                    name,
                    matches,
                });
                if results.len() >= SEARCH_MAX_RESULTS {
                    break;
                }
            }
        }
    }

    results.sort_by_key(|r| r.name.to_lowercase());
    results
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
    // Reject both path separators explicitly, on every platform. On Unix a
    // backslash is a legal filename character, so the Path::file_name() check
    // below would let a Windows-style "..\foo.png" traversal payload through;
    // rejecting separators up front keeps the behavior identical cross-platform.
    if trimmed.contains('/') || trimmed.contains('\\') {
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
    use super::{apply_eol, sanitize_image_name, save_file, search_markdown_tree, validate_rel_path, Eol};

    #[test]
    fn search_finds_matches_recursively_and_case_insensitively() {
        let dir = std::env::temp_dir().join(format!("paperling-search-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("a.md"), "Hello World\nsecond line").unwrap();
        std::fs::write(sub.join("b.md"), "nothing here\nanother WORLD ref").unwrap();
        std::fs::write(dir.join("c.txt"), "world but not markdown").unwrap();

        let results = search_markdown_tree(dir.clone(), "world", false);

        // Two markdown files match; the .txt is ignored.
        assert_eq!(results.len(), 2);
        let a = results.iter().find(|r| r.name == "a.md").unwrap();
        assert_eq!(a.matches.len(), 1);
        assert_eq!(a.matches[0].line, 1);
        assert_eq!(a.matches[0].text, "Hello World");
        let b = results.iter().find(|r| r.name == "b.md").unwrap();
        assert_eq!(b.matches[0].line, 2);

        // Case-sensitive search misses the lowercase/uppercase variants.
        let cs = search_markdown_tree(dir.clone(), "world", true);
        assert!(cs.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn search_skips_hidden_and_ignored_dirs() {
        let dir = std::env::temp_dir().join(format!("paperling-search-skip-{}", std::process::id()));
        let hidden = dir.join(".git");
        let modules = dir.join("node_modules");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::create_dir_all(&modules).unwrap();
        std::fs::write(dir.join("keep.md"), "needle").unwrap();
        std::fs::write(hidden.join("x.md"), "needle").unwrap();
        std::fs::write(modules.join("y.md"), "needle").unwrap();

        let results = search_markdown_tree(dir.clone(), "needle", false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "keep.md");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_file_writes_atomically_and_returns_mtime() {
        // Plain current-thread runtime: tokio's "fs" feature doesn't include
        // the macros feature, so no #[tokio::test] here.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("paperling-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("doc.md").to_string_lossy().to_string();

            let mtime = save_file(path.clone(), "hello".into()).await.unwrap();
            assert!(mtime > 0);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");

            // Overwrite must replace the existing file (rename-over semantics).
            let mtime2 = save_file(path.clone(), "world".into()).await.unwrap();
            assert!(mtime2 >= mtime);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "world");

            // No temp file left behind.
            let leftovers: Vec<_> = std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().contains("paperling-tmp"))
                .collect();
            assert!(leftovers.is_empty());

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    #[test]
    fn apply_eol_converts_and_normalizes() {
        // LF stays LF.
        assert_eq!(apply_eol("a\nb\nc", Eol::Lf), "a\nb\nc");
        // LF content → CRLF on save.
        assert_eq!(apply_eol("a\nb\nc", Eol::Crlf), "a\r\nb\r\nc");
        // Never doubles up if some \r slipped in.
        assert_eq!(apply_eol("a\r\nb", Eol::Crlf), "a\r\nb");
        assert_eq!(apply_eol("a\r\nb", Eol::Lf), "a\nb");
    }

    #[test]
    fn save_file_preserves_crlf_line_endings() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("paperling-eol-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("crlf.md").to_string_lossy().to_string();

            // Seed a CRLF file, then "edit" it with LF-only content (as the editor
            // would hand us) and confirm the CRLF convention survives the save.
            std::fs::write(&path, "one\r\ntwo\r\n").unwrap();
            save_file(path.clone(), "one\ntwo\nthree".into()).await.unwrap();
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\r\ntwo\r\nthree");

            // A brand-new file keeps the editor's LF.
            let lf_path = dir.join("new.md").to_string_lossy().to_string();
            save_file(lf_path.clone(), "a\nb".into()).await.unwrap();
            assert_eq!(std::fs::read_to_string(&lf_path).unwrap(), "a\nb");

            std::fs::remove_dir_all(&dir).ok();
        });
    }

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
