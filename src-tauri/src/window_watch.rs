use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        },
    },
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWindow {
    window_title: String,
    app_name: String,
}

fn foreground_window() -> Option<ActiveWindow> {
    // SAFETY: The Win32 handles and buffers are checked before use and the process handle is closed.
    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return None;
        }
        let length = GetWindowTextLengthW(window);
        if length <= 0 {
            return None;
        }
        let mut title = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(window, &mut title);
        if copied <= 0 {
            return None;
        }
        let window_title = String::from_utf16_lossy(&title[..copied as usize])
            .trim()
            .to_owned();
        if window_title.is_empty() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut image = vec![0u16; 32768];
        let mut image_len = image.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(image.as_mut_ptr()),
            &mut image_len,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        let image_path = String::from_utf16_lossy(&image[..image_len as usize]);
        let app_name = Path::new(&image_path)
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())?;
        Some(ActiveWindow {
            window_title,
            app_name,
        })
    }
}

pub fn start(app: AppHandle, enabled: Arc<AtomicBool>, stop: Arc<AtomicBool>) {
    thread::spawn(move || {
        let mut previous: Option<(String, String)> = None;
        while !stop.load(Ordering::Relaxed) {
            if enabled.load(Ordering::Relaxed) {
                if let Some(active) = foreground_window() {
                    let key = (active.window_title.clone(), active.app_name.clone());
                    if previous.as_ref() != Some(&key) {
                        let _ = app.emit_to("pill", "active-window-changed", active);
                        previous = Some(key);
                    }
                } else {
                    previous = None;
                }
            } else {
                previous = None;
            }
            thread::sleep(Duration::from_millis(1500));
        }
    });
}
