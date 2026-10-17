# Windows desktop app

TimeKeeper's desktop shell is a Tauri 2 application. The Rust shell lives in `src-tauri/` and is driven by the single root npm package. It loads `src/frontend/pill.html` in a floating window and `src/frontend/index.html` in the main window. Both pages are built by Vite from `src/frontend/`. The Node API remains a separately started process; the installer does not bundle it.

## Install and run

- Windows 10 (version 1803 or later) or Windows 11 with WebView2 (normally already included).
- Node.js 24 LTS. Use the version in [`.nvmrc`](../../.nvmrc). The local Node API is **not** included in the installer.
- For local development or building on Windows: Rust with the MSVC toolchain and Microsoft C++ Build Tools.

Clone the repository, run `npm ci`, then run `npm run dev:server` in one terminal. Keep it running. Run `npm run desktop:dev` in another terminal. For an installer, run `npm run desktop:build` on Windows, or start the **Windows desktop installer** GitHub Actions workflow manually (or push a `v*` tag). Download the NSIS `.exe` from the workflow artifacts and run it. Start the API with `npm run dev:server` before launching TimeKeeper from the Start menu. The unsigned installer can trigger a Windows SmartScreen warning.

The API binds to `127.0.0.1` and uses port 8787 by default. `TIMEKEEPER_PORT` changes the backend port. The desktop frontend uses the build-time `VITE_TIMEKEEPER_API_URL`, defaulting to `http://127.0.0.1:8787`; the configured origin must also be allowed by the content security policy in `src-tauri/tauri.conf.json`. Rebuild the frontend and desktop shell after changing that origin. Browser development keeps relative API requests through Vite's proxy. Development uses the local Vite server on port 5173. If the API is absent, the pill shows **Server not running** and retries every five seconds.

## Pill behavior

The pill stays above other windows and opens the main window through Tauri. It polls the local API for the active session, current work period and pending questions. Its compact state shows the current period's effective duration; the expanded state shows “Session since … · this period since …”, case selection and an unresolved-question notice. A case change uses the canonical period assignment route, or the guarded question-answer route for an unresolved current period. The pill cannot pause Screenpipe or close a period until those provider workflows are implemented, so those controls are disabled.

The desktop WebView can access the configured loopback API origin when its content security policy permits it. If the API is absent, the pill shows **Server not running** and retries every five seconds. The installer does not yet include or launch Node. Native Windows and macOS behavior must be accepted separately. The existing Tauri icons are placeholders awaiting the final logo.
