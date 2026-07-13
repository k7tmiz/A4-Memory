use std::net::IpAddr;
use tauri_plugin_opener::OpenerExt;

mod offline_tts;

fn is_blocked_host(host: &str) -> bool {
    let h = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_lowercase();

    if h == "localhost" || h == "0.0.0.0" || h == "::1" {
        return true;
    }

    if let Ok(ip) = h.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
                    || v4.is_documentation()
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || v6.is_multicast()
                    || {
                        let segs = v6.segments();
                        segs[0] & 0xfe00 == 0xfc00
                    }
                    || v6
                        .to_ipv4()
                        .map(|v4| {
                            v4.is_loopback()
                                || v4.is_private()
                                || v4.is_link_local()
                                || v4.is_broadcast()
                                || v4.is_unspecified()
                                || v4.is_documentation()
                        })
                        .unwrap_or(false)
            }
        };
    }

    if let Some(decimal) = h
        .split(':')
        .next()
        .unwrap_or(&h)
        .parse::<u64>()
        .ok()
        .filter(|n| *n <= u32::MAX as u64)
    {
        let ip = IpAddr::from((decimal as u32).to_be_bytes());
        return is_blocked_host(&ip.to_string());
    }

    if h.starts_with("0x") {
        if let Ok(n) = u128::from_str_radix(&h[2..], 16) {
            let ip = IpAddr::from(n.to_be_bytes());
            return is_blocked_host(&ip.to_string());
        }
    }

    h.starts_with("127.")
        || h.starts_with("192.168.")
        || h.starts_with("10.")
        || (h.starts_with("172.") && {
            let parts: Vec<&str> = h.trim_start_matches("172.").split('.').collect();
            parts
                .get(0)
                .and_then(|p| p.parse::<u8>().ok())
                .map_or(false, |n| n >= 16 && n <= 31)
        })
        || h.starts_with("169.254.")
}

#[tauri::command]
fn a4_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let target = url.trim();

    if !(target.starts_with("https://") || target.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened externally.".into());
    }

    let after_scheme = target
        .strip_prefix("https://")
        .or_else(|| target.strip_prefix("http://"))
        .unwrap_or(target);

    let host = after_scheme
        .split(|c: char| c == '/' || c == ':')
        .next()
        .unwrap_or(after_scheme)
        .split('@')
        .last()
        .unwrap_or(after_scheme);

    if is_blocked_host(host) {
        return Err("Cannot open private or localhost URLs.".into());
    }

    app.opener()
        .open_url(target, None::<&str>)
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_print(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel::<String>();

    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |mut env, activity, webview| {
                let status = (|| -> Result<String, String> {
                    let print_service = env.new_string("print").map_err(|e| e.to_string())?;
                    let print_service_obj = JObject::from(print_service);
                    let print_manager = env
                        .call_method(
                            activity,
                            "getSystemService",
                            "(Ljava/lang/String;)Ljava/lang/Object;",
                            &[JValue::Object(&print_service_obj)],
                        )
                        .map_err(|e| e.to_string())?
                        .l()
                        .map_err(|e| e.to_string())?;

                    let job_name = env.new_string("A4 Memory").map_err(|e| e.to_string())?;
                    let job_name_obj = JObject::from(job_name);
                    let adapter = env
                        .call_method(
                            webview,
                            "createPrintDocumentAdapter",
                            "(Ljava/lang/String;)Landroid/print/PrintDocumentAdapter;",
                            &[JValue::Object(&job_name_obj)],
                        )
                        .map_err(|e| e.to_string())?
                        .l()
                        .map_err(|e| e.to_string())?;
                    let attrs = JObject::null();

                    env.call_method(
                        print_manager,
                        "print",
                        "(Ljava/lang/String;Landroid/print/PrintDocumentAdapter;Landroid/print/PrintAttributes;)Landroid/print/PrintJob;",
                        &[
                            JValue::Object(&job_name_obj),
                            JValue::Object(&adapter),
                            JValue::Object(&attrs),
                        ],
                    )
                    .map_err(|e| e.to_string())?;

                    Ok("printed".into())
                })();
                let exception = take_java_exception(&mut env);
                let _ = tx.send(
                    exception
                        .map(|e| format!("error:{e}"))
                        .unwrap_or_else(|| status.unwrap_or_else(|e| format!("error:{e}"))),
                );
            });
        })
        .map_err(|err| err.to_string())?;

    let status = rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Android print bridge timed out.".to_string())?;
    match status.as_str() {
        "printed" => Ok(()),
        _ if status.starts_with("error:") => Err(status.trim_start_matches("error:").to_string()),
        _ => Ok(()),
    }
}

#[cfg(target_os = "android")]
fn take_java_exception(env: &mut jni::JNIEnv<'_>) -> Option<String> {
    if !env.exception_check().unwrap_or(false) {
        return None;
    }

    let throwable = match env.exception_occurred() {
        Ok(throwable) => throwable,
        Err(_) => {
            let _ = env.exception_clear();
            return Some("Java exception was thrown".into());
        }
    };
    let _ = env.exception_clear();
    let message = (|| {
        let text_obj = env
            .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
            .ok()?
            .l()
            .ok()?;
        if text_obj.is_null() {
            return None;
        }
        let text_jstring = jni::objects::JString::from(text_obj);
        env.get_string(&text_jstring)
            .ok()
            .map(|s| s.to_string_lossy().into_owned())
    })()
    .unwrap_or_else(|| "Java exception was thrown".into());
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    Some(message)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_save_text_file(
    webview_window: tauri::WebviewWindow,
    filename: String,
    mime: String,
    content: String,
) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use std::sync::mpsc;
    use std::time::Duration;

    let filename = filename.trim().to_string();
    let mime = mime.trim().to_string();

    let (tx, rx) = mpsc::channel::<String>();

    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |mut env, activity, _webview| {
                let status = (|| -> Result<String, String> {
                    let filename_string = env.new_string(&filename).map_err(|e| e.to_string())?;
                    let filename_obj = JObject::from(filename_string);
                    let mime_string = env
                        .new_string(if mime.is_empty() {
                            "text/plain;charset=utf-8"
                        } else {
                            &mime
                        })
                        .map_err(|e| e.to_string())?;
                    let mime_obj = JObject::from(mime_string);
                    let content_string = env.new_string(&content).map_err(|e| e.to_string())?;
                    let content_obj = JObject::from(content_string);

                    let result = env.call_static_method(
                        "app/tauri/A4SpeechBridge",
                        "saveTextFile",
                        "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                        &[
                            JValue::Object(activity),
                            JValue::Object(&filename_obj),
                            JValue::Object(&mime_obj),
                            JValue::Object(&content_obj),
                        ],
                    ).map_err(|e| e.to_string())?;

                    let result_obj = result.l().map_err(|e| e.to_string())?;
                    if result_obj.is_null() {
                        return Ok("saved".into());
                    }
                    let result_jstring = jni::objects::JString::from(result_obj);
                    let result_str = env
                        .get_string(&result_jstring)
                        .map_err(|e| e.to_string())?;
                    Ok(result_str.to_string_lossy().into_owned())
                })();

                let exception = take_java_exception(&mut env);
                let _ = tx.send(
                    exception
                        .map(|e| format!("error:{e}"))
                        .unwrap_or_else(|| status.unwrap_or_else(|e| format!("error:{e}"))),
                );
            });
        })
        .map_err(|err| err.to_string())?;

    let status = rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Android file export bridge timed out.".to_string())?;
    match status.as_str() {
        "saved" => Ok(()),
        _ if status.starts_with("error:") => Err(status.trim_start_matches("error:").to_string()),
        _ => Ok(()),
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_speak(
    webview_window: tauri::WebviewWindow,
    text: String,
    lang: String,
) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use std::sync::mpsc;
    use std::time::Duration;

    let text = text.trim().to_string();
    let lang = lang.trim().to_string();

    let (tx, rx) = mpsc::channel::<String>();

    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |mut env, activity, _webview| {
                let status = (|| -> Result<String, String> {
                    let speech_text = env.new_string(&text).map_err(|e| e.to_string())?;
                    let text_obj = JObject::from(speech_text);
                    let lang_tag = if lang.is_empty() { "en-US" } else { &lang };
                    let lang_string = env.new_string(lang_tag).map_err(|e| e.to_string())?;
                    let lang_obj = JObject::from(lang_string);

                    let result = env.call_static_method(
                        "app/tauri/A4SpeechBridge",
                        "speak",
                        "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                        &[
                            JValue::Object(activity),
                            JValue::Object(&text_obj),
                            JValue::Object(&lang_obj),
                        ],
                    ).map_err(|e| e.to_string())?;

                    let result_obj = result.l().map_err(|e| e.to_string())?;
                    if result_obj.is_null() {
                        return Ok("queued".into());
                    }
                    let result_jstring = jni::objects::JString::from(result_obj);
                    let result_str = env
                        .get_string(&result_jstring)
                        .map_err(|e| e.to_string())?;
                    Ok(result_str.to_string_lossy().into_owned())
                })();

                let exception = take_java_exception(&mut env);
                let _ = tx.send(
                    exception
                        .map(|e| format!("error:{e}"))
                        .unwrap_or_else(|| status.unwrap_or_else(|e| format!("error:{e}"))),
                );
            });
        })
        .map_err(|err| err.to_string())?;

    let status = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Android TTS bridge timed out.".to_string())?;
    match status.as_str() {
        "queued" | "empty" => Ok(()),
        _ if status.starts_with("error:") => Err(status.trim_start_matches("error:").to_string()),
        _ => Ok(()),
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_print(_webview_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Android print is only available on Android builds.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_save_text_file(
    _webview_window: tauri::WebviewWindow,
    _filename: String,
    _mime: String,
    _content: String,
) -> Result<(), String> {
    Err("Android file export is only available on Android builds.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_speak(
    _webview_window: tauri::WebviewWindow,
    _text: String,
    _lang: String,
) -> Result<(), String> {
    Err("Android TextToSpeech is only available on Android builds.".into())
}

#[cfg(target_os = "android")]
enum AndroidOfflineBridgeCall {
    Start {
        text: String,
        voice_id: String,
        voice_dir: String,
        request_id: String,
    },
    TakeResult {
        request_id: String,
    },
    CancelRequest {
        request_id: String,
    },
    CompleteRequest {
        request_id: String,
    },
    ClearVoice {
        voice_id: String,
        request_id: String,
    },
}

#[cfg(target_os = "android")]
fn call_android_offline_bridge(
    webview_window: tauri::WebviewWindow,
    call: AndroidOfflineBridgeCall,
) -> Result<String, String> {
    use jni::objects::{JObject, JValue};

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |mut env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let result = match call {
                        AndroidOfflineBridgeCall::Start {
                            text,
                            voice_id,
                            voice_dir,
                            request_id,
                        } => {
                            let jtext = JObject::from(
                                env.new_string(&text).map_err(|e| e.to_string())?,
                            );
                            let jvoice_id = JObject::from(
                                env.new_string(&voice_id).map_err(|e| e.to_string())?,
                            );
                            let jvoice_dir = JObject::from(
                                env.new_string(&voice_dir).map_err(|e| e.to_string())?,
                            );
                            let jrequest_id = JObject::from(
                                env.new_string(&request_id).map_err(|e| e.to_string())?,
                            );
                            env.call_static_method(
                                "app/tauri/A4OfflineTtsBridge",
                                "startSpeak",
                                "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                                &[
                                    JValue::Object(activity),
                                    JValue::Object(&jtext),
                                    JValue::Object(&jvoice_id),
                                    JValue::Object(&jvoice_dir),
                                    JValue::Object(&jrequest_id),
                                ],
                            )
                            .map_err(|e| e.to_string())?
                        }
                        AndroidOfflineBridgeCall::TakeResult { request_id } => {
                            let jrequest_id = JObject::from(
                                env.new_string(&request_id).map_err(|e| e.to_string())?,
                            );
                            env.call_static_method(
                                "app/tauri/A4OfflineTtsBridge",
                                "takeResult",
                                "(Ljava/lang/String;)Ljava/lang/String;",
                                &[JValue::Object(&jrequest_id)],
                            )
                            .map_err(|e| e.to_string())?
                        }
                        AndroidOfflineBridgeCall::CancelRequest { request_id } => {
                            let jrequest_id = JObject::from(
                                env.new_string(&request_id).map_err(|e| e.to_string())?,
                            );
                            env.call_static_method(
                                "app/tauri/A4OfflineTtsBridge",
                                "cancelRequest",
                                "(Ljava/lang/String;)Ljava/lang/String;",
                                &[JValue::Object(&jrequest_id)],
                            )
                            .map_err(|e| e.to_string())?
                        }
                        AndroidOfflineBridgeCall::CompleteRequest { request_id } => {
                            let jrequest_id = JObject::from(
                                env.new_string(&request_id).map_err(|e| e.to_string())?,
                            );
                            env.call_static_method(
                                "app/tauri/A4OfflineTtsBridge",
                                "completeRequest",
                                "(Ljava/lang/String;)Ljava/lang/String;",
                                &[JValue::Object(&jrequest_id)],
                            )
                            .map_err(|e| e.to_string())?
                        }
                        AndroidOfflineBridgeCall::ClearVoice {
                            voice_id,
                            request_id,
                        } => {
                            let jvoice_id = JObject::from(
                                env.new_string(&voice_id).map_err(|e| e.to_string())?,
                            );
                            let jrequest_id = JObject::from(
                                env.new_string(&request_id).map_err(|e| e.to_string())?,
                            );
                            env.call_static_method(
                                "app/tauri/A4OfflineTtsBridge",
                                "clearVoice",
                                "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                                &[
                                    JValue::Object(&jvoice_id),
                                    JValue::Object(&jrequest_id),
                                ],
                            )
                            .map_err(|e| e.to_string())?
                        }
                    };

                    let result_obj = result.l().map_err(|e| e.to_string())?;
                    if result_obj.is_null() {
                        return Err("A4OfflineTtsBridge returned null".into());
                    }
                    let result_jstring = jni::objects::JString::from(result_obj);
                    let result_str = env
                        .get_string(&result_jstring)
                        .map_err(|e| e.to_string())?;
                    Ok(result_str.to_string_lossy().into_owned())
                })();

                let exception = take_java_exception(&mut env);
                let _ = tx.send(
                    exception
                        .map(|e| format!("error:{e}"))
                        .unwrap_or_else(|| result.unwrap_or_else(|e| format!("error:{e}"))),
                );
            });
        })
        .map_err(|err| err.to_string())?;

    rx.recv_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "Android offline TTS JNI call timed out.".to_string())
}

#[cfg(target_os = "android")]
fn next_android_offline_request_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};

    static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
    format!(
        "{}-{}",
        std::process::id(),
        REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(target_os = "android")]
fn synthesize_android_offline(
    webview_window: tauri::WebviewWindow,
    voice_dir: std::path::PathBuf,
    text: String,
    voice_id: String,
) -> Result<offline_tts::OfflineSpeakResult, String> {
    let request_id = next_android_offline_request_id();
    let synthesis_result = (|| -> Result<offline_tts::OfflineSpeakResult, String> {
        let status = call_android_offline_bridge(
            webview_window.clone(),
            AndroidOfflineBridgeCall::Start {
                text,
                voice_id,
                voice_dir: voice_dir.to_string_lossy().into_owned(),
                request_id: request_id.clone(),
            },
        )?;
        if status != "queued" {
            return Err(status.strip_prefix("error:").unwrap_or(&status).to_string());
        }

        let queue_deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        let mut running_deadline = None;
        let status = loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let polled = call_android_offline_bridge(
                webview_window.clone(),
                AndroidOfflineBridgeCall::TakeResult {
                    request_id: request_id.clone(),
                },
            )?;
            match polled.as_str() {
                "queued" => {
                    if std::time::Instant::now() >= queue_deadline {
                        return Err("Android offline TTS queue timed out.".into());
                    }
                }
                "running" => {
                    let deadline = running_deadline.get_or_insert_with(|| {
                        std::time::Instant::now() + std::time::Duration::from_secs(90)
                    });
                    if std::time::Instant::now() >= *deadline {
                        return Err("Android offline TTS synthesis timed out.".into());
                    }
                }
                _ => break polled,
            }
        };

        if status.starts_with("error:") {
            return Err(status.trim_start_matches("error:").to_string());
        }

        #[derive(serde::Deserialize)]
        struct SpeakResult {
            ok: bool,
            sample_rate: Option<u32>,
            wav_path: Option<String>,
            error: Option<String>,
        }

        let result: SpeakResult =
            serde_json::from_str(&status).map_err(|e| format!("parse bridge result: {e}"))?;
        if !result.ok {
            return Err(result.error.unwrap_or_else(|| "unknown error".into()));
        }

        let wav_path = std::path::PathBuf::from(result.wav_path.ok_or("no wav_path in result")?);
        let canonical_wav = wav_path
            .canonicalize()
            .map_err(|e| format!("resolve wav path: {e}"))?;
        let canonical_cache = voice_dir
            .join(".cache")
            .canonicalize()
            .map_err(|e| format!("resolve wav cache: {e}"))?;
        if !canonical_wav.starts_with(&canonical_cache) {
            return Err("offline TTS returned a WAV path outside its cache".into());
        }

        let wav = std::fs::read(&canonical_wav).map_err(|e| format!("read wav: {e}"));
        let _ = std::fs::remove_file(&canonical_wav);
        let wav = wav?;
        if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
            return Err("offline TTS returned an invalid WAV file".into());
        }

        let completed = call_android_offline_bridge(
            webview_window.clone(),
            AndroidOfflineBridgeCall::CompleteRequest {
                request_id: request_id.clone(),
            },
        )?;
        if completed != "completed" {
            return Err(format!("Android offline TTS cleanup failed: {completed}"));
        }

        Ok(offline_tts::OfflineSpeakResult {
            ok: true,
            sample_rate: result.sample_rate.unwrap_or(0),
            wav,
            error: None,
        })
    })();

    if synthesis_result.is_err() {
        let _ = call_android_offline_bridge(
            webview_window,
            AndroidOfflineBridgeCall::CancelRequest { request_id },
        );
    }
    synthesis_result
}

#[cfg(target_os = "android")]
fn clear_android_offline_voice(
    webview_window: tauri::WebviewWindow,
    voice_id: String,
) -> Result<(), String> {
    let request_id = next_android_offline_request_id();
    let clear_result = (|| -> Result<(), String> {
        let status = call_android_offline_bridge(
            webview_window.clone(),
            AndroidOfflineBridgeCall::ClearVoice {
                voice_id,
                request_id: request_id.clone(),
            },
        )?;
        if status != "queued" {
            return Err(format!(
                "Android offline TTS engine cleanup failed: {}",
                status.strip_prefix("error:").unwrap_or(&status)
            ));
        }

        let queue_deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        let mut running_deadline = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let status = call_android_offline_bridge(
                webview_window.clone(),
                AndroidOfflineBridgeCall::TakeResult {
                    request_id: request_id.clone(),
                },
            )?;
            match status.as_str() {
                "queued" => {
                    if std::time::Instant::now() >= queue_deadline {
                        return Err("Android offline TTS engine cleanup queue timed out.".into());
                    }
                }
                "running" => {
                    let deadline = running_deadline.get_or_insert_with(|| {
                        std::time::Instant::now() + std::time::Duration::from_secs(30)
                    });
                    if std::time::Instant::now() >= *deadline {
                        return Err("Android offline TTS engine cleanup timed out.".into());
                    }
                }
                "cleared" => break,
                _ => {
                    return Err(format!(
                        "Android offline TTS engine cleanup failed: {}",
                        status.strip_prefix("error:").unwrap_or(&status)
                    ));
                }
            }
        }

        let completed = call_android_offline_bridge(
            webview_window.clone(),
            AndroidOfflineBridgeCall::CompleteRequest {
                request_id: request_id.clone(),
            },
        )?;
        if completed != "completed" {
            return Err(format!(
                "Android offline TTS engine cleanup failed: {completed}"
            ));
        }
        Ok(())
    })();

    if clear_result.is_err() {
        let _ = call_android_offline_bridge(
            webview_window,
            AndroidOfflineBridgeCall::CancelRequest { request_id },
        );
    }
    clear_result
}

#[cfg(target_os = "android")]
fn android_offline_voice_lock(voice_id: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    use std::collections::HashMap;
    use std::sync::{Arc, OnceLock};

    type VoiceLocks = HashMap<String, Arc<tokio::sync::Mutex<()>>>;
    static LOCKS: OnceLock<parking_lot::Mutex<VoiceLocks>> = OnceLock::new();

    LOCKS
        .get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
        .lock()
        .entry(voice_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn a4_offline_voices_download(
    app: tauri::AppHandle,
    webview_window: tauri::WebviewWindow,
    voice_id: String,
    on_progress: tauri::ipc::Channel<offline_tts::DownloadProgress>,
) -> Result<(), String> {
    let voice_lock = android_offline_voice_lock(&voice_id);
    let voice_guard = voice_lock.lock_owned().await;
    let clear_voice_id = voice_id.clone();
    let voice_guard = tauri::async_runtime::spawn_blocking(move || {
        clear_android_offline_voice(webview_window, clear_voice_id)?;
        Ok::<_, String>(voice_guard)
    })
    .await
    .map_err(|e| format!("Android offline TTS cleanup worker failed: {e}"))??;
    let _voice_guard = voice_guard;
    offline_tts::a4_offline_voices_download(app, voice_id, on_progress).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn a4_offline_voices_delete(
    app: tauri::AppHandle,
    webview_window: tauri::WebviewWindow,
    voice_id: String,
) -> Result<(), String> {
    let voice_lock = android_offline_voice_lock(&voice_id);
    let voice_guard = voice_lock.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _voice_guard = voice_guard;
        clear_android_offline_voice(webview_window, voice_id.clone())?;
        offline_tts::a4_offline_voices_delete(app, voice_id)
    })
    .await
    .map_err(|e| format!("Android offline TTS delete worker failed: {e}"))?
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn a4_offline_speak(
    app: tauri::AppHandle,
    webview_window: tauri::WebviewWindow,
    text: String,
    voice_id: String,
) -> Result<offline_tts::OfflineSpeakResult, String> {
    let voice_lock = android_offline_voice_lock(&voice_id);
    let voice_guard = voice_lock.lock_owned().await;
    let dir = offline_tts::recover_voice_dir(&app, &voice_id)?;
    if offline_tts::read_installed_meta(&dir).is_none() {
        return Err("voice not installed".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _voice_guard = voice_guard;
        synthesize_android_offline(webview_window, dir, text, voice_id)
    })
    .await
    .map_err(|e| format!("Android offline TTS worker failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler({
            #[cfg(not(target_os = "android"))]
            {
                tauri::generate_handler![
                    a4_open_external,
                    a4_android_print,
                    a4_android_save_text_file,
                    a4_android_speak,
                    offline_tts::a4_offline_voices_manifest_url,
                    offline_tts::a4_offline_voices_manifest_fetch,
                    offline_tts::a4_offline_voices_installed,
                    offline_tts::a4_offline_voices_delete,
                    offline_tts::a4_offline_voices_download,
                    offline_tts::a4_offline_speak,
                ]
            }
            #[cfg(target_os = "android")]
            {
                tauri::generate_handler![
                    a4_open_external,
                    a4_android_print,
                    a4_android_save_text_file,
                    a4_android_speak,
                    offline_tts::a4_offline_voices_manifest_url,
                    offline_tts::a4_offline_voices_manifest_fetch,
                    offline_tts::a4_offline_voices_installed,
                    a4_offline_voices_delete,
                    a4_offline_voices_download,
                    a4_offline_speak,
                ]
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("[a4-memory] tauri runtime exited: {err}");
            std::process::exit(1);
        });
}
