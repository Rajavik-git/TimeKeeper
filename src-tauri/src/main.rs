use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    LogicalSize, Manager, PhysicalPosition,
};

const PILL_WIDTH: u32 = 340;
const PILL_HEIGHT: u32 = 58;
const NOTICE_HEIGHT: u32 = 150;
const PANEL_HEIGHT: u32 = 490;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_pill_expanded, open_my_day])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let pill = app
                .get_webview_window("pill")
                .expect("pill window configured");
            position_pill(&pill, PILL_HEIGHT)?;
            pill.show()?;
            let open = MenuItem::with_id(app, "open", "Open TimeKeeper", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("TimeKeeper failed to start");
}
