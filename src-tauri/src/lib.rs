#[tauri::command]
fn a4_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let target = url.trim();
    if !(target.starts_with("https://") || target.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened externally.".into());
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
fn a4_android_speak(webview_window: tauri::WebviewWindow, text: String, lang: String) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use jni::objects::{JObject, JValue};

    let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let error_clone = error.clone();

    webview_window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _webview| {
                let fail = |msg: &str| {
                    *error_clone.lock().unwrap() = Some(msg.into());
                };

                let speech_text = match env.new_string(text.trim()) {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate text: {}", e)); return; }
                };
                let text_obj = JObject::from(speech_text);
                let lang_tag = if lang.trim().is_empty() { "en-US" } else { lang.trim() };
                let lang_string = match env.new_string(lang_tag) {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate lang: {}", e)); return; }
                };
                let lang_obj = JObject::from(lang_string);

                let result = match env.call_static_method(
                    "app/tauri/A4SpeechBridge",
                    "speak",
                    "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(activity), JValue::Object(&text_obj), JValue::Object(&lang_obj)],
                ) {
                    Ok(val) => match val.l() {
                        Ok(obj) => obj,
                        Err(e) => { fail(&format!("speak result error: {}", e)); return; }
                    },
                    Err(e) => {
                        if env.exception_check().unwrap_or(false) {
                            let _ = env.exception_clear();
                        }
                        fail(&format!("speak failed: {}", e));
                        return;
                    }
                };

                if !result.is_null() {
                    match env.get_string(&jni::objects::JString::from(result)) {
                        Ok(msg) => fail(&msg.to_string_lossy()),
                        Err(e) => fail(&format!("Android TTS failed: {}", e)),
                    }
                }
            })
        })
        .map_err(|err| err.to_string())?;

    if let Some(msg) = Arc::try_unwrap(error).unwrap().into_inner().unwrap() {
        return Err(msg);
    }

    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_print(_webview_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Android print is only available on Android builds.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_speak(_webview_window: tauri::WebviewWindow, _text: String, _lang: String) -> Result<(), String> {
    Err("Android TextToSpeech is only available on Android builds.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![a4_open_external, a4_android_print, a4_android_speak])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
