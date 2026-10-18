import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** The existing main window receives navigation without reloading its review state. */
export function useDesktopNavigation(openDay: () => void) {
  const handler = useRef(openDay);
  handler.current = openDay;
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const registration = getCurrentWebviewWindow().listen("timekeeper:open-my-day", () =>
      handler.current(),
    );
    void registration.catch(() => undefined);
    return () => {
      void registration.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);
}
