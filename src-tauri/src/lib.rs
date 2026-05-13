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
    let speech_text = text.trim().to_string();
    if speech_text.is_empty() {
        return Ok(());
    }

    let lang_tag = if lang.trim().is_empty() {
        "en-US".to_string()
    } else {
        lang.trim().to_string()
    };

    use std::sync::{Arc, Mutex};

    let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let error_clone = error.clone();

    webview_window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _webview| {
                let fail = |msg: &str| {
                    *error_clone.lock().unwrap() = Some(msg.into());
                };

                let tts = match env.new_object(
                    "android/speech/tts/TextToSpeech",
                    "(Landroid/content/Context;Landroid/speech/tts/TextToSpeech$OnInitListener;)V",
                    &[jni::objects::JValue::Object(activity), jni::objects::JValue::Object(&jni::objects::JObject::null())],
                ) {
                    Ok(obj) => obj,
                    Err(e) => { fail(&format!("failed to create TextToSpeech: {}", e)); return; }
                };

                let lang_string = match env.new_string(&lang_tag) {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate string: {}", e)); return; }
                };
                let lang_obj = jni::objects::JObject::from(lang_string);
                let locale = match env.call_static_method(
                    "java/util/Locale",
                    "forLanguageTag",
                    "(Ljava/lang/String;)Ljava/util/Locale;",
                    &[jni::objects::JValue::Object(&lang_obj)],
                ) {
                    Ok(val) => match val.l() {
                        Ok(obj) => obj,
                        Err(e) => { fail(&format!("Locale was not an object: {}", e)); return; }
                    },
                    Err(e) => { fail(&format!("failed to build Locale: {}", e)); return; }
                };

                let lang_result = match env.call_method(
                    &tts,
                    "setLanguage",
                    "(Ljava/util/Locale;)I",
                    &[jni::objects::JValue::Object(&locale)],
                ) {
                    Ok(val) => match val.i() {
                        Ok(i) => i,
                        Err(e) => { fail(&format!("setLanguage result error: {}", e)); return; }
                    },
                    Err(e) => { fail(&format!("setLanguage failed: {}", e)); return; }
                };
                if lang_result == -1 || lang_result == -2 {
                    fail("Android TTS language is not available");
                    return;
                }

                let text_string = match env.new_string(&speech_text) {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate text: {}", e)); return; }
                };
                let text_obj = jni::objects::JObject::from(text_string);
                let utterance_id = match env.new_string("a4-memory") {
                    Ok(s) => s,
                    Err(e) => { fail(&format!("failed to allocate id: {}", e)); return; }
                };
                let utterance_id_obj = jni::objects::JObject::from(utterance_id);
                let bundle = jni::objects::JObject::null();

                let speak_result = match env.call_method(
                    &tts,
                    "speak",
                    "(Ljava/lang/CharSequence;ILandroid/os/Bundle;Ljava/lang/String;)I",
                    &[
                        jni::objects::JValue::Object(&text_obj),
                        jni::objects::JValue::Int(0),
                        jni::objects::JValue::Object(&bundle),
                        jni::objects::JValue::Object(&utterance_id_obj),
                    ],
                ) {
                    Ok(val) => match val.i() {
                        Ok(i) => i,
                        Err(e) => { fail(&format!("speak result error: {}", e)); return; }
                    },
                    Err(e) => { fail(&format!("speak failed: {}", e)); return; }
                };
                if speak_result != 0 {
                    fail("Android TTS speak failed");
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
