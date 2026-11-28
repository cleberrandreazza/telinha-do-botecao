mod ai_router;
mod capture;
mod deep_link;
mod discord_rpc;
mod json_export;
mod loopback;
mod packet_buffer;
mod updater;
mod ws_local;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Primeiro plugin: um segundo `telinha://` cai nesta janela, sem outra cópia.
    #[cfg(windows)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deep_link::focus_main(&app);
            deep_link::accept_args(&app, &argv);
        }));
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder
        .manage(capture::CaptureHost::default())
        .manage(ai_router::RouterState::default())
        .manage(packet_buffer::PacketHub::default())
        .manage(deep_link::PendingJoin::default())
        .invoke_handler(tauri::generate_handler![
            updater::check_for_update,
            updater::install_portable_update,
            capture::list_capture_sources,
            capture::start_native_capture,
            capture::stop_native_capture,
            ai_router::update_peer_telemetry,
            ai_router::forget_routing_peer,
            ai_router::compute_routing_plan,
            ai_router::get_local_system_load,
            packet_buffer::fragment_encoded_frame,
            packet_buffer::ingest_p2p_packet,
            packet_buffer::drain_ready_frames,
            discord_rpc::update_discord_presence,
            discord_rpc::get_discord_rpc_status,
            deep_link::take_pending_join,
            json_export::save_json_file,
        ])
        .setup(|app| {
            updater::spawn_startup(app.handle().clone());
            #[cfg(windows)]
            deep_link::install(app);
            #[cfg(all(not(debug_assertions), windows))]
            disable_release_webview_menus(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Telinha do Botecao");
}

/// No .exe, o WebView2 não oferece Back/Refresh/Save/Print/Inspect.
/// O `tauri dev` (`debug_assertions`) continua com DevTools.
#[cfg(all(not(debug_assertions), windows))]
fn disable_release_webview_menus(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        let _ = settings.SetAreDefaultContextMenusEnabled(false);
        let _ = settings.SetAreDevToolsEnabled(false);
    });
}
