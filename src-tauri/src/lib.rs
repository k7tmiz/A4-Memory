use tauri_plugin_shell::ShellExt;

fn is_blocked_host(host: &str) -> bool {
    let h = host.to_lowercase();
    h == "localhost"
        || h == "0.0.0.0"
        || h == "::1"
        || h == "[::1]"
        || h.starts_with("127.")
        || h.starts_with("192.168.")
        || h.starts_with("10.")
        || (h.starts_with("172.") && {
            let parts: Vec<&str> = h.trim_start_matches("172.").split('.').collect();
            parts.get(0)
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

    #[allow(deprecated)]
    app.shell()
        .open(target.to_string(), None)
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_print(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use std::sync::{Arc, Mutex};

    let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let error_clone = error.clone();

    webview_window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, webview| {
                let fail = |msg: &str| {
                    *error_clone.lock().unwrap() = Some(msg.into());
                };

                let print_service = match env.new_string("print") {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate string: {}", e)); return; }
                };
                let print_service_obj = JObject::from(print_service);
                let print_manager = match env.call_method(
                    activity,
                    "getSystemService",
                    "(Ljava/lang/String;)Ljava/lang/Object;",
                    &[JValue::Object(&print_service_obj)],
                ) {
                    Ok(val) => match val.l() {
                        Ok(obj) => obj,
                        Err(e) => { fail(&format!("print service error: {}", e)); return; }
                    },
                    Err(e) => { fail(&format!("getSystemService failed: {}", e)); return; }
                };

                let job_name = match env.new_string("A4 Memory") {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate string: {}", e)); return; }
                };
                let job_name_obj = JObject::from(job_name);
                let adapter = match env.call_method(
                    webview,
                    "createPrintDocumentAdapter",
                    "(Ljava/lang/String;)Landroid/print/PrintDocumentAdapter;",
                    &[JValue::Object(&job_name_obj)],
                ) {
                    Ok(val) => match val.l() {
                        Ok(obj) => obj,
                        Err(e) => { fail(&format!("print adapter error: {}", e)); return; }
                    },
                    Err(e) => { fail(&format!("createPrintDocumentAdapter failed: {}", e)); return; }
                };
                let attrs = JObject::null();

                if let Err(e) = env.call_method(
                    print_manager,
                    "print",
                    "(Ljava/lang/String;Landroid/print/PrintDocumentAdapter;Landroid/print/PrintAttributes;)Landroid/print/PrintJob;",
                    &[JValue::Object(&job_name_obj), JValue::Object(&adapter), JValue::Object(&attrs)],
                ) {
                    fail(&format!("print failed: {}", e));
                }
            })
        })
        .map_err(|err| err.to_string())?;

    if let Some(msg) = Arc::try_unwrap(error).unwrap().into_inner().unwrap() {
        return Err(msg);
    }

    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_speak(
    webview_window: tauri::WebviewWindow,
    text: String,
    lang: String,
    engine: Option<String>,
) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use std::sync::mpsc;
    use std::time::Duration;

    let text = text.trim().to_string();
    let lang = lang.trim().to_string();
    let engine = engine.unwrap_or_default().trim().to_string();

    let (tx, rx) = mpsc::channel::<String>();

    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |env, activity, _webview| {
                let status = (|| -> Result<String, String> {
                    let speech_text = env.new_string(&text).map_err(|e| e.to_string())?;
                    let text_obj = JObject::from(speech_text);
                    let lang_tag = if lang.is_empty() { "en-US" } else { &lang };
                    let lang_string = env.new_string(lang_tag).map_err(|e| e.to_string())?;
                    let lang_obj = JObject::from(lang_string);
                    let engine_string = env.new_string(&engine).map_err(|e| e.to_string())?;
                    let engine_obj = JObject::from(engine_string);

                    let result = env.call_static_method(
                        "app/tauri/A4SpeechBridge",
                        "speak",
                        "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                        &[
                            JValue::Object(activity),
                            JValue::Object(&text_obj),
                            JValue::Object(&lang_obj),
                            JValue::Object(&engine_obj),
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

                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                let _ = tx.send(status.unwrap_or_else(|e| format!("error:{e}")));
            });
        })
        .map_err(|err| err.to_string())?;

    let status = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Android TTS bridge timed out.".to_string())?;
    match status.as_str() {
        "queued" | "empty" => Ok(()),
        "install_started" => Err("请在系统安装器中安装 eSpeak NG，安装完成后再点一次发音。".into()),
        "install_permission_required" => Err("请先允许 A4 Memory 安装未知应用，然后返回再点一次发音。".into()),
        _ if status.starts_with("error:") => Err(status.trim_start_matches("error:").to_string()),
        _ => Ok(()),
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn a4_android_tts_engines(webview_window: tauri::WebviewWindow) -> Result<String, String> {
    use jni::objects::JValue;
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel::<String>();

    webview_window
        .with_webview(move |webview| {
            let jh = webview.jni_handle();
            jh.exec(move |env, activity, _webview| {
                let result = (|| -> Result<String, String> {
                    let value = env.call_static_method(
                        "app/tauri/A4SpeechBridge",
                        "listEngines",
                        "(Landroid/app/Activity;)Ljava/lang/String;",
                        &[JValue::Object(activity)],
                    ).map_err(|e| e.to_string())?;
                    let obj = value.l().map_err(|e| e.to_string())?;
                    if obj.is_null() {
                        return Err("empty engine list response".into());
                    }
                    let text_jstring = jni::objects::JString::from(obj);
                    let text = env
                        .get_string(&text_jstring)
                        .map_err(|e| e.to_string())?;
                    Ok(text.to_string_lossy().into_owned())
                })();

                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                let _ = tx.send(result.unwrap_or_else(|e| {
                    let escaped = e.replace('\\', "\\\\").replace('"', "\\\"");
                    format!(r#"{{"ok":false,"error":"{escaped}"}}"#)
                }));
            });
        })
        .map_err(|err| err.to_string())?;

    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Android TTS engine query timed out.".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_print(_webview_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Android print is only available on Android builds.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_speak(
    _webview_window: tauri::WebviewWindow,
    _text: String,
    _lang: String,
    _engine: Option<String>,
) -> Result<(), String> {
    Err("Android TextToSpeech is only available on Android builds.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_tts_engines(_webview_window: tauri::WebviewWindow) -> Result<String, String> {
    Err("Android TextToSpeech is only available on Android builds.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            a4_open_external,
            a4_android_print,
            a4_android_speak,
            a4_android_tts_engines
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
