use std::net::IpAddr;
use tauri_plugin_opener::OpenerExt;

fn is_blocked_host(host: &str) -> bool {
    let h = host.trim().trim_start_matches('[').trim_end_matches(']').to_lowercase();

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
                    || v6.to_ipv4().map(|v4| {
                        v4.is_loopback()
                            || v4.is_private()
                            || v4.is_link_local()
                            || v4.is_broadcast()
                            || v4.is_unspecified()
                            || v4.is_documentation()
                    }).unwrap_or(false)
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
    if !env.exception_check().ok()? {
        return None;
    }

    let throwable = env.exception_occurred().ok()?;
    let _ = env.exception_clear();
    let text_obj = env
        .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .ok()?
        .l()
        .ok()?;
    if text_obj.is_null() {
        return Some("Java exception was thrown".into());
    }

    let text_jstring = jni::objects::JString::from(text_obj);
    env.get_string(&text_jstring)
        .ok()
        .map(|s| s.to_string_lossy().into_owned())
        .or_else(|| Some("Java exception was thrown".into()))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            a4_open_external,
            a4_android_print,
            a4_android_save_text_file,
            a4_android_speak
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("[a4-memory] tauri runtime exited: {err}");
            std::process::exit(1);
        });
}
