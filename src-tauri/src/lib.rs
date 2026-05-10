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

    webview_window
        .with_webview(|webview| {
            webview.jni_handle().exec(|env, activity, webview| {
                let print_service = env
                    .new_string("print")
                    .expect("failed to allocate print service name");
                let print_service_obj = JObject::from(print_service);
                let print_manager = env
                    .call_method(
                        activity,
                        "getSystemService",
                        "(Ljava/lang/String;)Ljava/lang/Object;",
                        &[JValue::Object(&print_service_obj)],
                    )
                    .expect("failed to get Android print service")
                    .l()
                    .expect("Android print service was not an object");

                let job_name = env
                    .new_string("A4 Memory")
                    .expect("failed to allocate print job name");
                let job_name_obj = JObject::from(job_name);
                let adapter = env
                    .call_method(
                        webview,
                        "createPrintDocumentAdapter",
                        "(Ljava/lang/String;)Landroid/print/PrintDocumentAdapter;",
                        &[JValue::Object(&job_name_obj)],
                    )
                    .expect("failed to create Android print adapter")
                    .l()
                    .expect("Android print adapter was not an object");
                let attrs = JObject::null();

                env.call_method(
                    print_manager,
                    "print",
                    "(Ljava/lang/String;Landroid/print/PrintDocumentAdapter;Landroid/print/PrintAttributes;)Landroid/print/PrintJob;",
                    &[JValue::Object(&job_name_obj), JValue::Object(&adapter), JValue::Object(&attrs)],
                )
                .expect("failed to start Android print job");
            })
        })
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn a4_android_print(_webview_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Android print is only available on Android builds.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![a4_open_external, a4_android_print])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
