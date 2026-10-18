use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_DONOTROUND,
};

/// Removes the Windows 11 border and rounded corners from the frameless pill window.
pub fn disable_native_frame(window: &tauri::WebviewWindow) {
    if let Ok(handle) = window.hwnd() {
        // SAFETY: DWM reads the two fixed-size values only for the duration of each call.
        unsafe {
            let border = DWMWA_COLOR_NONE;
            let corner = DWMWCP_DONOTROUND;
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_BORDER_COLOR,
                &border as *const _ as *const _,
                std::mem::size_of_val(&border) as u32,
            );
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &corner as *const _ as *const _,
                std::mem::size_of_val(&corner) as u32,
            );
        }
    }
}
