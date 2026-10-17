# Browser acceptance through MCP

Run [smoke.mcp.js](smoke.mcp.js) through the connected Playwright MCP server. The server owns the browser and invokes the file's function with its `page` object. No Python runner or project Playwright package is required. This workflow is agent-driven and does not run under `npm test` or the desktop build workflow.

## Start an isolated test fixture

Use Node 24 and the installed project dependencies. Run these commands from the repository root in a dedicated terminal:

```sh
smoke_dir=$(mktemp -d "${TMPDIR:-/tmp}/timekeeper-mcp.XXXXXX")
export TIMEKEEPER_DB="$smoke_dir/timekeeper.db"
export TIMEKEEPER_PORT=8788
export UI_PORT=5174
node --import tsx tests/fixtures/create-database.ts
npm run dev
```

The fixture command requires an explicit `TIMEKEEPER_DB` path and refuses to overwrite an existing file. Normal application startup and `db:reset` never load test records. Use free ports if these ports are occupied, and carry the same values into the browser URL. Do not reset an existing working database for this check. Stop the processes from this terminal after testing.

## Run the MCP check

1. Confirm that both the API and Vite report readiness.
2. Use `browser_tabs` with `action: "new"` and the isolated UI URL, normally `http://127.0.0.1:5174/`. Use a fresh tab on every run so client sorting starts with its default session preference.
3. Invoke `browser_run_code_unsafe` with the following argument. The tool executes this repository-owned JavaScript in the MCP server process; inspect the file before running it.

   ```json
   { "filename": "tests/acceptance/smoke.mcp.js" }
   ```

   The filename is relative to the MCP server's workspace root. If its root differs, use the absolute path to this file. If the server cannot read local files but accepts `code`, pass the file contents through that argument.

4. Require a returned `status: "passed"`. If an assertion fails, inspect `browser_snapshot` and `browser_console_messages` at level `error`. Use `browser_take_screenshot` for visual evidence. Report the failing check without changing its expectation merely to obtain a pass.
5. Record the browser, operating system, tested revision, result, and any screenshot paths. Close only the smoke-test tabs and stop the dedicated development processes.

The function keeps the supplied MCP tab open for inspection, closes its temporary pill tab, and removes its event listeners. It checks that the removed demo reset control is absent. To retain all ten screen/theme captures, set `captureDir` in the submitted function to an absolute output directory before execution. Screenshots alone do not establish that all assertions passed.

## Coverage and limits

The checks cover My day, Cases, Billing, Activity, and Settings at 1440×900 and 1280×800 in light and dark themes. They preserve the palette, page overflow, table headers, scrollbars, calendar, sorting, expandable billing cases, case navigation, search, invoice detail, Desk preview, and standalone pill checks. Page exceptions and console errors fail the run. Expected dates and amounts refer to the explicit test fixture. The check fixes the browser clock to 17 October 2026 and selects the fixture date, 16 October, in My day.

If MCP cannot open a browser or reach the isolated app, report browser acceptance as blocked. Static checks do not replace it. These browser checks do not verify the Tauri host, native installation, Screenpipe recording, or provider integration. Run macOS and Windows native acceptance separately.
