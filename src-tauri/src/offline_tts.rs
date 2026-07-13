#[cfg(not(target_os = "android"))]
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;

const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/k7tmiz/a4-tts-voices/main/manifest.json";
const MANIFEST_FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const BUILT_IN_MANIFEST_JSON: &str = r#"
{
  "version": 1,
  "updated_at": "2026-06-18T00:00:00Z",
  "voices": [
    {
      "id": "vits-piper-en_US-amy-low",
      "lang": "en-US",
      "name": "Piper Amy (en-US, low)",
      "size": 67095344,
      "sha256": "c70f5284a09a7fd4ed203b39b2ff51cac1432b422b852eb647b481dade3cf639",
      "url": "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/vits-piper-en_US-amy-low.tar.bz2",
      "version": "1",
      "model": "vits-piper-en_US-amy-low/en_US-amy-low.onnx",
      "tokens": "vits-piper-en_US-amy-low/tokens.txt",
      "lexicon": null,
      "data_dir": "vits-piper-en_US-amy-low/espeak-ng-data",
      "default": true
    },
    {
      "id": "vits-mms-spa",
      "lang": "es",
      "name": "MMS Spanish (spa)",
      "size": 107732096,
      "sha256": "fcc16a2ba9370b6ad955e012c59966f695e4bbb81e151c34f31125e4100b9462",
      "url": "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/vits-mms-spa.tar.bz2",
      "version": "1",
      "model": "vits-mms-spa/model.onnx",
      "tokens": "vits-mms-spa/tokens.txt",
      "lexicon": null,
      "data_dir": null,
      "default": true
    }
  ]
}
"#;
const RELEASE_DOWNLOAD_URL_PREFIX: &str =
    "https://github.com/k7tmiz/a4-tts-voices/releases/download/";
const VOICES_SUBDIR: &str = "voices";
const MAX_VOICE_ID_LEN: usize = 128;
const MAX_VOICE_LANG_LEN: usize = 64;
const MAX_VOICE_NAME_LEN: usize = 256;
const MAX_VOICE_VERSION_LEN: usize = 64;
const MAX_ASSET_PATH_LEN: usize = 1_024;
const MAX_DOWNLOAD_URL_LEN: usize = 2_048;
const MAX_VOICE_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_VOICE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_TAR_METADATA_ENTRY_BYTES: u64 = 1024 * 1024;
const MAX_TAR_METADATA_BYTES: u64 = 8 * 1024 * 1024;
const MAX_INSTALLED_METADATA_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineVoiceEntry {
    pub id: String,
    pub lang: String,
    pub name: String,
    pub size: u64,
    pub sha256: String,
    pub url: String,
    pub version: String,
    pub model: String,
    pub tokens: String,
    #[serde(default)]
    pub lexicon: Option<String>,
    #[serde(default)]
    pub data_dir: Option<String>,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineManifest {
    pub version: u32,
    pub updated_at: String,
    pub voices: Vec<OfflineVoiceEntry>,
}

fn built_in_manifest() -> OfflineManifest {
    parse_manifest_json(BUILT_IN_MANIFEST_JSON)
        .expect("built-in offline voice manifest must be valid")
}

fn validate_voice_id(voice_id: &str) -> Result<(), String> {
    if voice_id.is_empty()
        || voice_id.len() > MAX_VOICE_ID_LEN
        || !voice_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("invalid voice id: {voice_id:?}"));
    }
    Ok(())
}

fn validate_relative_asset_path(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ASSET_PATH_LEN
        || value.contains('\\')
        || value.contains('\0')
    {
        return Err(format!("invalid {field} path: {value:?}"));
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("absolute {field} path is not allowed: {value:?}"));
    }
    let mut components = path.components();
    let mut has_component = false;
    for component in components.by_ref() {
        match component {
            std::path::Component::Normal(_) => has_component = true,
            _ => return Err(format!("invalid {field} path: {value:?}")),
        }
    }
    if !has_component {
        return Err(format!("invalid {field} path: {value:?}"));
    }
    Ok(())
}

fn validate_download_url(url: &str) -> Result<(), String> {
    if url.len() > MAX_DOWNLOAD_URL_LEN {
        return Err("voice download URL is too long".into());
    }
    let suffix = url
        .strip_prefix(RELEASE_DOWNLOAD_URL_PREFIX)
        .ok_or_else(|| format!("untrusted voice download URL: {url}"))?;
    let mut segments = suffix.split('/');
    let tag = segments.next().unwrap_or_default();
    let archive = segments.next().unwrap_or_default();
    if segments.next().is_some()
        || tag.is_empty()
        || archive.is_empty()
        || !archive.ends_with(".tar.bz2")
        || !tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        || !archive
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(format!("invalid voice download URL: {url}"));
    }
    Ok(())
}

fn validate_voice_entry(voice: &OfflineVoiceEntry) -> Result<(), String> {
    validate_voice_id(&voice.id)?;
    if voice.lang.trim().is_empty() || voice.lang.len() > MAX_VOICE_LANG_LEN {
        return Err(format!("voice {} has invalid lang", voice.id));
    }
    if voice.name.trim().is_empty() || voice.name.len() > MAX_VOICE_NAME_LEN {
        return Err(format!("voice {} has invalid name", voice.id));
    }
    if voice.version.trim().is_empty() || voice.version.len() > MAX_VOICE_VERSION_LEN {
        return Err(format!("voice {} has invalid version", voice.id));
    }
    if voice.size == 0 || voice.size > MAX_VOICE_ARCHIVE_BYTES {
        return Err(format!("voice {} has invalid size", voice.id));
    }
    if voice.sha256.len() != 64 || !voice.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("voice {} has invalid sha256", voice.id));
    }
    validate_relative_asset_path(&voice.model, "model")?;
    validate_relative_asset_path(&voice.tokens, "tokens")?;
    if let Some(lexicon) = &voice.lexicon {
        validate_relative_asset_path(lexicon, "lexicon")?;
    }
    if let Some(data_dir) = &voice.data_dir {
        validate_relative_asset_path(data_dir, "data_dir")?;
    }
    Ok(())
}

fn validate_manifest_voice_entry(voice: &OfflineVoiceEntry) -> Result<(), String> {
    validate_voice_entry(voice)?;
    validate_download_url(&voice.url)
}

fn validate_manifest(manifest: &OfflineManifest) -> Result<(), String> {
    if manifest.version != 1 {
        return Err(format!(
            "unsupported offline voice manifest version: {}",
            manifest.version
        ));
    }
    if manifest.updated_at.trim().is_empty() {
        return Err("offline voice manifest has empty updated_at".into());
    }
    if manifest.voices.is_empty() {
        return Err("offline voice manifest contains no voices".into());
    }
    let mut ids = std::collections::HashSet::new();
    for voice in &manifest.voices {
        validate_manifest_voice_entry(voice)?;
        if !ids.insert(voice.id.as_str()) {
            return Err(format!("duplicate offline voice id: {}", voice.id));
        }
    }
    Ok(())
}

fn parse_manifest_json(raw: &str) -> Result<OfflineManifest, String> {
    let manifest: OfflineManifest =
        serde_json::from_str(raw).map_err(|error| format!("manifest parse: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn manifest_with_fallback(remote: Result<OfflineManifest, String>) -> OfflineManifest {
    remote.unwrap_or_else(|_| built_in_manifest())
}

fn trusted_voice_entry(
    manifest: &OfflineManifest,
    voice_id: &str,
) -> Result<OfflineVoiceEntry, String> {
    validate_voice_id(voice_id)?;
    validate_manifest(manifest)?;
    manifest
        .voices
        .iter()
        .find(|voice| voice.id == voice_id)
        .cloned()
        .ok_or_else(|| format!("offline voice not found in manifest: {voice_id}"))
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledVoice {
    pub id: String,
    pub lang: String,
    pub name: String,
    pub version: String,
    pub size_bytes: u64,
    pub model_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub voice_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub phase: String,
}

fn voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?
        .join(VOICES_SUBDIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    Ok(dir)
}

fn dir_size_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    if !path.exists() {
        return 0;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                total += dir_size_bytes(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

fn validate_voice_assets(dir: &Path, voice: &OfflineVoiceEntry) -> Result<(), String> {
    validate_voice_entry(voice)?;
    let dir_meta = std::fs::symlink_metadata(dir)
        .map_err(|error| format!("voice directory metadata: {error}"))?;
    if !dir_meta.file_type().is_dir() || dir_meta.file_type().is_symlink() {
        return Err("voice directory must be a real directory".into());
    }
    let canonical_dir = std::fs::canonicalize(dir)
        .map_err(|error| format!("canonicalize voice directory: {error}"))?;
    let validate_asset = |relative: &str, field: &str, directory: bool| {
        validate_relative_asset_path(relative, field)?;
        let asset = dir.join(relative);
        let canonical_asset = std::fs::canonicalize(&asset)
            .map_err(|error| format!("{field} asset missing: {error}"))?;
        if !canonical_asset.starts_with(&canonical_dir) {
            return Err(format!("{field} asset escapes voice directory"));
        }
        let metadata = std::fs::metadata(&canonical_asset)
            .map_err(|error| format!("{field} asset metadata: {error}"))?;
        if directory && !metadata.is_dir() {
            return Err(format!("{field} asset is not a directory"));
        }
        if !directory && !metadata.is_file() {
            return Err(format!("{field} asset is not a file"));
        }
        Ok(())
    };

    validate_asset(&voice.model, "model", false)?;
    validate_asset(&voice.tokens, "tokens", false)?;
    if let Some(lexicon) = &voice.lexicon {
        validate_asset(lexicon, "lexicon", false)?;
    }
    if let Some(data_dir) = &voice.data_dir {
        validate_asset(data_dir, "data_dir", true)?;
    }
    Ok(())
}

fn validate_stored_voice_assets(dir: &Path, voice: &OfflineVoiceEntry) -> Result<(), String> {
    validate_voice_assets(dir, voice)?;

    let cache_dir = dir.join(".cache");
    match std::fs::symlink_metadata(&cache_dir) {
        Ok(metadata) => {
            if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                return Err("voice cache must be a real directory".into());
            }
            let canonical_voice = std::fs::canonicalize(dir)
                .map_err(|error| format!("canonicalize voice directory: {error}"))?;
            let canonical_cache = std::fs::canonicalize(&cache_dir)
                .map_err(|error| format!("canonicalize voice cache: {error}"))?;
            if !canonical_cache.starts_with(canonical_voice) {
                return Err("voice cache escapes voice directory".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("voice cache metadata: {error}")),
    }
    Ok(())
}

fn read_stored_voice_meta(dir: &Path) -> Option<OfflineVoiceEntry> {
    let meta_path = dir.join("voice.json");
    let meta_file = std::fs::symlink_metadata(&meta_path).ok()?;
    if !meta_file.file_type().is_file()
        || meta_file.file_type().is_symlink()
        || meta_file.len() > MAX_INSTALLED_METADATA_BYTES
    {
        return None;
    }
    let raw = std::fs::read_to_string(meta_path).ok()?;
    let voice = serde_json::from_str::<OfflineVoiceEntry>(&raw).ok()?;
    validate_stored_voice_assets(dir, &voice).ok()?;
    Some(voice)
}

pub fn read_installed_meta(dir: &Path) -> Option<OfflineVoiceEntry> {
    let voice = read_stored_voice_meta(dir)?;
    if dir.file_name().and_then(|name| name.to_str()) != Some(voice.id.as_str()) {
        return None;
    }
    Some(voice)
}

fn backup_identity(path: &Path) -> Option<(String, u128)> {
    let name = path.file_name()?.to_str()?.strip_prefix(".backup-")?;
    let mut parts = name.rsplitn(4, '-');
    parts.next()?.parse::<u64>().ok()?;
    let timestamp = parts.next()?.parse::<u128>().ok()?;
    parts.next()?.parse::<u32>().ok()?;
    let voice_id = parts.next()?.to_string();
    validate_voice_id(&voice_id).ok()?;
    Some((voice_id, timestamp))
}

fn voice_backup_paths(voices_root: &Path, voice_id: &str) -> Vec<(u128, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(voices_root) else {
        return Vec::new();
    };
    let mut backups = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).ok()?;
            if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                return None;
            }
            let (backup_voice_id, timestamp) = backup_identity(&path)?;
            (backup_voice_id == voice_id).then_some((timestamp, path))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(timestamp, _)| *timestamp);
    backups
}

fn cleanup_voice_backups(backups: &[(u128, PathBuf)]) {
    for (_, backup) in backups {
        if let Err(error) = remove_path(backup) {
            eprintln!(
                "offline TTS deferred backup cleanup failed for {}: {error}",
                backup.display()
            );
        }
    }
}

fn recover_or_cleanup_voice_backups(voices_root: &Path, voice_id: &str) -> Result<(), String> {
    validate_voice_id(voice_id)?;
    let backups = voice_backup_paths(voices_root, voice_id);
    if backups.is_empty() {
        return Ok(());
    }

    clear_cached_voice(voice_id);
    let installed_dir = voices_root.join(voice_id);
    match std::fs::symlink_metadata(&installed_dir) {
        Ok(metadata) => {
            if !metadata.file_type().is_dir()
                || metadata.file_type().is_symlink()
                || read_installed_meta(&installed_dir).is_none()
            {
                return Err(format!(
                    "installed voice is invalid while a recovery backup exists: {}",
                    installed_dir.display()
                ));
            }
            cleanup_voice_backups(&backups);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let recoverable = backups.iter().rev().find(|(_, backup)| {
                read_stored_voice_meta(backup)
                    .map(|voice| voice.id == voice_id)
                    .unwrap_or(false)
            });
            let Some((_, backup)) = recoverable else {
                return Ok(());
            };
            std::fs::rename(backup, &installed_dir)
                .map_err(|e| format!("restore offline voice backup: {e}"))?;
            if read_installed_meta(&installed_dir).is_none() {
                return Err("restored offline voice backup failed validation".into());
            }
            cleanup_voice_backups(&backups);
            Ok(())
        }
        Err(error) => Err(format!("inspect installed voice for recovery: {error}")),
    }
}

pub fn recover_voice_dir(app: &AppHandle, voice_id: &str) -> Result<PathBuf, String> {
    validate_voice_id(voice_id)?;
    let root = voices_dir(app)?;
    recover_or_cleanup_voice_backups(&root, voice_id)?;
    Ok(root.join(voice_id))
}

#[tauri::command]
pub fn a4_offline_voices_manifest_url() -> String {
    MANIFEST_URL.to_string()
}

#[tauri::command]
pub async fn a4_offline_voices_manifest_fetch() -> Result<OfflineManifest, String> {
    let remote = async {
        let client = reqwest::Client::builder()
            .timeout(MANIFEST_FETCH_TIMEOUT)
            .build()
            .map_err(|e| format!("manifest client: {e}"))?;
        let resp = client
            .get(MANIFEST_URL)
            .send()
            .await
            .map_err(|e| format!("manifest fetch: {e}"))?
            .error_for_status()
            .map_err(|e| format!("manifest status: {e}"))?;
        let raw = resp
            .text()
            .await
            .map_err(|e| format!("manifest body: {e}"))?;
        parse_manifest_json(&raw)
    }
    .await;
    Ok(manifest_with_fallback(remote))
}

#[tauri::command]
pub fn a4_offline_voices_installed(app: AppHandle) -> Result<Vec<InstalledVoice>, String> {
    let root = voices_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let meta = match read_installed_meta(&p) {
                Some(m) => m,
                None => continue,
            };
            out.push(InstalledVoice {
                id: meta.id.clone(),
                lang: meta.lang.clone(),
                name: meta.name.clone(),
                version: meta.version.clone(),
                size_bytes: dir_size_bytes(&p),
                model_path: p.join(&meta.model).to_string_lossy().into_owned(),
            });
        }
    }
    Ok(out)
}

fn delete_voice_files(app: AppHandle, voice_id: String) -> Result<(), String> {
    validate_voice_id(&voice_id)?;
    let root = voices_dir(&app)?;
    let dir = root.join(&voice_id);
    let backups = voice_backup_paths(&root, &voice_id);
    clear_cached_voice(&voice_id);
    let mut errors = Vec::new();
    if dir.exists() {
        if let Err(error) = remove_path(&dir) {
            errors.push(format!("remove voice: {error}"));
        }
    }
    for (_, backup) in backups {
        if let Err(error) = remove_path(&backup) {
            errors.push(format!("remove voice backup {}: {error}", backup.display()));
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn a4_offline_voices_delete(app: AppHandle, voice_id: String) -> Result<(), String> {
    let voice_lock = offline_voice_operation_lock(&voice_id);
    let voice_guard = voice_lock.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _voice_guard = voice_guard;
        delete_voice_files(app, voice_id)
    })
    .await
    .map_err(|e| format!("offline TTS delete worker failed: {e}"))?
}

#[cfg(target_os = "android")]
pub fn a4_offline_voices_delete(app: AppHandle, voice_id: String) -> Result<(), String> {
    delete_voice_files(app, voice_id)
}

fn validate_download_length_header(
    content_length: Option<u64>,
    expected_size: u64,
) -> Result<(), String> {
    if expected_size == 0 || expected_size > MAX_VOICE_ARCHIVE_BYTES {
        return Err(format!("invalid declared archive size: {expected_size}"));
    }
    if let Some(content_length) = content_length {
        if content_length != expected_size {
            return Err(format!(
                "download size header mismatch: expected={expected_size} actual={content_length}"
            ));
        }
    }
    Ok(())
}

fn checked_download_size_after_chunk(
    downloaded: u64,
    chunk_len: usize,
    expected_size: u64,
) -> Result<u64, String> {
    let chunk_len = u64::try_from(chunk_len).map_err(|_| "download chunk is too large")?;
    let next = downloaded
        .checked_add(chunk_len)
        .ok_or_else(|| "download size overflow".to_string())?;
    if next > expected_size || next > MAX_VOICE_ARCHIVE_BYTES {
        return Err(format!(
            "download exceeds size limit: expected={expected_size} received={next}"
        ));
    }
    Ok(next)
}

fn validate_download_complete(downloaded: u64, expected_size: u64) -> Result<(), String> {
    if downloaded != expected_size {
        return Err(format!(
            "download size mismatch: expected={expected_size} actual={downloaded}"
        ));
    }
    Ok(())
}

async fn fetch_with_progress(
    url: &str,
    dest: &Path,
    on_progress: &tauri::ipc::Channel<DownloadProgress>,
    voice_id: &str,
    expected_size: u64,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download status: {e}"))?;
    validate_download_length_header(resp.content_length(), expected_size)?;
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .await
        .map_err(|e| format!("create file: {e}"))?;
    use tokio::io::AsyncWriteExt;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream: {e}"))?;
        let next_downloaded =
            checked_download_size_after_chunk(downloaded, bytes.len(), expected_size)?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("write: {e}"))?;
        downloaded = next_downloaded;
        if last_emit.elapsed() > std::time::Duration::from_millis(200) {
            let _ = on_progress.send(DownloadProgress {
                voice_id: voice_id.to_string(),
                downloaded,
                total: expected_size,
                phase: "downloading".into(),
            });
            last_emit = std::time::Instant::now();
        }
    }
    validate_download_complete(downloaded, expected_size)?;
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    file.sync_all().await.map_err(|e| format!("sync: {e}"))?;
    Ok(downloaded)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::Digest;
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn validate_archive_entry_path(path: &Path) -> Result<(), String> {
    let raw = path
        .to_str()
        .ok_or_else(|| "tar entry path is not valid UTF-8".to_string())?;
    if raw.is_empty()
        || raw.len() > MAX_ASSET_PATH_LEN
        || raw.contains('\\')
        || raw.contains('\0')
        || path.is_absolute()
    {
        return Err(format!("unsafe tar entry path: {raw:?}"));
    }

    let mut normal_components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(component) => {
                if component == ".tmp" || component == ".cache" {
                    return Err(format!("reserved tar entry path: {raw:?}"));
                }
                normal_components.push(component);
            }
            _ => return Err(format!("unsafe tar entry path: {raw:?}")),
        }
    }
    if normal_components.is_empty() {
        return Err(format!("empty tar entry path: {raw:?}"));
    }
    if normal_components.len() == 1
        && (normal_components[0] == "voice.json" || normal_components[0] == ".voice.json.tmp")
    {
        return Err(format!("reserved tar metadata path: {raw:?}"));
    }
    Ok(())
}

fn is_allowed_tar_metadata(entry_type: tar::EntryType) -> bool {
    entry_type.is_gnu_longname()
        || entry_type.is_pax_local_extensions()
        || entry_type.is_pax_global_extensions()
}

fn validate_tar_bz2_structure(
    archive: &Path,
    max_expanded_bytes: u64,
    max_entries: usize,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    let entries = tar
        .entries()
        .map_err(|e| format!("read tar entries: {e}"))?
        .raw(true);
    let mut entry_count = 0usize;
    let mut expanded_bytes = 0u64;
    let mut metadata_bytes = 0u64;

    for entry in entries {
        let entry = entry.map_err(|e| format!("read tar entry: {e}"))?;
        entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| "tar entry count overflow".to_string())?;
        if entry_count > max_entries || entry_count > MAX_ARCHIVE_ENTRIES {
            return Err(format!("tar contains too many entries: {entry_count}"));
        }

        let entry_type = entry.header().entry_type();
        let entry_size = entry.size();
        if entry_type.is_file() || entry_type.is_dir() {
            validate_archive_entry_path(
                &entry
                    .path()
                    .map_err(|e| format!("read tar entry path: {e}"))?,
            )?;
            expanded_bytes = expanded_bytes
                .checked_add(entry_size)
                .ok_or_else(|| "tar expanded size overflow".to_string())?;
            if expanded_bytes > max_expanded_bytes || expanded_bytes > MAX_EXTRACTED_VOICE_BYTES {
                return Err(format!("tar expanded size exceeds limit: {expanded_bytes}"));
            }
        } else if is_allowed_tar_metadata(entry_type) {
            if entry_size > MAX_TAR_METADATA_ENTRY_BYTES {
                return Err(format!("tar metadata entry is too large: {entry_size}"));
            }
            metadata_bytes = metadata_bytes
                .checked_add(entry_size)
                .ok_or_else(|| "tar metadata size overflow".to_string())?;
            if metadata_bytes > MAX_TAR_METADATA_BYTES {
                return Err(format!("tar metadata exceeds limit: {metadata_bytes}"));
            }
        } else {
            return Err(format!("unsupported tar entry type: {entry_type:?}"));
        }
    }
    Ok(())
}

fn extract_tar_bz2_with_limits(
    archive: &Path,
    dest: &Path,
    max_expanded_bytes: u64,
    max_entries: usize,
) -> Result<(), String> {
    if max_expanded_bytes == 0 || max_entries == 0 {
        return Err("tar extraction limits must be positive".into());
    }
    validate_tar_bz2_structure(archive, max_expanded_bytes, max_entries)?;
    std::fs::create_dir_all(dest).map_err(|e| format!("create extraction directory: {e}"))?;
    let dest_meta = std::fs::symlink_metadata(dest)
        .map_err(|e| format!("extraction directory metadata: {e}"))?;
    if !dest_meta.file_type().is_dir() || dest_meta.file_type().is_symlink() {
        return Err("extraction destination must be a real directory".into());
    }

    let file = std::fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    let entries = tar
        .entries()
        .map_err(|e| format!("read tar entries: {e}"))?;
    let mut entry_count = 0usize;
    let mut expanded_bytes = 0u64;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("read tar entry: {e}"))?;
        let entry_type = entry.header().entry_type();
        if is_allowed_tar_metadata(entry_type) {
            continue;
        }
        if !entry_type.is_file() && !entry_type.is_dir() {
            return Err(format!("unsupported tar entry type: {entry_type:?}"));
        }
        entry_count += 1;
        if entry_count > max_entries || entry_count > MAX_ARCHIVE_ENTRIES {
            return Err(format!("tar contains too many entries: {entry_count}"));
        }
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "tar expanded size overflow".to_string())?;
        if expanded_bytes > max_expanded_bytes || expanded_bytes > MAX_EXTRACTED_VOICE_BYTES {
            return Err(format!("tar expanded size exceeds limit: {expanded_bytes}"));
        }
        let path = entry
            .path()
            .map_err(|e| format!("read tar entry path: {e}"))?
            .into_owned();
        validate_archive_entry_path(&path)?;
        if !entry
            .unpack_in(dest)
            .map_err(|e| format!("unpack tar entry: {e}"))?
        {
            return Err(format!("tar entry escapes extraction directory: {path:?}"));
        }
    }
    Ok(())
}

fn extract_tar_bz2(archive: &Path, dest: &Path) -> Result<(), String> {
    extract_tar_bz2_with_limits(
        archive,
        dest,
        MAX_EXTRACTED_VOICE_BYTES,
        MAX_ARCHIVE_ENTRIES,
    )
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            std::fs::remove_dir_all(path)
        }
        Ok(_) => std::fs::remove_file(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[derive(Debug)]
struct InstallWorkspace {
    staging_dir: PathBuf,
    archive_path: PathBuf,
    backup_dir: PathBuf,
}

fn create_install_workspace(
    voices_root: &Path,
    voice_id: &str,
) -> Result<InstallWorkspace, String> {
    validate_voice_id(voice_id)?;
    let root_meta =
        std::fs::symlink_metadata(voices_root).map_err(|e| format!("voices root metadata: {e}"))?;
    if !root_meta.file_type().is_dir() || root_meta.file_type().is_symlink() {
        return Err("voices root must be a real directory".into());
    }

    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_WORKSPACE: AtomicU64 = AtomicU64::new(0);
    for _ in 0..32 {
        let nonce = NEXT_WORKSPACE.fetch_add(1, Ordering::Relaxed);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let suffix = format!("{voice_id}-{}-{timestamp}-{nonce}", std::process::id());
        let staging_dir = voices_root.join(format!(".install-{suffix}"));
        let archive_path = voices_root.join(format!(".download-{suffix}.tar.bz2"));
        let backup_dir = voices_root.join(format!(".backup-{suffix}"));
        match std::fs::create_dir(&staging_dir) {
            Ok(()) => {
                if archive_path.exists() || backup_dir.exists() {
                    let _ = remove_path(&staging_dir);
                    continue;
                }
                return Ok(InstallWorkspace {
                    staging_dir,
                    archive_path,
                    backup_dir,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create install staging directory: {error}")),
        }
    }
    Err("could not allocate a unique install workspace".into())
}

fn cleanup_staging_on_error<T>(
    workspace: &InstallWorkspace,
    result: Result<T, String>,
) -> Result<T, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            let mut cleanup_errors = Vec::new();
            for (label, path) in [
                ("staging directory", &workspace.staging_dir),
                ("download archive", &workspace.archive_path),
            ] {
                if let Err(cleanup_error) = remove_path(path) {
                    cleanup_errors.push(format!("{label}: {cleanup_error}"));
                }
            }
            if cleanup_errors.is_empty() {
                Err(error)
            } else {
                Err(format!(
                    "{error}; failed to clean install workspace: {}",
                    cleanup_errors.join(", ")
                ))
            }
        }
    }
}

fn commit_staged_voice_with_ops<R, D>(
    staging_dir: &Path,
    installed_dir: &Path,
    backup_dir: &Path,
    mut rename: R,
    mut remove: D,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> std::io::Result<()>,
    D: FnMut(&Path) -> std::io::Result<()>,
{
    if std::fs::symlink_metadata(backup_dir).is_ok() {
        return Err("install backup path already exists".into());
    }
    let has_existing = match std::fs::symlink_metadata(installed_dir) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("inspect installed voice: {error}")),
    };
    if !has_existing {
        return rename(staging_dir, installed_dir).map_err(|e| format!("install voice: {e}"));
    }

    rename(installed_dir, backup_dir).map_err(|e| format!("backup installed voice: {e}"))?;
    if let Err(install_error) = rename(staging_dir, installed_dir) {
        return match rename(backup_dir, installed_dir) {
            Ok(()) => Err(format!("install voice: {install_error}")),
            Err(restore_error) => Err(format!(
                "install voice: {install_error}; restore installed voice: {restore_error}; old voice remains at {}",
                backup_dir.display()
            )),
        };
    }

    // The staging rename above is the commit point. A stale backup is harmless
    // and can be cleaned later; rolling back here could lose both usable paths.
    if let Err(error) = remove(backup_dir) {
        eprintln!(
            "offline TTS committed voice but deferred backup cleanup for {}: {error}",
            backup_dir.display()
        );
    }
    Ok(())
}

fn commit_staged_voice(
    staging_dir: &Path,
    installed_dir: &Path,
    backup_dir: &Path,
) -> Result<(), String> {
    commit_staged_voice_with_ops(
        staging_dir,
        installed_dir,
        backup_dir,
        |from, to| std::fs::rename(from, to),
        remove_path,
    )
}

fn extract_validate_and_write_metadata(
    archive_path: &Path,
    dest_dir: &Path,
    voice: &OfflineVoiceEntry,
) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("mkdir dest: {e}"))?;
    extract_tar_bz2(archive_path, dest_dir)?;
    validate_voice_assets(dest_dir, voice)?;

    use std::io::Write;
    let meta_json = serde_json::to_vec_pretty(voice).map_err(|e| e.to_string())?;
    let temp_meta = dest_dir.join(".voice.json.tmp");
    let final_meta = dest_dir.join("voice.json");
    remove_path(&temp_meta).map_err(|e| format!("remove temporary metadata: {e}"))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_meta)
        .map_err(|e| format!("create metadata: {e}"))?;
    file.write_all(&meta_json)
        .map_err(|e| format!("write metadata: {e}"))?;
    file.sync_all().map_err(|e| format!("sync metadata: {e}"))?;
    drop(file);
    remove_path(&final_meta).map_err(|e| format!("remove old metadata: {e}"))?;
    std::fs::rename(&temp_meta, &final_meta).map_err(|e| format!("install metadata: {e}"))?;
    Ok(())
}

#[cfg_attr(not(target_os = "android"), tauri::command)]
pub async fn a4_offline_voices_download(
    app: AppHandle,
    voice_id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    let voice_lock = offline_voice_operation_lock(&voice_id);
    #[cfg(not(target_os = "android"))]
    let _voice_guard = voice_lock.lock().await;

    let voices_root = voices_dir(&app)?;
    recover_or_cleanup_voice_backups(&voices_root, &voice_id)?;
    let manifest = a4_offline_voices_manifest_fetch().await?;
    let voice = trusted_voice_entry(&manifest, &voice_id)?;
    let dest_dir = voices_root.join(&voice_id);
    let workspace = create_install_workspace(&voices_root, &voice_id)?;
    let preparation_result = async {
        let _ = on_progress.send(DownloadProgress {
            voice_id: voice_id.clone(),
            downloaded: 0,
            total: voice.size,
            phase: "downloading".into(),
        });
        fetch_with_progress(
            &voice.url,
            &workspace.archive_path,
            &on_progress,
            &voice_id,
            voice.size,
        )
        .await?;

        let _ = on_progress.send(DownloadProgress {
            voice_id: voice_id.clone(),
            downloaded: voice.size,
            total: voice.size,
            phase: "verifying".into(),
        });
        let actual_sha = sha256_file(&workspace.archive_path)?;
        let expected_sha = voice.sha256.to_lowercase();
        if actual_sha != expected_sha {
            return Err(format!(
                "sha256 mismatch: expected={expected_sha} actual={actual_sha}"
            ));
        }

        let _ = on_progress.send(DownloadProgress {
            voice_id: voice_id.clone(),
            downloaded: voice.size,
            total: voice.size,
            phase: "extracting".into(),
        });
        extract_validate_and_write_metadata(
            &workspace.archive_path,
            &workspace.staging_dir,
            &voice,
        )?;
        remove_path(&workspace.archive_path).map_err(|e| format!("remove archive: {e}"))?;
        Ok(())
    }
    .await;
    cleanup_staging_on_error(&workspace, preparation_result)?;

    clear_cached_voice(&voice_id);
    if let Err(commit_error) =
        commit_staged_voice(&workspace.staging_dir, &dest_dir, &workspace.backup_dir)
    {
        return cleanup_staging_on_error(&workspace, Err(commit_error));
    }
    let _ = on_progress.send(DownloadProgress {
        voice_id: voice_id.clone(),
        downloaded: voice.size,
        total: voice.size,
        phase: "done".into(),
    });
    Ok(())
}

#[cfg(not(target_os = "android"))]
type EngineMap = HashMap<String, Arc<Mutex<sherpa_rs::tts::VitsTts>>>;

#[cfg(not(target_os = "android"))]
type VoiceOperationLocks = HashMap<String, Arc<tokio::sync::Mutex<()>>>;

#[cfg(not(target_os = "android"))]
fn offline_voice_operation_lock(voice_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    use std::sync::OnceLock;
    static LOCKS: OnceLock<Mutex<VoiceOperationLocks>> = OnceLock::new();

    LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .entry(voice_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

#[cfg(not(target_os = "android"))]
fn offline_engine_cache() -> &'static Mutex<EngineMap> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<EngineMap>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(target_os = "android"))]
fn remove_cached_voice_from_map<T>(cache: &Mutex<HashMap<String, T>>, voice_id: &str) -> bool {
    cache.lock().remove(voice_id).is_some()
}

#[cfg(not(target_os = "android"))]
fn clear_cached_voice(voice_id: &str) {
    let _ = remove_cached_voice_from_map(offline_engine_cache(), voice_id);
}

#[cfg(target_os = "android")]
fn clear_cached_voice(_voice_id: &str) {}

#[derive(Debug, Clone, Serialize)]
pub struct OfflineSpeakResult {
    pub ok: bool,
    pub sample_rate: u32,
    pub wav: Vec<u8>,
    pub error: Option<String>,
}

#[cfg(not(target_os = "android"))]
fn pcm_f32_to_wav_bytes(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    let bytes_per_sample = 2u16;
    let bits_per_sample = bytes_per_sample * 8;
    let channels = 1u16;
    let byte_rate = sample_rate * channels as u32 * bytes_per_sample as u32;
    let block_align = channels * bytes_per_sample;
    let data_len = (samples.len() * 2) as u32;
    let riff_len = 36 + data_len;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let int16 = (clamped * 32767.0) as i16;
        out.extend_from_slice(&int16.to_le_bytes());
    }
    out
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn a4_offline_speak(
    app: AppHandle,
    text: String,
    voice_id: String,
) -> Result<OfflineSpeakResult, String> {
    let voice_lock = offline_voice_operation_lock(&voice_id);
    let voice_guard = voice_lock.lock_owned().await;
    let dir = recover_voice_dir(&app, &voice_id)?;
    let meta = read_installed_meta(&dir).ok_or_else(|| "voice not installed".to_string())?;
    let model_path = dir.join(&meta.model);
    let tokens_path = dir.join(&meta.tokens);
    if !model_path.exists() {
        return Err(format!("model file missing: {}", model_path.display()));
    }
    if !tokens_path.exists() {
        return Err(format!("tokens file missing: {}", tokens_path.display()));
    }
    let lexicon_str = meta
        .lexicon
        .as_ref()
        .map(|s| dir.join(s))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let data_dir_str = meta
        .data_dir
        .as_ref()
        .map(|s| dir.join(s))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let cache = offline_engine_cache();
    let engine = {
        let mut guard = cache.lock();
        if let Some(existing) = guard.get(&voice_id) {
            existing.clone()
        } else {
            use sherpa_rs::tts::{VitsTts, VitsTtsConfig};
            let cfg = VitsTtsConfig {
                model: model_path.to_string_lossy().into_owned(),
                lexicon: lexicon_str,
                tokens: tokens_path.to_string_lossy().into_owned(),
                data_dir: data_dir_str,
                length_scale: 1.0,
                noise_scale: 0.667,
                noise_scale_w: 0.8,
                ..Default::default()
            };
            let tts = VitsTts::new(cfg);
            let arc = Arc::new(Mutex::new(tts));
            guard.insert(voice_id.clone(), arc.clone());
            arc
        }
    };

    let result = tokio::task::spawn_blocking(move || {
        let _voice_guard = voice_guard;
        let mut g = engine.lock();
        g.create(&text, 0, 1.0)
    })
    .await
    .map_err(|e| format!("join: {e}"))?;

    match result {
        Ok(audio) => {
            let wav = pcm_f32_to_wav_bytes(audio.sample_rate, &audio.samples);
            Ok(OfflineSpeakResult {
                ok: true,
                sample_rate: audio.sample_rate,
                wav,
                error: None,
            })
        }
        Err(e) => Ok(OfflineSpeakResult {
            ok: false,
            sample_rate: 0,
            wav: Vec::new(),
            error: Some(format!("synthesis failed: {e}")),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        built_in_manifest, checked_download_size_after_chunk, cleanup_staging_on_error,
        commit_staged_voice_with_ops, create_install_workspace, extract_tar_bz2_with_limits,
        extract_validate_and_write_metadata, manifest_with_fallback, parse_manifest_json,
        read_installed_meta, recover_or_cleanup_voice_backups, remove_path, trusted_voice_entry,
        validate_archive_entry_path, validate_download_complete, validate_download_length_header,
        validate_manifest, OfflineVoiceEntry, BUILT_IN_MANIFEST_JSON, MANIFEST_FETCH_TIMEOUT,
        MANIFEST_URL, MAX_VOICE_ARCHIVE_BYTES,
    };
    #[cfg(not(target_os = "android"))]
    use super::{offline_voice_operation_lock, pcm_f32_to_wav_bytes, remove_cached_voice_from_map};
    #[cfg(not(target_os = "android"))]
    use parking_lot::Mutex;
    #[cfg(not(target_os = "android"))]
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let nonce = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "a4-offline-tts-test-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_voice_meta(dir: &Path, voice: &OfflineVoiceEntry) {
        let raw = serde_json::to_string(voice).unwrap();
        std::fs::write(dir.join("voice.json"), raw).unwrap();
    }

    fn write_valid_voice_dir(dir: &Path, voice_id: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let mut voice = built_in_manifest().voices.remove(0);
        voice.id = voice_id.to_string();
        voice.model = "model.onnx".into();
        voice.tokens = "tokens.txt".into();
        voice.lexicon = None;
        voice.data_dir = None;
        std::fs::write(dir.join("model.onnx"), b"model").unwrap();
        std::fs::write(dir.join("tokens.txt"), b"tokens").unwrap();
        write_voice_meta(dir, &voice);
    }

    fn write_test_archive(path: &Path, files: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let encoder = bzip2::write::BzEncoder::new(file, bzip2::Compression::best());
        let mut archive = tar::Builder::new(encoder);
        for (entry_path, contents) in files {
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o644);
            header.set_size(contents.len() as u64);
            header.set_cksum();
            archive
                .append_data(&mut header, entry_path, *contents)
                .unwrap();
        }
        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap();
    }

    fn write_test_archive_entry_type(path: &Path, entry_type: tar::EntryType) {
        let file = std::fs::File::create(path).unwrap();
        let encoder = bzip2::write::BzEncoder::new(file, bzip2::Compression::best());
        let mut archive = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(0);
        header.set_entry_type(entry_type);
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            header.set_link_name("target").unwrap();
        }
        header.set_cksum();
        archive
            .append_data(&mut header, "unsafe-entry", std::io::empty())
            .unwrap();
        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap();
    }

    #[test]
    fn manifest_url_uses_public_github_repository() {
        assert_eq!(
            MANIFEST_URL,
            "https://raw.githubusercontent.com/k7tmiz/a4-tts-voices/main/manifest.json"
        );
    }

    #[test]
    fn remote_manifest_timeout_keeps_fallback_responsive() {
        assert_eq!(MANIFEST_FETCH_TIMEOUT, std::time::Duration::from_secs(5));
    }

    #[test]
    fn built_in_manifest_is_the_current_v1_catalog() {
        let manifest = built_in_manifest();

        assert_eq!(manifest.version, 1);
        assert_eq!(manifest.updated_at, "2026-06-18T00:00:00Z");
        assert_eq!(manifest.voices.len(), 2);

        let english = &manifest.voices[0];
        assert_eq!(english.id, "vits-piper-en_US-amy-low");
        assert_eq!(english.lang, "en-US");
        assert_eq!(english.name, "Piper Amy (en-US, low)");
        assert_eq!(english.size, 67_095_344);
        assert_eq!(
            english.sha256,
            "c70f5284a09a7fd4ed203b39b2ff51cac1432b422b852eb647b481dade3cf639"
        );
        assert_eq!(
            english.url,
            "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/vits-piper-en_US-amy-low.tar.bz2"
        );
        assert_eq!(english.version, "1");
        assert_eq!(english.model, "vits-piper-en_US-amy-low/en_US-amy-low.onnx");
        assert_eq!(english.tokens, "vits-piper-en_US-amy-low/tokens.txt");
        assert_eq!(english.lexicon, None);
        assert_eq!(
            english.data_dir.as_deref(),
            Some("vits-piper-en_US-amy-low/espeak-ng-data")
        );
        assert!(english.default);

        let spanish = &manifest.voices[1];
        assert_eq!(spanish.id, "vits-mms-spa");
        assert_eq!(spanish.lang, "es");
        assert_eq!(spanish.name, "MMS Spanish (spa)");
        assert_eq!(spanish.size, 107_732_096);
        assert_eq!(
            spanish.sha256,
            "fcc16a2ba9370b6ad955e012c59966f695e4bbb81e151c34f31125e4100b9462"
        );
        assert_eq!(
            spanish.url,
            "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/vits-mms-spa.tar.bz2"
        );
        assert_eq!(spanish.version, "1");
        assert_eq!(spanish.model, "vits-mms-spa/model.onnx");
        assert_eq!(spanish.tokens, "vits-mms-spa/tokens.txt");
        assert_eq!(spanish.lexicon, None);
        assert_eq!(spanish.data_dir, None);
        assert!(spanish.default);
    }

    #[test]
    fn manifest_validation_rejects_untrusted_identifiers_paths_hashes_and_urls() {
        let valid = built_in_manifest();
        assert!(validate_manifest(&valid).is_ok());

        let mut cases = Vec::new();

        let mut invalid = valid.clone();
        invalid.voices[0].id = "../outside".into();
        cases.push(("parent voice id", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].id = "nested/voice".into();
        cases.push(("slash in voice id", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].id = r"nested\voice".into();
        cases.push(("backslash in voice id", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].model = "/tmp/model.onnx".into();
        cases.push(("absolute model", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].tokens = "../tokens.txt".into();
        cases.push(("parent tokens", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].lexicon = Some(r"dict\lexicon.txt".into());
        cases.push(("backslash lexicon", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].data_dir = Some("assets/../../outside".into());
        cases.push(("parent data dir", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].sha256 = "not-a-sha256".into();
        cases.push(("invalid sha256", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].url =
            "https://example.com/k7tmiz/a4-tts-voices/releases/download/v1/voice.tar.bz2".into();
        cases.push(("untrusted download host", invalid));

        let mut invalid = valid.clone();
        invalid.voices[1].id = invalid.voices[0].id.clone();
        cases.push(("duplicate voice id", invalid));

        for (description, manifest) in cases {
            assert!(
                validate_manifest(&manifest).is_err(),
                "accepted {description}"
            );
        }
    }

    #[test]
    fn manifest_validation_rejects_oversized_voice_fields_and_archives() {
        let valid = built_in_manifest();
        let mut cases = Vec::new();

        let mut invalid = valid.clone();
        invalid.voices[0].lang = "x".repeat(65);
        cases.push(("lang", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].name = "x".repeat(257);
        cases.push(("name", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].version = "x".repeat(65);
        cases.push(("version", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].model = format!("{}.onnx", "x".repeat(1_025));
        cases.push(("model path", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].url = format!(
            "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/{}.tar.bz2",
            "x".repeat(2_049)
        );
        cases.push(("download URL", invalid));

        let mut invalid = valid.clone();
        invalid.voices[0].size = 512 * 1024 * 1024 + 1;
        cases.push(("archive size", invalid));

        for (field, manifest) in cases {
            assert!(
                validate_manifest(&manifest).is_err(),
                "accepted oversized {field}"
            );
        }
    }

    #[test]
    fn malformed_or_invalid_remote_manifest_uses_built_in_catalog() {
        let network_fallback = manifest_with_fallback(Err("network failed".into()));
        assert_eq!(network_fallback.voices[0].id, "vits-piper-en_US-amy-low");

        let malformed_fallback = manifest_with_fallback(parse_manifest_json("not json"));
        assert_eq!(malformed_fallback.voices[1].id, "vits-mms-spa");

        let invalid_schema = r#"{
            "version": 1,
            "updated_at": "2026-06-18T00:00:00Z",
            "voices": [{"id": "missing-required-fields"}]
        }"#;
        let schema_fallback = manifest_with_fallback(parse_manifest_json(invalid_schema));
        assert_eq!(schema_fallback.voices.len(), 2);

        let invalid_fields =
            BUILT_IN_MANIFEST_JSON.replace("vits-piper-en_US-amy-low", "../outside");
        let field_fallback = manifest_with_fallback(parse_manifest_json(&invalid_fields));
        assert_eq!(field_fallback.voices[0].id, "vits-piper-en_US-amy-low");
    }

    #[test]
    fn installed_metadata_requires_matching_id_and_safe_existing_assets() {
        let root = TestDir::new();
        let mut voice = built_in_manifest().voices.remove(0);
        voice.id = "test-voice".into();
        voice.model = "assets/model.onnx".into();
        voice.tokens = "assets/tokens.txt".into();
        voice.lexicon = Some("assets/lexicon.txt".into());
        voice.data_dir = Some("assets/espeak-data".into());

        let dir = root.path().join(&voice.id);
        std::fs::create_dir_all(dir.join("assets/espeak-data")).unwrap();
        std::fs::write(dir.join("assets/model.onnx"), b"model").unwrap();
        std::fs::write(dir.join("assets/tokens.txt"), b"tokens").unwrap();
        std::fs::write(dir.join("assets/lexicon.txt"), b"lexicon").unwrap();
        write_voice_meta(&dir, &voice);
        assert!(read_installed_meta(&dir).is_some());

        let mut invalid = voice.clone();
        invalid.id = "different-id".into();
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted mismatched id"
        );

        let outside_model = root.path().join("outside.onnx");
        std::fs::write(&outside_model, b"outside").unwrap();
        let mut invalid = voice.clone();
        invalid.model = "../outside.onnx".into();
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted parent model path"
        );

        let mut invalid = voice.clone();
        invalid.tokens = outside_model.to_string_lossy().into_owned();
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted absolute tokens path"
        );

        let mut invalid = voice.clone();
        invalid.model = "assets/missing.onnx".into();
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted missing model"
        );

        let mut invalid = voice.clone();
        invalid.lexicon = Some("assets/espeak-data".into());
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted directory as lexicon"
        );

        let mut invalid = voice.clone();
        invalid.data_dir = Some("assets/lexicon.txt".into());
        write_voice_meta(&dir, &invalid);
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted file as data_dir"
        );

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside_model, dir.join("assets/model-link.onnx")).unwrap();
            let mut invalid = voice.clone();
            invalid.model = "assets/model-link.onnx".into();
            write_voice_meta(&dir, &invalid);
            assert!(
                read_installed_meta(&dir).is_none(),
                "accepted model symlink escaping voice directory"
            );
        }
    }

    #[test]
    fn installed_metadata_accepts_legacy_download_url_when_assets_are_safe() {
        let root = TestDir::new();
        let mut voice = built_in_manifest().voices.remove(1);
        voice.id = "legacy-url-voice".into();
        voice.url = "https://tts.k7tmiz.com/voices/vits-mms-spa.tar.bz2".into();
        voice.model = "model.onnx".into();
        voice.tokens = "tokens.txt".into();

        let dir = root.path().join(&voice.id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("model.onnx"), b"model").unwrap();
        std::fs::write(dir.join("tokens.txt"), b"tokens").unwrap();
        write_voice_meta(&dir, &voice);

        let installed = read_installed_meta(&dir).expect("legacy metadata should stay usable");
        assert_eq!(installed.id, voice.id);
        assert_eq!(installed.url, voice.url);
    }

    #[test]
    fn installed_metadata_rejects_unsafe_existing_cache_path() {
        let root = TestDir::new();
        let mut voice = built_in_manifest().voices.remove(1);
        voice.id = "cache-path-voice".into();
        voice.model = "model.onnx".into();
        voice.tokens = "tokens.txt".into();
        let dir = root.path().join(&voice.id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("model.onnx"), b"model").unwrap();
        std::fs::write(dir.join("tokens.txt"), b"tokens").unwrap();
        write_voice_meta(&dir, &voice);

        std::fs::create_dir(dir.join(".cache")).unwrap();
        assert!(read_installed_meta(&dir).is_some());
        std::fs::remove_dir(dir.join(".cache")).unwrap();

        std::fs::write(dir.join(".cache"), b"not a directory").unwrap();
        assert!(
            read_installed_meta(&dir).is_none(),
            "accepted a regular file as voice cache"
        );
        std::fs::remove_file(dir.join(".cache")).unwrap();

        #[cfg(unix)]
        {
            let outside = root.path().join("outside-cache");
            std::fs::create_dir(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, dir.join(".cache")).unwrap();
            assert!(
                read_installed_meta(&dir).is_none(),
                "accepted a symlink as voice cache"
            );
        }
    }

    #[test]
    fn download_voice_is_selected_by_id_from_validated_manifest() {
        let manifest = built_in_manifest();

        let selected = trusted_voice_entry(&manifest, "vits-mms-spa").unwrap();
        assert_eq!(selected.id, "vits-mms-spa");
        assert_eq!(
            selected.url,
            "https://github.com/k7tmiz/a4-tts-voices/releases/download/v1/vits-mms-spa.tar.bz2"
        );
        assert!(trusted_voice_entry(&manifest, "unknown-voice").is_err());
        assert!(trusted_voice_entry(&manifest, "../outside").is_err());
    }

    #[test]
    fn download_size_checks_reject_headers_streams_and_eof_mismatching_manifest() {
        let expected = 10;
        assert!(validate_download_length_header(None, expected).is_ok());
        assert!(validate_download_length_header(Some(expected), expected).is_ok());
        assert!(validate_download_length_header(Some(expected + 1), expected).is_err());
        assert!(validate_download_length_header(Some(expected - 1), expected).is_err());

        assert_eq!(
            checked_download_size_after_chunk(4, 6, expected).unwrap(),
            10
        );
        assert!(checked_download_size_after_chunk(9, 2, expected).is_err());
        assert!(checked_download_size_after_chunk(
            MAX_VOICE_ARCHIVE_BYTES,
            1,
            MAX_VOICE_ARCHIVE_BYTES
        )
        .is_err());

        assert!(validate_download_complete(expected, expected).is_ok());
        assert!(validate_download_complete(expected - 1, expected).is_err());
    }

    #[test]
    fn archive_install_writes_metadata_only_after_declared_assets_exist() {
        let root = TestDir::new();
        let mut voice = built_in_manifest().voices.remove(0);
        voice.id = "archive-test-voice".into();
        voice.model = "assets/model.onnx".into();
        voice.tokens = "assets/tokens.txt".into();
        voice.lexicon = Some("assets/lexicon.txt".into());
        voice.data_dir = Some("assets/espeak-data".into());
        let archive_path = root.path().join("voice.tar.bz2");
        let dest = root.path().join(&voice.id);

        write_test_archive(
            &archive_path,
            &[
                ("assets/model.onnx", &b"model"[..]),
                ("assets/tokens.txt", &b"tokens"[..]),
                ("assets/lexicon.txt", &b"lexicon"[..]),
                ("assets/espeak-data/phonemes", &b"data"[..]),
            ],
        );
        extract_validate_and_write_metadata(&archive_path, &dest, &voice).unwrap();
        assert_eq!(read_installed_meta(&dest).unwrap().id, voice.id);

        std::fs::remove_dir_all(&dest).unwrap();
        write_test_archive(&archive_path, &[("assets/model.onnx", &b"model"[..])]);
        let result = extract_validate_and_write_metadata(&archive_path, &dest, &voice);
        assert!(result.is_err());
        assert!(!dest.join("voice.json").exists());
        remove_path(&dest).unwrap();
        assert!(!dest.exists());

        std::fs::write(&archive_path, b"not a tar.bz2").unwrap();
        let result = extract_validate_and_write_metadata(&archive_path, &dest, &voice);
        assert!(result.is_err());
        remove_path(&dest).unwrap();
        assert!(!dest.exists());
    }

    #[test]
    fn validated_voice_can_be_built_in_sibling_staging_before_final_rename() {
        let root = TestDir::new();
        let mut voice = built_in_manifest().voices.remove(1);
        voice.id = "staged-voice".into();
        voice.model = "model.onnx".into();
        voice.tokens = "tokens.txt".into();
        let archive = root.path().join("staged.tar.bz2");
        write_test_archive(
            &archive,
            &[
                ("model.onnx", &b"model"[..]),
                ("tokens.txt", &b"tokens"[..]),
            ],
        );

        let staging = root.path().join(".install-staged-voice-123");
        extract_validate_and_write_metadata(&archive, &staging, &voice).unwrap();
        assert!(staging.join("voice.json").is_file());
        assert!(read_installed_meta(&staging).is_none());

        let installed = root.path().join(&voice.id);
        std::fs::rename(&staging, &installed).unwrap();
        assert_eq!(read_installed_meta(&installed).unwrap().id, voice.id);
    }

    #[test]
    fn safe_archive_extraction_enforces_expanded_bytes_and_entry_count() {
        let root = TestDir::new();
        let archive = root.path().join("limits.tar.bz2");
        write_test_archive(
            &archive,
            &[("first.bin", &b"1234"[..]), ("second.bin", &b"5678"[..])],
        );

        let dest = root.path().join("bytes-limit");
        assert!(extract_tar_bz2_with_limits(&archive, &dest, 7, 10).is_err());

        let dest = root.path().join("entry-limit");
        assert!(extract_tar_bz2_with_limits(&archive, &dest, 100, 1).is_err());

        let dest = root.path().join("within-limits");
        extract_tar_bz2_with_limits(&archive, &dest, 8, 2).unwrap();
        assert_eq!(std::fs::read(dest.join("first.bin")).unwrap(), b"1234");
        assert_eq!(std::fs::read(dest.join("second.bin")).unwrap(), b"5678");
    }

    #[test]
    fn safe_archive_extraction_rejects_links_special_types_and_unsafe_paths() {
        for unsafe_path in [
            "/absolute/model.onnx",
            "../outside",
            "assets/../../outside",
            r"assets\model.onnx",
            ".tmp/archive",
            ".cache/archive",
            "voice.json",
            ".voice.json.tmp",
        ] {
            assert!(
                validate_archive_entry_path(Path::new(unsafe_path)).is_err(),
                "accepted unsafe tar path {unsafe_path}"
            );
        }
        assert!(validate_archive_entry_path(Path::new("assets/model.onnx")).is_ok());

        let root = TestDir::new();
        for (index, entry_type) in [
            tar::EntryType::Symlink,
            tar::EntryType::Link,
            tar::EntryType::Char,
            tar::EntryType::Block,
            tar::EntryType::Fifo,
            tar::EntryType::Continuous,
        ]
        .into_iter()
        .enumerate()
        {
            let archive = root.path().join(format!("unsafe-{index}.tar.bz2"));
            write_test_archive_entry_type(&archive, entry_type);
            let dest = root.path().join(format!("unsafe-{index}"));
            assert!(
                extract_tar_bz2_with_limits(&archive, &dest, 1_024, 10).is_err(),
                "accepted unsafe tar entry type {entry_type:?}"
            );
        }

        let long_name = format!("assets/{}/model.onnx", "long".repeat(30));
        let archive = root.path().join("gnu-long-name.tar.bz2");
        write_test_archive(&archive, &[(long_name.as_str(), &b"model"[..])]);
        let dest = root.path().join("gnu-long-name");
        extract_tar_bz2_with_limits(&archive, &dest, 1_024, 10).unwrap();
        assert!(dest.join(long_name).is_file());
    }

    #[test]
    fn staged_preparation_failure_preserves_existing_voice_and_cleans_workspace() {
        let root = TestDir::new();
        let voice_id = "transaction-voice";
        let installed = root.path().join(voice_id);
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::write(installed.join("old-marker"), b"old").unwrap();

        let workspace = create_install_workspace(root.path(), voice_id).unwrap();
        assert_eq!(workspace.staging_dir.parent(), Some(root.path()));
        assert_eq!(workspace.archive_path.parent(), Some(root.path()));
        assert_eq!(workspace.backup_dir.parent(), Some(root.path()));
        std::fs::write(workspace.staging_dir.join("partial"), b"partial").unwrap();
        std::fs::write(&workspace.archive_path, b"partial archive").unwrap();

        let result: Result<(), String> = Err("download failed".into());
        assert!(cleanup_staging_on_error(&workspace, result).is_err());
        assert_eq!(std::fs::read(installed.join("old-marker")).unwrap(), b"old");
        assert!(!workspace.staging_dir.exists());
        assert!(!workspace.archive_path.exists());
        assert!(!workspace.backup_dir.exists());
    }

    #[test]
    fn staged_swap_restores_old_voice_when_install_rename_fails() {
        let root = TestDir::new();
        let voice_id = "swap-failure-voice";
        let installed = root.path().join(voice_id);
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::write(installed.join("marker"), b"old").unwrap();
        let workspace = create_install_workspace(root.path(), voice_id).unwrap();
        std::fs::write(workspace.staging_dir.join("marker"), b"new").unwrap();

        let mut rename_calls = 0usize;
        let result = commit_staged_voice_with_ops(
            &workspace.staging_dir,
            &installed,
            &workspace.backup_dir,
            |from, to| {
                rename_calls += 1;
                if rename_calls == 2 {
                    return Err(std::io::Error::other("injected install rename failure"));
                }
                std::fs::rename(from, to)
            },
            remove_path,
        );

        assert!(result.is_err());
        assert_eq!(std::fs::read(installed.join("marker")).unwrap(), b"old");
        assert_eq!(
            std::fs::read(workspace.staging_dir.join("marker")).unwrap(),
            b"new"
        );
        assert!(!workspace.backup_dir.exists());
    }

    #[test]
    fn staged_swap_keeps_committed_voice_when_backup_cleanup_fails() {
        let root = TestDir::new();
        let voice_id = "swap-cleanup-voice";
        let installed = root.path().join(voice_id);
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::write(installed.join("marker"), b"old").unwrap();
        let workspace = create_install_workspace(root.path(), voice_id).unwrap();
        std::fs::write(workspace.staging_dir.join("marker"), b"new").unwrap();

        let mut rename_calls = 0usize;
        let result = commit_staged_voice_with_ops(
            &workspace.staging_dir,
            &installed,
            &workspace.backup_dir,
            |from, to| {
                rename_calls += 1;
                std::fs::rename(from, to)
            },
            |backup| {
                std::fs::remove_file(backup.join("marker"))?;
                Err(std::io::Error::other(
                    "injected partial backup cleanup failure",
                ))
            },
        );

        assert!(result.is_ok());
        assert_eq!(rename_calls, 2, "must not roll back after commit");
        assert_eq!(std::fs::read(installed.join("marker")).unwrap(), b"new");
        assert!(!workspace.staging_dir.exists());
        assert!(workspace.backup_dir.exists());
        assert!(!workspace.backup_dir.join("marker").exists());
    }

    #[test]
    fn staged_swap_replaces_old_voice_and_removes_backup_on_success() {
        let root = TestDir::new();
        let voice_id = "swap-success-voice";
        let installed = root.path().join(voice_id);
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::write(installed.join("marker"), b"old").unwrap();
        let workspace = create_install_workspace(root.path(), voice_id).unwrap();
        std::fs::write(workspace.staging_dir.join("marker"), b"new").unwrap();

        commit_staged_voice_with_ops(
            &workspace.staging_dir,
            &installed,
            &workspace.backup_dir,
            |from, to| std::fs::rename(from, to),
            remove_path,
        )
        .unwrap();

        assert_eq!(std::fs::read(installed.join("marker")).unwrap(), b"new");
        assert!(!workspace.staging_dir.exists());
        assert!(!workspace.backup_dir.exists());
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn reinstall_removes_same_voice_from_desktop_engine_cache() {
        struct DropProbe(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for DropProbe {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }

        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cache = Mutex::new(HashMap::from([(
            "voice-id".to_string(),
            DropProbe(dropped.clone()),
        )]));
        assert!(remove_cached_voice_from_map(&cache, "voice-id"));
        assert!(!cache.lock().contains_key("voice-id"));
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[cfg(not(target_os = "android"))]
    #[tokio::test]
    async fn voice_operation_locks_serialize_same_voice_only() {
        let first = offline_voice_operation_lock("lock-test-same");
        let same = offline_voice_operation_lock("lock-test-same");
        let different = offline_voice_operation_lock("lock-test-different");
        assert!(std::sync::Arc::ptr_eq(&first, &same));
        assert!(!std::sync::Arc::ptr_eq(&first, &different));

        let guard = first.lock().await;
        assert!(same.try_lock().is_err());
        assert!(different.try_lock().is_ok());
        drop(guard);
        assert!(same.try_lock().is_ok());
    }

    #[test]
    fn orphaned_voice_backup_is_restored_and_later_backups_are_cleaned() {
        let root = TestDir::new();
        let voice_id = "backup-recovery-voice";
        let installed = root.path().join(voice_id);
        write_valid_voice_dir(&installed, voice_id);
        let orphaned = root.path().join(format!(".backup-{voice_id}-1-100-0"));
        std::fs::rename(&installed, &orphaned).unwrap();

        recover_or_cleanup_voice_backups(root.path(), voice_id).unwrap();
        assert_eq!(read_installed_meta(&installed).unwrap().id, voice_id);
        assert!(!orphaned.exists());

        let stale = root.path().join(format!(".backup-{voice_id}-1-200-0"));
        write_valid_voice_dir(&stale, voice_id);
        recover_or_cleanup_voice_backups(root.path(), voice_id).unwrap();
        assert_eq!(read_installed_meta(&installed).unwrap().id, voice_id);
        assert!(!stale.exists());
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn wav_header_describes_signed_16_bit_mono_pcm() {
        let sample_rate = 16_000;
        let wav = pcm_f32_to_wav_bytes(sample_rate, &[-0.5, 0.5]);

        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 40);
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes(wav[16..20].try_into().unwrap()), 16);
        assert_eq!(u16::from_le_bytes(wav[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(wav[24..28].try_into().unwrap()),
            sample_rate
        );
        assert_eq!(
            u32::from_le_bytes(wav[28..32].try_into().unwrap()),
            sample_rate * 2
        );
        assert_eq!(u16::from_le_bytes(wav[32..34].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(wav[34..36].try_into().unwrap()), 16);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 4);

        let negative = i16::from_le_bytes(wav[44..46].try_into().unwrap());
        let positive = i16::from_le_bytes(wav[46..48].try_into().unwrap());
        assert!(negative < 0);
        assert!(positive > 0);
    }
}
