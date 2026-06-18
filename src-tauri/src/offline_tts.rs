use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;

const MANIFEST_URL: &str = "https://tts.k7tmiz.com/voices/manifest.json";
const VOICES_SUBDIR: &str = "voices";

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

pub fn voice_dir(app: &AppHandle, voice_id: &str) -> Result<PathBuf, String> {
    Ok(voices_dir(app)?.join(voice_id))
}

fn dir_size_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    if !path.exists() {
        return 0;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size_bytes(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

pub fn read_installed_meta(dir: &Path) -> Option<OfflineVoiceEntry> {
    let raw = std::fs::read_to_string(dir.join("voice.json")).ok()?;
    serde_json::from_str::<OfflineVoiceEntry>(&raw).ok()
}

#[tauri::command]
pub fn a4_offline_voices_manifest_url() -> String {
    MANIFEST_URL.to_string()
}

#[tauri::command]
pub async fn a4_offline_voices_manifest_fetch() -> Result<OfflineManifest, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("manifest fetch: {e}"))?
        .error_for_status()
        .map_err(|e| format!("manifest status: {e}"))?;
    let manifest: OfflineManifest = resp
        .json()
        .await
        .map_err(|e| format!("manifest parse: {e}"))?;
    Ok(manifest)
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

#[tauri::command]
pub fn a4_offline_voices_delete(app: AppHandle, voice_id: String) -> Result<(), String> {
    let dir = voice_dir(&app, &voice_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove dir: {e}"))?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let cache = offline_engine_cache();
        let mut guard = cache.lock();
        guard.remove(&voice_id);
    }
    Ok(())
}

async fn fetch_with_progress(
    url: &str,
    dest: &Path,
    on_progress: &tauri::ipc::Channel<DownloadProgress>,
    voice_id: &str,
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
    let total = resp.content_length().unwrap_or(0);
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create file: {e}"))?;
    use tokio::io::AsyncWriteExt;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("write: {e}"))?;
        downloaded += bytes.len() as u64;
        if last_emit.elapsed() > std::time::Duration::from_millis(200) || total == 0 {
            let _ = on_progress.send(DownloadProgress {
                voice_id: voice_id.to_string(),
                downloaded,
                total,
                phase: "downloading".into(),
            });
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    file.sync_all().await.map_err(|e| format!("sync: {e}"))?;
    Ok(downloaded)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    use sha2::Digest;
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

fn extract_tar_bz2(archive: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let bz2 = bzip2::read::BzDecoder::new(f);
    let mut tar = tar::Archive::new(bz2);
    tar.unpack(dest).map_err(|e| format!("unpack: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn a4_offline_voices_download(
    app: AppHandle,
    voice: OfflineVoiceEntry,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    let voice_id = voice.id.clone();
    let dest_dir = voice_dir(&app, &voice_id)?;
    if dest_dir.exists() {
        let _ = std::fs::remove_dir_all(&dest_dir);
    }
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("mkdir dest: {e}"))?;
    let tmp_dir = dest_dir.join(".tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir tmp: {e}"))?;

    let archive_path = tmp_dir.join("voice.tar.bz2");
    let _ = on_progress.send(DownloadProgress {
        voice_id: voice_id.clone(),
        downloaded: 0,
        total: voice.size,
        phase: "downloading".into(),
    });
    fetch_with_progress(&voice.url, &archive_path, &on_progress, &voice_id).await?;

    let _ = on_progress.send(DownloadProgress {
        voice_id: voice_id.clone(),
        downloaded: voice.size,
        total: voice.size,
        phase: "verifying".into(),
    });
    let actual_sha = sha256_file(&archive_path)?;
    let expected_sha = voice.sha256.to_lowercase();
    if actual_sha != expected_sha {
        let _ = std::fs::remove_dir_all(&dest_dir);
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
    extract_tar_bz2(&archive_path, &dest_dir)?;

    let _ = std::fs::remove_dir_all(&tmp_dir);

    let meta_json = serde_json::to_string_pretty(&voice).map_err(|e| e.to_string())?;
    std::fs::write(dest_dir.join("voice.json"), meta_json)
        .map_err(|e| format!("write meta: {e}"))?;

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
fn offline_engine_cache() -> &'static Mutex<EngineMap> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<EngineMap>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

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
    out.extend_from_slice(&bytes_per_sample.to_le_bytes());
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
    let dir = voice_dir(&app, &voice_id)?;
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
