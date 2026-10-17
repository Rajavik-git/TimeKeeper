pub fn should_emit(title: &str, class_name: &str, app_name: &str) -> bool {
    let title = title.trim().to_ascii_lowercase();
    let class_name = class_name.trim().to_ascii_lowercase();
    let app_name = app_name.trim().to_ascii_lowercase();
    if title.is_empty() || title.contains("timekeeper") || app_name.starts_with("timekeeper") {
        return false;
    }
    if [
        "program manager",
        "task switching",
        "task view",
        "start",
        "search",
        "windows input experience",
        "notification center",
    ]
    .contains(&title.as_str())
    {
        return false;
    }
    if [
        "progman",
        "workerw",
        "shell_traywnd",
        "shell_secondarytraywnd",
        "multitaskingviewframe",
        "windows.ui.core.corewindow",
    ]
    .contains(&class_name.as_str())
    {
        return false;
    }
    if [".docx", ".pdf", ".xlsx", ".eml", ".msg", ".txt", ".pptx"]
        .iter()
        .any(|extension| title.contains(extension))
    {
        return true;
    }
    if app_name == "explorer" {
        return !["file explorer", "this pc", "home", "quick access"].contains(&title.as_str());
    }
    [
        "winword", "excel", "powerpnt", "outlook", "acrord32", "acrobat", "msedge", "chrome",
        "firefox", "notepad",
    ]
    .contains(&app_name.as_str())
}

#[cfg(test)]
mod tests {
    use super::should_emit;

    #[test]
    fn ignores_shell_and_timekeeper_windows() {
        for title in [
            "Program Manager",
            "Task Switching",
            "Task View",
            "Start",
            "Search",
            "Windows Input Experience",
            "Notification Center",
            "",
        ] {
            assert!(
                !should_emit(title, "Chrome_WidgetWin_1", "chrome"),
                "{title}"
            );
        }
        for class in [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "MultitaskingViewFrame",
            "Windows.UI.Core.CoreWindow",
        ] {
            assert!(!should_emit("brief.pdf", class, "chrome"), "{class}");
        }
        assert!(!should_emit(
            "TimeKeeper",
            "Chrome_WidgetWin_1",
            "msedgewebview2"
        ));
        assert!(!should_emit(
            "brief.pdf",
            "Chrome_WidgetWin_1",
            "timekeeper-desktop"
        ));
    }

    #[test]
    fn accepts_documents_and_work_apps() {
        assert!(should_emit("Appeal.docx - Word", "OpusApp", "WINWORD"));
        assert!(should_emit("Budget", "XLMAIN", "EXCEL"));
        assert!(should_emit("Mail - Outlook", "rctrl_renwnd32", "OUTLOOK"));
        assert!(should_emit("Draft.pdf", "Other", "unknown-app"));
        assert!(should_emit("Downloads", "CabinetWClass", "explorer"));
        assert!(should_emit(
            "Research - Mozilla Firefox",
            "MozillaWindowClass",
            "firefox"
        ));
        assert!(!should_emit("Settings", "Other", "unknown-app"));
        assert!(!should_emit("This PC", "CabinetWClass", "explorer"));
    }
}
