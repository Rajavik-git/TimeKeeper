# Windows desktop app

TimeKeeper's Tauri 2 shell loads `pill.html` in a floating window and `index.html` in a hidden main window. The Windows NSIS installer includes the built frontend and a Node API sidecar. The sidecar is a [Node 22 single executable application](https://nodejs.org/download/release/v22.13.0/docs/api/single-executable-applications.html) with the server, dependencies, schema, and fictional demo seed bundled into one file. If the SEA cannot pass its build-time startup check, the build uses the bundled Node executable with the standalone CommonJS API resource. Tauri locates the sidecar using [`bundle.externalBin`](https://v2.tauri.app/develop/sidecar/) and starts it through `tauri-plugin-shell`.

## Install and run

- Windows 10 (version 1803 or later) or Windows 11 with WebView2.
- No separate Node.js, npm, terminal, or API process is needed after installation.
- For building on Windows: Node.js 22.13 or newer, Rust with the MSVC toolchain, and Microsoft C++ Build Tools.

Build on Windows with `npm ci` and `npm run desktop:build`, or run the **Windows desktop installer** workflow manually. Download its NSIS `.exe` artifact and install it. The installer is unsigned and may trigger a Windows SmartScreen warning. On launch, the shell starts the API at `127.0.0.1:8787`, positions and shows the always-on-top pill at the top center of the primary monitor, and keeps the main window hidden. The tray offers **Open TimeKeeper**, **Show/Hide pill**, and **Quit**. Closing the main window hides it; Quit terminates the API sidecar.

On first launch the sidecar creates `timekeeper.db` in Tauri's application data directory, installs the existing demo schema and seed in a transaction, and imports the canonical demo periods. An empty existing database also receives the seed. Later launches reuse the database and preserve local changes. The API binds only to loopback. The desktop WebView can access it from the configured Tauri origins. The shell waits up to 15 seconds for the service to listen before showing the pill; startup failures display a native error dialog. Sidecar errors and exit status are written to `api.log` in Tauri's application log directory. A second launch focuses the existing window, and the sidecar exits if its parent process disappears.

For development, run `npm run dev:server` in one terminal and `npm run desktop:dev` in another. The development build uses the separately started API. `npm run api:bundle` builds the standalone API script; `npm run api:sidecar` also builds and smoke-checks the current platform's SEA or fallback executable. The Windows workflow runs tests and typecheck before packaging and uploads the NSIS installer artifact.

The pill polls the local API for the active session, current work period, and pending questions. Its compact state shows the current period's effective duration; the expanded state shows session and period timing, case selection, and unresolved questions. A case change uses the canonical period assignment route or the guarded question-answer route. The pill cannot pause Screenpipe or close a period until those provider workflows are implemented, so those controls are disabled.

Linux verification covers the bundled API and a local SEA serving `/api/state` from a newly seeded temporary database. The Windows workflow checks the Windows sidecar before packaging. Native installer launch, tray behavior, WebView loading, and macOS behavior still require platform acceptance. The current icons are placeholders.
