# Prepare the local environment

## Install Node and Screenpipe

1. Select the exact Node version in [`.nvmrc`](../.nvmrc). With nvm, run `nvm install`, then `nvm use` from the repository root.
2. Install Screenpipe using its [official guide](https://docs.screenpipe.com/getting-started). Complete onboarding and start its local service, normally on port 3030. The service must run; its visible window can close.
3. On macOS, grant the selected capture features their [required permissions](https://docs.screenpipe.com/permissions).

## Prepare TimeKeeper

Run from the repository root:

```sh
node install.mjs
```

Setup checks Node and npm, creates a missing `.env` from [`.env.example`](../.env.example), and runs `npm ci --include=dev --no-audit --no-fund`. Existing configuration and databases are preserved. Repeating setup replaces `node_modules`. An absolute script path also works from another directory.

The Screenpipe check sends `GET /health` with a five-second timeout and no redirects. It requires HTTP success and JSON `status: "healthy"`. This [public route](https://docs.screenpipe.com/getting-started) needs no token. It does not verify protected reads, recent capture, or the planned [TimeKeeper integration](SCREENPIPE_INTEGRATION.md#environment-readiness-and-integration-status). Setup does not install Screenpipe, register MCP, run workflows, or start recording or JEV.

| Option or command     | Behavior                                                        |
| --------------------- | --------------------------------------------------------------- |
| `npm run setup`       | Same as `node install.mjs`                                      |
| `npm run setup:check` | Repeat checks without setup writes                              |
| `--skip-screenpipe`   | Prepare app development without requiring Screenpipe            |
| `--desktop`           | Also check `rustc` and `cargo`; does not install platform tools |
| `--help`              | Display options                                                 |

Flags can be combined, such as `node install.mjs --check --desktop`. The dependency check detects npm's installed marker; it does not verify integrity or lockfile agreement.

## Run the browser interface

1. Run `npm run dev` to start the API and Vite.
2. Open `http://127.0.0.1:5173`.

Startup applies migrations and creates neutral settings without sample business records. Stopping processes does not end an active session. For built API output, run `npm run build`, then `npm run api:serve`; this does not serve the browser interface.

## Prepare desktop development

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). macOS needs Xcode or Command Line Tools. Windows needs C++ Build Tools, the MSVC Rust toolchain, and WebView2.
2. Run `node install.mjs --desktop`.
3. Keep `npm run dev:server` running in one terminal.
4. Run `npm run desktop:dev` in another. Tauri starts Vite.

Node runs separately. Main-window close hides the shell; tray Quit exits it without stopping Node. Neither ends the session. If the API is absent, the pill shows Cannot reach TimeKeeper and retries. Coordinated process management remains a release requirement in the [architecture](ARCHITECTURE.md#session-lifecycle-and-application-lifecycle).

### Build the Windows package

`src-tauri/tauri.conf.json` targets Windows NSIS. macOS packaging is not configured.

1. Run `npm run desktop:build` on Windows, or start the Windows desktop installer GitHub Actions workflow, which also runs for `v*` tags.
2. Download the NSIS `.exe` from workflow artifacts when using GitHub Actions.
3. Install it. The unsigned package can trigger SmartScreen.
4. Keep `npm run dev:server` running before launching TimeKeeper.

The package excludes Node and still requires the repository's API and dependencies. Native compilation and behavior need separate macOS and Windows acceptance; the setup check verifies only command availability.

## Configure local settings

Edit the root `.env`; Git ignores it. Exported shell variables take precedence. Restart development processes after changes.

| Variable                     | Default                 | Purpose                                     |
| ---------------------------- | ----------------------- | ------------------------------------------- |
| `SCREENPIPE_API_URL`         | `http://127.0.0.1:3030` | Setup health check only                     |
| `UI_HOST`                    | `127.0.0.1`             | Vite host                                   |
| `UI_PORT`                    | `5173`                  | Vite port                                   |
| `TIMEKEEPER_PORT`            | `8787`                  | API port and Vite proxy target              |
| `VITE_TIMEKEEPER_API_URL`    | `http://127.0.0.1:8787` | Desktop API origin, fixed at build time     |
| `TIMEKEEPER_DB`              | `data/timekeeper.db`    | SQLite path relative to the repository root |
| `TIMEKEEPER_ALLOWED_ORIGINS` | Empty                   | Additional origins, comma-separated         |

Setup uses only `SCREENPIPE_API_URL` from `.env`. It accepts HTTP origins on `127.0.0.1`, `localhost`, or `[::1]`, with a selected port. Credentials, paths, queries, fragments, and HTTPS are rejected. Do not append `/health`.

Development, reset, and built-API commands load the root `.env`. Production builds do not; export desktop build settings explicitly. A changed desktop API origin also requires a matching `src-tauri/tauri.conf.json` content security policy and a rebuild. Keep UI defaults for Tauri's development URL. Browser development uses Vite's relative API proxy.

## Resolve setup failures

| Exit code | Meaning                                 | Action                                  |
| --------- | --------------------------------------- | --------------------------------------- |
| `0`       | Selected checks passed                  | Start the app                           |
| `1`       | Configuration or setup operation failed | Correct the reported error and rerun    |
| `2`       | Prerequisite or service unavailable     | Install or start it, then repeat checks |

Match Node to `.nvmrc` and install npm with Node. Resolve npm's reported lockfile, registry, or network error before rerunning installation. For unhealthy Screenpipe, check its service, configured port, [permissions](https://docs.screenpipe.com/permissions), and [recording diagnostics](https://docs.screenpipe.com/troubleshooting). Keep protected API authentication enabled. Missing Rust commands require the Tauri prerequisites and a new terminal.

`npm run db:reset` deletes the selected database. Use disposable data and the [isolated browser acceptance procedure](../tests/acceptance/README.md) for checks. Setup never resets data.

## Comparison-sample tooling

`npm run db:samples` invokes `scripts/load-comparison-samples.ts`. It requires nonblank `--database PATH`, with no `TIMEKEEPER_DB` fallback. `--dry-run` opens no database. The importer backs up compatible existing targets, rejects pending migrations, and preserves human edits on rerun. This is not general backup recovery.

Use the [separate preview database](../README.md#view-sample-comparisons). Selecting a working workspace requires authorization. Setup, normal startup, and browser acceptance do not invoke the importer.
