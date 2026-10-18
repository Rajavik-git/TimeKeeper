# Prepare the local environment

## Install Node and dependencies

Use Node `24.22.0` from [`.nvmrc`](../.nvmrc) and npm. Full setup needs an installed Screenpipe CLI and running service. To prepare only the interface, add `--skip-screenpipe`. With nvm installed, run from the repository root:

```sh
nvm install
nvm use
node install.mjs
```

Setup creates a missing `.env` from [`.env.example`](../.env.example) and runs `npm ci --include=dev --no-audit --no-fund`. Setup also tries to configure a missing Screenpipe API key through the installed CLI. Existing nonblank credentials, other configuration, and databases are preserved. Repeating full setup replaces `node_modules`. An absolute script path also works from another directory.

| Option or command     | Behavior                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| `npm run setup`       | Install dependencies, configure a missing Screenpipe key, and check public health. |
| `npm run setup:check` | Check prerequisites without setup writes.                                          |
| `npm run setup:auth`  | Configure a missing Screenpipe key without reinstalling dependencies.              |
| `--skip-screenpipe`   | Skip Screenpipe key discovery and the health request.                              |
| `--desktop`           | Also check `rustc` and `cargo`, without installing platform tools.                 |
| `--help`              | Display options.                                                                   |

Flags can be combined, such as `node install.mjs --check --desktop --skip-screenpipe`. `--auth-only` also skips dependency checks. It cannot be combined with `--skip-screenpipe`. The dependency check detects npm's installed marker. It does not verify integrity or lockfile agreement. Setup never registers MCP, installs skills or pipes, starts recording, or opens the business database.

## Run the browser interface

1. Run `npm run dev` to start the API and Vite.
2. Open `http://127.0.0.1:5173`.

The API binds to `127.0.0.1:8787`. Startup applies migrations and creates neutral settings without sample business records. Create clients in Settings and cases in Cases. Stopping the API does not end an active session.

For built API output, run `npm run build`, then `npm run api:serve`. This command does not serve the browser interface. Use the [MCP setup](../integrations/screenpipe/README.md#set-up) for session commands through Screenpipe.

## Connect Screenpipe

1. Install Screenpipe using its [official guide](https://docs.screenpipe.com/getting-started). Complete onboarding and configure the capture features you need. Its local service normally listens on port 3030.
2. On macOS, grant the selected features their [required permissions](https://docs.screenpipe.com/permissions).
3. Run `npm run setup:auth` to configure a missing local API key. For a complete first setup, `node install.mjs` also performs this step.
4. Set `SCREENPIPE_URL` if the service uses another address, then restart TimeKeeper's API.
5. Run `npm run setup:check` for prerequisites, credential configuration, and public health. Open the desk pill or Activity to check protected reads. Authentication failures and unavailable recordings appear separately.

### Automatic key setup

```sh
npm run setup:auth
```

The script preserves an existing `SCREENPIPE_API_KEY` or configured `SCREENPIPE_API_KEY_FILE`. An exported key remains in your process environment. When no credential is configured, setup tries the installed `screenpipe auth token` command, then an offline `npx --no-install screenpipe auth token` fallback. It does not download a CLI or start recording.

A successful discovery saves the key in the ignored root `.env` without printing it. The update preserves unrelated settings and refuses concurrent configuration changes. On POSIX systems, the replacement file is readable and writable only by its owner.

If Screenpipe is installed outside `PATH`, set `SCREENPIPE_CLI` to the absolute path of its native executable in `.env`, then retry. Use an executable that supports `auth token`. If a configured key file is unavailable, correct its path; setup preserves that configuration rather than replacing it with another credential.

If an empty exported `SCREENPIPE_API_KEY` masks a saved key, unset that exported variable before retrying automatic setup. Setup preserves the saved key and reports the override. A whitespace-only direct key also requires correction.

`--check` never runs token discovery or writes configuration. It checks credential configuration without proving the token works. Setup and auth-only commands return code `2` when key setup or public health remains incomplete, with a recovery message. They never print raw CLI errors or credentials.

### Get the key manually

The [official Screenpipe authentication guide](https://docs.screenpipe.com/getting-started#api-authentication) documents the local token command. In your own terminal, run:

```sh
screenpipe auth token
```

Copy its output into the root `.env`:

```dotenv
SCREENPIPE_API_KEY=<your local Screenpipe token>
```

If the native command is unavailable, the official CLI command is:

```sh
npx -y screenpipe@latest auth token
```

That manual fallback can download the CLI. The automatic setup fallback uses offline mode. Use the token from the same Screenpipe instance and data directory as the service TimeKeeper reads. Keep the real token out of Git, screenshots, logs, and chat.

For a key file instead, set `SCREENPIPE_API_KEY_FILE` to its absolute path and leave `SCREENPIPE_API_KEY` empty. A direct key takes precedence over the key file. Restart TimeKeeper's API after changes.

### Keep the credentials separate

`SCREENPIPE_API_KEY` authenticates reads from Screenpipe's local API. `TIMEKEEPER_MCP_TOKEN` protects TimeKeeper's own MCP server and is a separate random token you generate locally. JEV's model-provider credential is separate again; use the existing JEV implementation's configuration when integrating it. [MCP setup](../integrations/screenpipe/README.md#set-up) explains its token and connection.

The backend keeps the Screenpipe key out of browser responses. The recording service must run for reads; its visible window does not need to remain open.

Setup's only HTTP request remains `GET /health`, without credentials or redirects, with a five-second timeout. It requires HTTP success and JSON `status: "healthy"`. Success does not prove authenticated search, recent capture, MCP compatibility, or tag synchronization. See [Screenpipe API readiness](https://docs.screenpipe.com/getting-started#verify-its-running).

For Screenpipe chat and optional recording-linked sessions, follow [integration setup](../integrations/screenpipe/README.md). Starting `npm run mcp:serve` enables that link and can change session state. Setup itself does not start it.

## Prepare desktop development

The current build scripts support a Windows x64 sidecar and Windows NSIS packaging. The sidecar builder also has Linux targets, but desktop packaging and native acceptance there are not configured. It has no macOS target; use browser development on macOS until that build path exists.

On Windows:

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), including C++ Build Tools, the MSVC Rust toolchain, and WebView2.
2. Run `node install.mjs --desktop`.
3. Keep `npm run dev:server` running in one terminal.
4. Run `npm run desktop:dev` in another. Tauri starts Vite.

Debug Tauri uses the separately running API. Main-window close hides the window; tray **Quit** exits Tauri. Neither action ends the stored session.

### Build the Windows package

Run `npm run desktop:build` on Windows. Alternatively, run the [Windows installer workflow](../.github/workflows/desktop-windows.yml), which also runs for `v*` tags, and download its NSIS `.exe` artifact.

The release package includes the API and a Node sidecar. Tauri starts it, waits for readiness, and uses the application-data directory for SQLite and logs. Tray **Quit** stops the owned sidecar. Parent-process checks protect against an orphan after a host crash. The release does not load this checkout's `.env`; configure its process environment separately.

The package does not include Screenpipe or the separate MCP process. Build checks do not establish native lifecycle or provider acceptance on either target platform.

## Configure local settings

Edit the root `.env`; Git ignores it. Exported variables override the same named values in `.env`. Restart processes after changes.

| Variable                     | Default                 | Purpose                                                                     |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `UI_HOST`                    | `127.0.0.1`             | Vite host.                                                                  |
| `UI_PORT`                    | `5173`                  | Vite port.                                                                  |
| `TIMEKEEPER_PORT`            | `8787`                  | API port and Vite proxy target.                                             |
| `VITE_TIMEKEEPER_API_URL`    | `http://127.0.0.1:8787` | Desktop API origin, fixed at build time.                                    |
| `TIMEKEEPER_DB`              | `data/timekeeper.db`    | Development SQLite path. Relative paths resolve from the working directory. |
| `TIMEKEEPER_ALLOWED_ORIGINS` | Empty                   | Additional API origins, comma-separated.                                    |
| `SCREENPIPE_URL`             | Unset                   | Preferred Screenpipe origin for runtime and setup.                          |
| `SCREENPIPE_API_URL`         | `http://127.0.0.1:3030` | Fallback when `SCREENPIPE_URL` is empty or unset.                           |
| `SCREENPIPE_API_KEY`         | Empty                   | Bearer token for protected Screenpipe reads.                                |
| `SCREENPIPE_API_KEY_FILE`    | Unset                   | Token file used when the direct key is empty.                               |
| `SCREENPIPE_CLI`             | Unset                   | Absolute native CLI path for automatic key discovery.                       |

Screenpipe URL selection resolves `SCREENPIPE_URL` first, then `SCREENPIPE_API_URL`, then the default. A nonempty `.env` value for `SCREENPIPE_URL` takes precedence over an exported `SCREENPIPE_API_URL`. Use one variable consistently. Setup accepts only HTTP loopback origins without credentials, paths, queries, or fragments.

Development, reset, built-API, and npm MCP commands load the root `.env`. Desktop production builds do not load it automatically. Export desktop build settings explicitly. Changing the desktop API origin also requires the matching content security policy in `src-tauri/tauri.conf.json` and a rebuild. Keep UI defaults for Tauri's development URL.

The [integration environment reference](../integrations/screenpipe/README.md#environment) covers MCP authentication, ports, launch commands, and session-link state.

## Resolve setup failures

| Exit code | Meaning                                    | Action                                   |
| --------- | ------------------------------------------ | ---------------------------------------- |
| `0`       | Selected checks passed.                    | Start the app.                           |
| `1`       | A configuration or setup operation failed. | Correct the reported error and rerun.    |
| `2`       | A prerequisite or service is unavailable.  | Install or start it, then repeat checks. |

Match Node to `.nvmrc`. Resolve npm's lockfile, registry, or network error before repeating installation. For unhealthy Screenpipe, check its service, port, [permissions](https://docs.screenpipe.com/permissions), and [recording diagnostics](https://docs.screenpipe.com/troubleshooting). A protected-read refusal requires the token from the same Screenpipe instance. Keep authentication enabled.

`npm run db:reset` deletes the selected database. Use disposable data and the [isolated browser acceptance procedure](../tests/acceptance/README.md) for checks. Setup never resets data.

## Comparison-sample tooling

Normal startup never imports samples. For an explicit fictional comparison preview, select a separate database:

```sh
npm run db:samples -- --database data/comparison-preview.db
TIMEKEEPER_DB=data/comparison-preview.db TIMEKEEPER_PORT=8788 UI_PORT=5174 npm run dev
```

Open `http://127.0.0.1:5174/` and select Cases. This example uses POSIX shell syntax. In PowerShell, set the same process environment variables before running `npm run dev`. The preview creates labelled fictional clients and a 2:1 monthly recorded-time comparison. Near midnight, sample periods shorten to avoid future timestamps.

The importer requires nonblank `--database PATH`, with no `TIMEKEEPER_DB` fallback. `--dry-run` opens no database. It backs up compatible existing targets, rejects pending migrations, and preserves human edits on rerun. Sample-import backups are not a general recovery policy. Use a working database only when its modification is explicitly authorized.
