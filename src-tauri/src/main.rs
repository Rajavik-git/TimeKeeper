#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::OpenOptions,
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::TrayIconBuilder,
    LogicalSize, Manager, PhysicalPosition,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[cfg(windows)]
mod window_watch;

struct ApiSidecar(Mutex<Option<CommandChild>>);
struct WatchState {
    enabled: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
}

#[tauri::command]
fn set_watch_enabled(state: tauri::State<WatchState>, enabled: bool) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

const PILL_WIDTH: u32 = 380;
const PILL_HEIGHT: u32 = 58;
const NOTICE_HEIGHT: u32 = 270;
const PANEL_HEIGHT: u32 = 560;

fn position_pill(window: &tauri::WebviewWindow, height: u32) -> tauri::Result<()> {
    let monitor = window.primary_monitor()?;
    window.set_size(LogicalSize::new(PILL_WIDTH, height))?;
    if let Some(monitor) = monitor {
        let size = monitor.size();
        let origin = monitor.position();
        let width = (PILL_WIDTH as f64 * monitor.scale_factor()).round() as i32;
        window.set_position(PhysicalPosition::new(
            origin.x + ((size.width as i32 - width) / 2),
            origin.y + 16,
        ))?;
    }
    Ok(())
}

#[tauri::command]
fn set_pill_expanded(
    window: tauri::WebviewWindow,
    expanded: bool,
    notification: bool,
) -> Result<(), String> {
    if window.label() != "pill" {
        return Err("Pill window required".into());
    }
    let height = if expanded {
        PANEL_HEIGHT
    } else if notification {
        NOTICE_HEIGHT
    } else {
        PILL_HEIGHT
    };
    position_pill(&window, height).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_my_day(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn service_error(app: &tauri::AppHandle) {
    app.dialog()
        .message("TimeKeeper could not start its local service (port 8787 busy?)")
        .kind(MessageDialogKind::Error)
        .title("TimeKeeper")
        .blocking_show();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(main) = app.get_webview_window("main") {
                if main.is_visible().unwrap_or(false) {
                    let _ = main.set_focus();
                    return;
                }
            }
            if let Some(pill) = app.get_webview_window("pill") {
                let _ = pill.show();
                let _ = pill.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            set_pill_expanded,
            open_my_day,
            set_watch_enabled
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if !cfg!(debug_assertions) {
                let data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                let log_dir = app.path().app_log_dir()?;
                std::fs::create_dir_all(&log_dir)?;
                let log_path = log_dir.join("api.log");
                let fallback_script = app.path().resolve("api.cjs", BaseDirectory::Resource)?;
                let (mut events, child) = app
                    .shell()
                    .sidecar("timekeeper-api")?
                    .arg(fallback_script)
                    .env("TIMEKEEPER_DB", data_dir.join("timekeeper.db"))
                    .env("TIMEKEEPER_PORT", "8787")
                    .env("TIMEKEEPER_PARENT_PID", std::process::id().to_string())
                    .spawn()
                    .map_err(|error| {
                        service_error(&app.handle());
                        error
                    })?;
                app.manage(ApiSidecar(Mutex::new(Some(child))));
                let (ready_tx, ready_rx) = mpsc::sync_channel(1);
                tauri::async_runtime::spawn(async move {
                    let mut waiting = true;
                    while let Some(event) = events.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                if waiting
                                    && String::from_utf8_lossy(&line)
                                        .starts_with("TimeKeeper API: http://127.0.0.1:")
                                {
                                    let _ = ready_tx.send(true);
                                    waiting = false;
                                }
                            }
                            CommandEvent::Stderr(line) => {
                                if let Ok(mut file) =
                                    OpenOptions::new().create(true).append(true).open(&log_path)
                                {
                                    let _ = writeln!(
                                        file,
                                        "stderr: {}",
                                        String::from_utf8_lossy(&line)
                                    );
                                }
                            }
                            CommandEvent::Terminated(status) => {
                                if let Ok(mut file) =
                                    OpenOptions::new().create(true).append(true).open(&log_path)
                                {
                                    let _ = writeln!(
                                        file,
                                        "terminated: code={:?} signal={:?}",
                                        status.code, status.signal
                                    );
                                }
                                if waiting {
                                    let _ = ready_tx.send(false);
                                }
                                break;
                            }
                            CommandEvent::Error(error) => {
                                if let Ok(mut file) =
                                    OpenOptions::new().create(true).append(true).open(&log_path)
                                {
                                    let _ = writeln!(file, "process error: {error}");
                                }
                                if waiting {
                                    let _ = ready_tx.send(false);
                                }
                                break;
                            }
                            _ => {}
                        }
                    }
                });
                if ready_rx.recv_timeout(Duration::from_secs(15)) != Ok(true) {
                    if let Some(state) = app.try_state::<ApiSidecar>() {
                        if let Ok(mut child) = state.0.lock() {
                            if let Some(child) = child.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                    service_error(&app.handle());
                    return Err(std::io::Error::other("API sidecar failed to start").into());
                }
            }
            let pill = app
                .get_webview_window("pill")
                .expect("pill window configured");
            position_pill(&pill, PILL_HEIGHT)?;
            pill.show()?;
            let open = MenuItem::with_id(app, "open", "Open TimeKeeper", true, None::<&str>)?;
            let toggle_pill = MenuItem::with_id(app, "pill", "Show/Hide pill", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &toggle_pill, &quit])?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("app icon configured")
                        .clone(),
                )
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = open_my_day(app.clone());
                    }
                    "pill" => {
                        if let Some(pill) = app.get_webview_window("pill") {
                            let _ = if pill.is_visible().unwrap_or(false) {
                                pill.hide()
                            } else {
                                position_pill(&pill, PILL_HEIGHT).and_then(|_| pill.show())
                            };
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            let watch = WatchState {
                enabled: Arc::new(AtomicBool::new(true)),
                stop: Arc::new(AtomicBool::new(false)),
            };
            #[cfg(windows)]
            window_watch::start(
                app.handle().clone(),
                watch.enabled.clone(),
                watch.stop.clone(),
            );
            app.manage(watch);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("TimeKeeper failed to build");
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app.try_state::<WatchState>() {
                state.stop.store(true, Ordering::Relaxed);
            }
            if let Some(state) = app.try_state::<ApiSidecar>() {
                if let Ok(mut child) = state.0.lock() {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
