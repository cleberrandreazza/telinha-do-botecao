mod capture;
mod loopback;
mod updater;
mod ws_local;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::CaptureHost::default())
        .invoke_handler(tauri::generate_handler![
            updater::check_for_update,
            updater::install_portable_update,
            capture::list_capture_sources,
            capture::start_native_capture,
            capture::stop_native_capture,
        ])
        .setup(|app| {
            updater::spawn_startup(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Telinha do Botecao");
}
