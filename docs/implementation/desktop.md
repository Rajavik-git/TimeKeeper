# Windows desktop app

TimeKeepr's desktop shell is a Tauri 2 application. The Rust shell lives in `src-tauri/` and is driven by the single root npm package. It loads `src/frontend/pill.html` in a floating window and `src/frontend/index.html` in the main window. Both pages are built by Vite from `src/frontend/`. The Node API remains a separately started process; the installer does not bundle it.

## Install and run

- Windows 10 (version 1803 or later) or Windows 11 with WebView2 (normally already included).
- Node.js 22.13 or newer. The local Node API is **not** included in the installer.
- For local development or building on Windows: Rust with the MSVC toolchain and Microsoft C++ Build Tools.

Clone the repository, run `npm ci`, then run `npm run dev:server` in one terminal. Keep it running. Run `npm run desktop:dev` in another terminal. For an installer, run `npm run desktop:build` on Windows, or start the **Windows desktop installer** GitHub Actions workflow manually (or push a `v*` tag). Download the NSIS `.exe` from the workflow artifacts and run it. Start the API with `npm run dev:server` before launching TimeKeepr from the Start menu. The unsigned installer can trigger a Windows SmartScreen warning.

The API binds only to `127.0.0.1:8787`. The desktop WebView can access it from the Tauri origins. Development uses the local Vite server on port 5173. If the API is absent, the pill shows **Server not running** and retries every five seconds.

## Pill behavior

The pill starts at the top center of the primary monitor, stays above other applications and does not appear on the taskbar. Click it to expand a panel with **This block**, **Today**, Pause/Resume, Close block, Other case, and Open my day. The last action opens the initially hidden main window. The tray menu also offers Open TimeKeepr and Quit. Notifications cycle through blocks needing review, assigned calls and the active block from local state. They appear below the collapsed pill or inside the open panel and can be dismissed. The pill CSS is isolated in `src/frontend/features/desk/pill/pill.css` with the approved Geist typography and light and dark colors.

The amounts come from `/api/state` and are stored as integer cents. The current block advances at the same demonstration pace as the existing Desk screen: one simulated minute every 1.5 seconds. Pause, close and case changes use the existing API routes and are saved to the database. The API's demo date is fixed at 2026-10-16. There is no screenpipe ingestion or real clock tracking in this release. Closing the block ends its active state; a new active block requires an upstream process. The API must remain running separately after installation, and there is no automatic startup, updater or code signature.
