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

Setup checks Node and npm, creates a missing `.env` from [`.env.example`](../.env.example), and runs `npm ci --include=dev --no-audit --no-fund`. It fills a missing or blank `SCREENPIPE_API_KEY` through Screenpipe's `auth token` command. Existing nonblank values and databases are preserved. Repeating full setup replaces `node_modules`. An absolute script path also works from another directory.

Key discovery uses an exported `SCREENPIPE_API_KEY` or `SCREENPIPE_LOCAL_API_KEY` when available. Otherwise, it uses the installed native CLI selected by `SCREENPIPE_CLI`, the `screenpipe` command, or an already installed npm CLI. It captures the token locally and never prints it. Setup does not download a CLI. If discovery fails, setup reports a pending prerequisite. Screenpipe documents this command in its [MCP authentication instructions](https://github.com/screenpipe/screenpipe/blob/main/packages/screenpipe-mcp/README.md).

To fill a missing key without reinstalling dependencies, run `npm run setup:auth`. Set `SCREENPIPE_CLI` to the absolute native executable path if discovery cannot find the installed CLI. Existing keys are preserved, so remove an expired local value before running auth setup again.

Auth setup uses `.env.screenpipe-auth.lock` to serialize configuration changes. If an interrupted process leaves this file, confirm that no setup process runs before removing it and retrying. Avoid editing `.env` during setup; detected changes leave authentication pending.

The Screenpipe check sends `GET /health` with a five-second timeout and no redirects. It requires HTTP success and JSON `status: "healthy"`. This [public route](https://docs.screenpipe.com/getting-started) needs no token. Saving a token and passing health do not verify authenticated reads or recent capture. Use **Settings → Screenpipe → Test connection** to verify protected access. Setup does not install Screenpipe, register MCP, run workflows, or start recording or JEV.

| Option or command     | Behavior                                                        |
| --------------------- | --------------------------------------------------------------- |
| `npm run setup`       | Same as `node install.mjs`                                      |
| `npm run setup:check` | Repeat checks without setup writes                              |
| `npm run setup:auth`  | Fill a missing Screenpipe key without reinstalling dependencies |
| `--skip-screenpipe`   | Prepare app development without requiring Screenpipe            |
| `--desktop`           | Also check `rustc` and `cargo`; does not install platform tools |
| `--help`              | Display options                                                 |

Flags can be combined, such as `node install.mjs --check --desktop`. Check mode reports a missing key but never retrieves or saves one. The dependency check detects npm's installed marker; it does not verify integrity or lockfile agreement.

## Run the browser interface

1. Run `npm run dev` to start the API and Vite.
2. Open `http://127.0.0.1:5173`.

Startup applies migrations and creates neutral settings without sample business records. Stopping processes does not end an active session. For built API output, run `npm run build`, then `npm run api:serve`; this does not serve the browser interface.

## Prepare desktop development

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). macOS needs Xcode or Command Line Tools. Windows needs C++ Build Tools, the MSVC Rust toolchain, and WebView2.
2. Run `node install.mjs --desktop`.
3. Keep `npm run dev:server` running in one terminal.
4. Run `npm run desktop:dev` in another. Tauri starts Vite.

In development Node runs separately. Release builds launch their owned API sidecar and stop it on tray Quit. Main-window close hides the shell. Neither ends the session. If the API is absent, the pill shows Cannot reach TimeKeeper and retries. Native process behavior still requires acceptance in the [architecture](ARCHITECTURE.md#session-lifecycle-and-application-lifecycle).

### Build the Windows package

`src-tauri/tauri.conf.json` targets Windows NSIS. macOS packaging is not configured.

1. Run `npm run desktop:build` on Windows, or start the Windows desktop installer GitHub Actions workflow, which also runs for `v*` tags.
2. Download the NSIS `.exe` from workflow artifacts when using GitHub Actions.
3. Install it. The unsigned package can trigger SmartScreen.
4. Launch the installed TimeKeeper app. Its owned API sidecar starts automatically.

The Windows package includes the API sidecar and its Node executable or SEA fallback. It does not include the MCP/JEV workflow, its configuration, or Screenpipe MCP. Native compilation and behavior need separate macOS and Windows acceptance; the setup check verifies only command availability.

## Configure local settings

Edit the root `.env`; Git ignores it. Exported shell variables take precedence. Restart development processes after changes.

| Variable                     | Default                 | Purpose                                      |
| ---------------------------- | ----------------------- | -------------------------------------------- |
| `SCREENPIPE_API_URL`         | `http://127.0.0.1:3030` | Setup health and JEV Screenpipe MCP reads    |
| `UI_HOST`                    | `127.0.0.1`             | Vite host                                    |
| `UI_PORT`                    | `5173`                  | Vite port                                    |
| `TIMEKEEPER_PORT`            | `8787`                  | API port and Vite proxy target               |
| `TIMEKEEPER_MCP_PORT`        | `3032`                  | MCP HTTP server and registration port        |
| `VITE_TIMEKEEPER_API_URL`    | `http://127.0.0.1:8787` | Desktop API origin, fixed at build time      |
| `TIMEKEEPER_DB`              | `data/timekeeper.db`    | SQLite path relative to the repository root  |
| `TIMEKEEPER_ALLOWED_ORIGINS` | Empty                   | Additional origins, comma-separated          |
| `SCREENPIPE_URL`             | `http://127.0.0.1:3030` | Backend evidence reads and recording link    |
| `SCREENPIPE_API_KEY`         | Filled by setup         | Screenpipe local API authentication          |
| `SCREENPIPE_INSTANCE_ID`     | `local`                 | Source identity for this Screenpipe instance |
| `SCREENPIPE_CLI`             | Discovered              | Optional native CLI path for key discovery   |

Setup uses `SCREENPIPE_API_URL` for health and the authentication settings for key preparation. The health URL accepts HTTP origins on `127.0.0.1`, `localhost`, or `[::1]`, with a selected port. Credentials, paths, queries, fragments, and HTTPS are rejected. Do not append `/health`.

The JEV reader uses `SCREENPIPE_API_URL`; backend reads and the recording link use `SCREENPIPE_URL`. Set both URLs to the same Screenpipe instance for a shared workflow. A token discovered from the local CLI does not establish access to another instance.

Development, reset, built-API, MCP, Screenpipe registration, and `npm run jev:watch` commands load the root `.env`. Exported variables take precedence. Production builds do not load it; export desktop build settings explicitly. A changed desktop API origin also requires a matching `src-tauri/tauri.conf.json` content security policy and a rebuild. Keep UI defaults for Tauri's development URL. Browser development uses Vite's relative API proxy.

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

## Configure MCP and JEV

Root setup does not create or change the JEV workflow's `.env`. Configure its TypeSafe key and permitted fields explicitly, either in that workflow file or in the environment inherited by TimeKeeper MCP. The launcher forwards the validated configuration on both platforms.

Keep Node pinned to [`.nvmrc`](../.nvmrc). Bun is not required. After installing project dependencies, use `npm run mcp:serve` for stdio or `npm run mcp:http` for loopback HTTP at `http://127.0.0.1:3032/mcp`. Add `-- --screenpipe-link` to the HTTP command to enable recording-session synchronization explicitly.

Install the TimeKeeper registration and skill into Screenpipe:

```sh
npm run screenpipe:check
npm run screenpipe:install
```

The check is read-only. Exit code `2` means installation or an update is pending. The installer registers server ID `timekeeper` at the configured loopback MCP port, default `http://127.0.0.1:3032/mcp` in `~/.screenpipe/mcp_servers.json`. It copies the [canonical skill](../integrations/screenpipe/timekeeper/SKILL.md) to `~/.screenpipe/skills/timekeeper/SKILL.md` and the manual history pipe to `~/.screenpipe/pipes/generate-work-periods/pipe.md`. Repository sources remain in place. These locations follow Screenpipe's [MCP store](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-connect/src/mcp_servers.rs) and [skill importer](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/src-tauri/src/skills.rs). The installed macOS app reports version `2.7.109`; provider source and configuration checks do not establish end-to-end compatibility.

Set `TIMEKEEPER_MCP_PORT` in the root `.env`, or export it before running the server and installer, to use another port. Valid ports are integers from 1 to 65535. For example:

```sh
export TIMEKEEPER_MCP_PORT=4042
npm run screenpipe:check
npm run screenpipe:install
npm run mcp:http
```

For a custom Screenpipe data directory, pass its absolute path to both commands:

```sh
npm run screenpipe:install -- --screenpipe-dir /absolute/path/to/screenpipe-data
```

The installer preserves other MCP entries, unknown configuration keys, skills, and extra files. It backs up files that it replaces under `timekeeper-backups/` in the selected Screenpipe directory. Rerunning an unchanged installation leaves the installed files untouched. Malformed configuration and managed symlinks cause an error. Avoid editing MCP settings during installation. If an interrupted installer leaves `.timekeeper-install.lock`, confirm that it has stopped before deleting that lock and rerunning.

Start the TimeKeeper API and `npm run mcp:http` separately. Open a new Screenpipe chat to load the skill. Installation does not start services, enable the session link, install the Start and End pipes, change recording, or launch JEV. In chat, `sp_mcp_list_tools` with `server_id: "timekeeper"` checks discovery without starting a session. A stopped MCP server remains unavailable even when registration passes.

The root template provides `SCREENPIPE_URL` and `SCREENPIPE_INSTANCE_ID` for protected backend evidence reads. Setup fills a missing `SCREENPIPE_API_KEY`. For an existing configuration, use `npm run setup:auth`, then restart the backend. Check both Screenpipe URLs when using a nondefault port. Do not put credentials in settings or API payloads.

In the app, open **Settings → Screenpipe**. **Test connection** checks authenticated read access. **Sync now** immediately runs the same source importer used at startup and every five minutes. A TimeKeeper session must already exist. The panel reports missing configuration, no sessions, partial or failed batches, and the last successful batch since the backend started. A successful test imports nothing; a successful batch does not prove complete provider history. See [API D11](API.md#d11-screenpipe-controls-in-settings).

Open **Activity → Imported sources** to browse all references already saved in TimeKeeper, including references without a work period. Use the link-status and source-type filters, search, and page controls to inspect the complete saved list. This view does not require JEV. **Work periods** retains the existing timeline and period review. Imported observations do not enter worked-time totals automatically. See [API D12](API.md#d12-visibility-of-imported-sources).

Sync retains short source excerpts and observed app/window names when Screenpipe returns them. The first sync after this upgrade rereads prior session windows in bounded batches to fill missing text. Further batches continue automatically or through **Sync now**. Existing unlinked sources attach only when one existing period matches within one session. If no period exists, the source remains visible without a link. Search does not create worked time or generate work-period descriptions. See [API D13](API.md#d13-source-content-and-late-attachment).

## Generate work periods from recorded history

1. Run `npm run screenpipe:install` to update the TimeKeeper skill, MCP registration and manual `generate-work-periods` pipe. This command backs up replaced files and starts no workflow or recording.
2. Set `TYPESAFE_API_KEY` and explicitly approved `JEV_ALLOWED_FIELDS` in the TimeKeeper MCP server environment. The history command uses that environment; it does not read the live watcher's separate environment file. Keep credentials private. The existing JEV field allowlist applies to hosted inference.
3. Run `npm run mcp:http` alongside the application API. Enable the TimeKeeper MCP connection in Screenpipe and reload its tools after updating the server.
4. In **Settings → Screenpipe**, sync the evidence for an existing session.
5. Open **Activity → History proposals**. Select a session and range, then click **Generate work periods from history**. The default range is the latest ten minutes; the limit is one hour. A pending request is not a completed generation.
6. Review the case, observation window, description and sources. Enter the actual worked duration. Accept or reject each draft.

Accepted periods remain unvalidated and unbilled. Unknown cases can remain unresolved. Existing periods are preserved; overlapping proposals cannot be accepted. For oversized history, select a shorter range. For stale evidence or incomplete source coverage, finish sync and generate again. See [API D14](API.md#d14-history-generation-and-proposal-review).

These controls use the backend environment. They do not save credentials or start MCP/JEV. Development commands load the repository `.env`; the packaged API receives its environment from its launcher. Opening the installed app does not load the repository `.env` or complete connection setup.

Follow the [JEV setup instructions](../integrations/screenpipe/jev-check/README.md) before enabling detection. The watcher needs a separately installed `screenpipe-mcp@0.20.3`, TypeSafe credentials, and an explicitly chosen `JEV_ALLOWED_FIELDS`. Runtime uses `npx --no-install`; it does not download dependencies. Numeric options are validated before the workflow starts: confidence must be between zero and one, window and stability durations must be positive, and text limits must be positive integers. An explicit zero confidence threshold is retained. Negative, non-finite, and out-of-range settings are rejected. Including recorded text in permitted fields sends it to the hosted model. This integration is not local-only.

The launcher and watcher use the same dotenv parser and precedence: inherited variables override the watcher's local file, including explicitly empty values. On Windows, the WMI launcher passes that validated environment through process startup settings. Credentials travel over stdin to the launch helper, never in command arguments. Startup reports success only after the watcher completes both MCP dependency handshakes and acquires its lock. An early exit or readiness timeout reports failure.

Source scripts use `node --import tsx`. `npm run build` emits `dist/src/mcp/server.js` and `dist/integrations/screenpipe/jev-check/jev-check.js`. For a direct built entry, load configuration explicitly, for example `node --env-file-if-exists=.env dist/src/mcp/server.js --http` from the repository root. Building does not configure installed workflow paths, provider access, or login startup. Normal API/UI startup does not launch JEV or change recording.

The native recognizer is inactive. Its [source backup](../backups/native-recognition-d575502/README.md) preserves the pre-integration implementation. The floating pill reads accepted JEV periods and pending questions through the application API. The watcher keeps coordination-only ownership in `.watch.pid.sqlite` beside its PID diagnostic. Process death releases the transaction lock, so another start can recover a dead owner without deleting a recovery directory. This file contains no business records. New watcher diagnostics omit captured titles, text, URLs, and catalogue labels. Legacy log files are preserved, and MCP status redacts their content.

The recording link keeps its recovery copy beside `TIMEKEEPER_LINK_STATE` with a `.backup` suffix. It selects the newest valid copy after an interruption. If neither existing copy is valid, restore a known valid state before restarting the link. Do not delete recovery state to make startup appear successful; it contains session boundaries and command identities. [API D7](API.md#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe) defines this recovery behavior.

`TIMEKEEPER_INBOX` overrides the command-consumer directory; otherwise it is `inbox` next to the database. The consumer does not implement the missing stopped-app command producer. Failed commands are exposed through the [API](API.md#a14-failed-inbox-commands); a dedicated review interface remains deferred.

## Configure history proposals

The current source connects **Activity → History proposals** to an explicit Screenpipe workflow. This source addition still needs runtime and selected-provider acceptance. It requires an existing TimeKeeper session, imported evidence, the running API and TimeKeeper MCP server, and a separately installed `generate-work-periods` pipe.

`npm run screenpipe:install` registers MCP and copies its skill and the manual history pipe. `npm run screenpipe:check` verifies these installed files without running the workflow. For manual installation through Screenpipe's native CLI, use an absolute source path:

```sh
screenpipe pipe install /absolute/path/to/TimeKeeper/integrations/screenpipe/pipes/generate-work-periods
```

The pipe is manual and enabled in its source configuration. Verify its installation in the selected Screenpipe release and keep the API and MCP services running before requesting generation. Its sole command is MCP `generate_history_proposals`; no pending requested job means no inference.

Backend dispatch uses `SCREENPIPE_URL` and `SCREENPIPE_API_KEY`. Configure `TYPESAFE_API_KEY` and approved `JEV_ALLOWED_FIELDS` in the environment of the TimeKeeper MCP process. Root npm MCP commands load the root `.env`; the JEV watcher's separate local file alone does not configure history inference. The current history implementation reads `MODEL`, default `jev-latest`, instead of the live watcher's `TYPESAFE_MODEL`. These settings are not interchangeable in the current source.

Request a range longer than zero and no more than one hour from Activity. A configured indicator checks backend URL and key presence only. It does not prove that the pipe or model is ready. Review job statuses: dispatching, dispatched, dispatch-unconfirmed, running, ready, failed, and expired. An uncertain dispatch acknowledgement does not cause automatic redispatch.

Generation saves draft observation windows, assignments, and labels without adding worked time. Review each draft and explicitly supply its worked duration before acceptance. Acceptance creates a finished, unvalidated, unbilled period, rejects overlaps with existing periods, and preserves existing source ownership. [API D14](API.md#d14-history-proposals-and-explicit-acceptance) owns snapshot, revision, expiry, and replay behavior.
