# Browser acceptance through MCP

Run [smoke.mcp.js](smoke.mcp.js) through the connected Playwright MCP server, which supplies its `page` object. This is separate from `npm test` and desktop builds; no project Playwright package is required.

## Start an isolated test fixture

Follow [setup](../../docs/SETUP.md) with the Node version in [`.nvmrc`](../../.nvmrc). `node install.mjs --skip-screenpipe` prepares browser-only development. In a dedicated POSIX shell at the repository root:

```sh
smoke_dir=$(mktemp -d "${TMPDIR:-/tmp}/timekeeper-mcp.XXXXXX")
export TIMEKEEPER_DB="$smoke_dir/timekeeper.db"
export TIMEKEEPER_PORT=8788
export UI_PORT=5174
node --import tsx tests/fixtures/create-database.ts
npm run dev
```

The fixture requires an explicit, unused database path. Exported values override `.env`. Use free ports and match them in the browser URL. Never reset the working database or substitute the comparison importer. This procedure does not test Tauri's fixed development URL.

## Run the MCP check

1. Confirm API and Vite readiness.
2. Open a fresh tab with `browser_tabs`, `action: "new"`, and the isolated URL, normally `http://127.0.0.1:5174/`. This resets session sorting preferences.
3. Inspect the smoke file, then invoke `browser_run_code_unsafe`:

   ```json
   { "filename": "tests/acceptance/smoke.mcp.js" }
   ```

   The filename is relative to the MCP server's workspace. Use an absolute path if needed, or pass file contents through `code` if local reads are unavailable.

4. Require `status: "passed"`. For failures, inspect `browser_snapshot` and `browser_console_messages` at level `error`. Use `browser_take_screenshot` for visual evidence; do not weaken assertions to obtain a pass.
5. Record browser, OS, revision, result, and screenshot paths. Close only test tabs and stop the dedicated development processes.

The function leaves the supplied tab open, closes its temporary pill tab, and removes listeners. Set `captureDir` to an absolute path to save captures. Screenshots do not establish assertion success.

## Coverage and limits

The smoke checks five views and the pill in light/dark at 1440×900 and 1280×800. It checks geometry, palette, controls, tables, calendar, sorting, billing expansion, case navigation/search, invoice detail, Desk, and removal of demo reset. Page exceptions and console errors fail. Fixture expectations use a browser clock of 17 October 2026 and My day's selected date of 16 October.

If MCP cannot open or reach the app, report acceptance as blocked. Static checks do not replace it. Native macOS/Windows, recording, and provider integration require separate acceptance.
