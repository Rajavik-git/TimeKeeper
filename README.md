# TimeKeeper

TimeKeeper helps lawyers turn recorded work context into reviewed time by client and case. It combines Screenpipe evidence, guarded case assignments, manual corrections, time validation, and invoice preparation.

Built during an École 42 and Screenpipe hackathon. This repository contains the application and integration source. Native release and selected-provider acceptance remain incomplete.

## Why TimeKeeper exists

A lawyer can move between cases throughout the day, then need to reconstruct what happened before billing. TimeKeeper keeps the supporting observations beside each work period so the lawyer can review assignments and correct time. A screenshot proves an observation, not continuous work. The application shows incomplete estimates when evidence or pricing is missing.

## What you can do

| View     | Current behavior                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| My day   | Review periods, correct their case or duration, review sources, and validate finished periods from past local days.                  |
| Cases    | Manage cases and clients, inspect recorded time, rates, flat fees, and budget indicators.                                            |
| Billing  | Review pre-invoices, issue deposit or final invoices with frozen snapshots, record expenses and disbursements, and export CSV.       |
| Activity | Browse work-period history, audits, source packs, and imported sources; review explicitly generated history proposals.               |
| Settings | Configure clients, rates, work categories, rules, appearance, and the floating pill; test Screenpipe access and synchronize sources. |

The floating pill and browser Desk preview share the production presentation. Source validation, time validation, billing status, and invoice membership remain separate. Summaries add precise durations and round the combined total upward to minutes.

## Current implementation and limits

| Area                   | State                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local application      | React interface, Hono API, SQLite persistence, review, billing, and recovery services exist. Normal startup creates an empty workspace.                                                                        |
| Screenpipe evidence    | Authenticated connection testing, startup import, five-minute catch-up, manual synchronization, source excerpts, and late attachment exist. Imports require existing sessions and do not create work duration. |
| MCP and JEV            | Session commands, status and catalogue reads, guarded transitions, questions, recording-link support, and a JEV watcher exist. They require explicit setup and running services.                               |
| Desktop                | Tauri hosts the main window and pill. Windows NSIS packaging includes an owned API sidecar. macOS packaging and native acceptance on both platforms remain open.                                               |
| Remaining product work | Folder identification, duration derivation, immediate provider triggering, tag write-back, reconstruction approval, and durable commands while the API is stopped remain incomplete or undecided.              |

The JEV watcher currently gates case selection on a detected tab, window, or document switch. A case change caused only by content changing inside the same tab remains an acceptance gap. See [requirements and open decisions](docs/REQUIREMENTS.md#decisions-still-required).

## Technology and responsibilities

React 19, TypeScript, and Vite provide the interface. Node 24 runs the Hono API and built-in SQLite driver; Drizzle maps storage queries. Tauri 2 provides the desktop host. Screenpipe owns recording. TypeSafe's hosted JEV API evaluates only the fields approved in the local workflow configuration.

React and MCP use the HTTP API. Application services validate changes and write through repository ports. Neither the interface nor MCP opens the business database. See [architecture](docs/ARCHITECTURE.md) and the [API reference](docs/API.md).

## Prepare and run

Use the exact Node version in [`.nvmrc`](.nvmrc), currently `24.22.0`, and npm. Install Screenpipe separately and complete its onboarding using the [setup guide](docs/SETUP.md#install-node-and-screenpipe). Its local service must run for evidence access; its window can close.

From this checkout's repository root, with nvm installed:

```sh
nvm install
nvm use
node install.mjs
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on `127.0.0.1:8787`. Setup creates a missing root `.env` from [`.env.example`](.env.example), installs project dependencies, and retrieves a missing Screenpipe API key through the installed CLI. It preserves existing nonblank configuration and business data. Full setup replaces `node_modules`.

For local interface development without Screenpipe, use `node install.mjs --skip-screenpipe`. Retry only key setup with `npm run setup:auth`; repeat read-only readiness checks with `npm run setup:check`. A healthy public endpoint does not prove authenticated access or capture freshness. Use **Settings → Screenpipe → Test connection** after starting the backend.

Exported variables override `.env`. Keep credentials out of Git. Restart services after configuration changes. The packaged desktop application does not load this checkout's `.env`. [Local configuration and recovery](docs/SETUP.md#configure-local-settings) describes ports, credentials, and failures.

## Connect Screenpipe and review a session

1. Create a client in Settings and a case in Cases. Configure the applicable rates if you need fee estimates.
2. Complete [MCP and JEV setup](docs/SETUP.md#configure-mcp-and-jev). `npm run screenpipe:install` registers TimeKeeper MCP and copies its skill and manual history pipe. It does not start services or install the Start and End pipes.
3. Keep `npm run dev` running. In a separate terminal, run `npm run mcp:http` and open a new Screenpipe chat.
4. Ask Screenpipe chat to start TimeKeeper. Check the returned session status and the separate tab-detection status. JEV needs a TypeSafe key, the installed Screenpipe MCP dependency, and an explicit `JEV_ALLOWED_FIELDS` selection.
5. Review imported observations and accepted periods in My day or Activity. Answer an unresolved-case question for its original period. Source import alone does not assign a case or count worked time.
6. End the session through Screenpipe. Correct and validate its finished periods on a later local calendar day. Billing and invoice actions remain separate.

To enable the optional recording-session link, add `-- --screenpipe-link` to the MCP HTTP command. It observes Screenpipe while that MCP process runs. Closing the main window hides TimeKeeper; tray Quit stops its owned release API. Both preserve the stored session. Durable delivery to a stopped API remains open.

JEV sends approved context to TypeSafe's hosted service. Setup never chooses permitted fields or starts hosted inference. Follow the [JEV guide](integrations/screenpipe/jev-check/README.md) before enabling it. The [Screenpipe skill](integrations/screenpipe/timekeeper/SKILL.md) and manual [Start](integrations/screenpipe/pipes/start-timekeeper/pipe.md) and [End](integrations/screenpipe/pipes/end-timekeeper/pipe.md) workflows document the available commands.

## Review history proposals

Newly connected source adds **Activity → History proposals**. Select an existing session and up to one hour of imported evidence, then request generation. The separate Screenpipe workflow returns drafts. Review the proposed case, label, bounds, and supporting sources, and enter an explicit worked duration before acceptance. Drafts add no counted time. Accepted periods remain unvalidated and unbilled.

This path requires its own pipe and MCP inference configuration. It does not resolve automatic duration derivation or protected-period reconstruction. See [history setup](docs/SETUP.md#configure-history-proposals) and [API D14](docs/API.md#d14-history-proposals-and-explicit-acceptance). Runtime acceptance of this new source remains pending.

## Run the desktop application

Follow the [Tauri prerequisites and desktop setup](docs/SETUP.md#prepare-desktop-development). During development, keep `npm run dev:server` running in one terminal and run `npm run desktop:dev` in another. Tauri starts Vite.

Windows builds use `npm run desktop:build` and produce an NSIS installer with the API sidecar. The [Windows build workflow](.github/workflows/desktop-windows.yml) also builds artifacts. The package does not include Screenpipe or the separate MCP/JEV workflow. Source and build checks do not establish native acceptance.

## View sample comparisons

Normal setup and startup create no fictional business records. To inspect an explicit comparison preview, use a separate database:

```sh
npm run db:samples -- --database data/comparison-preview.db
TIMEKEEPER_DB=data/comparison-preview.db TIMEKEEPER_INBOX=data/comparison-inbox SCREENPIPE_API_KEY= TIMEKEEPER_PORT=8788 UI_PORT=5174 npm run dev
```

Open `http://127.0.0.1:5174/` and select Cases. This is a POSIX shell example. Set the same environment variables explicitly in PowerShell before running the command there. The preview contains two labelled fictional companies and a 2:1 monthly recorded-time comparison. Near midnight, sample periods shorten to avoid future timestamps. Cases compares the whole workspace; incomplete records can make the comparison unavailable.

The importer requires `--database PATH`, preserves existing records and human edits on rerun, backs up compatible targets, and rejects pending migrations. `--dry-run` inspects the plan without opening a database. See [sample tooling](docs/SETUP.md#comparison-sample-tooling). `npm run db:reset` deletes the selected database and is limited to disposable data.

## Development and verification

Run the project checks after installing dependencies:

```sh
npm run format:check
npm run lint
npm test
npm run typecheck
npm run build
```

Use `npm run format` or `npm run lint:fix` for available fixes. `npm run contract:gen` regenerates state schemas, API types, and request validators from their owning sources. Generated files are not the place to change business rules.

Automated tests use isolated fixtures and stand-in providers. Run the [Playwright MCP smoke procedure](tests/acceptance/README.md) separately with its isolated database, inbox, and disabled live import. Browser checks do not prove native lifecycle, real Screenpipe behavior, or hosted inference. Documentation-only changes require formatting, links, commands, and source consistency checks. See [contributor instructions](AGENTS.md).

## Repository map

| Path                       | Responsibility                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `src/frontend/`            | Screens, shared components, typed API client, and detailed-record summaries.   |
| `src/backend/`             | Domain rules, application services, API, adapters, workers, and bootstrap.     |
| `src/contracts/`           | OpenAPI transport definitions and generated shared contracts.                  |
| `src/mcp/`                 | TimeKeeper MCP server, session link, workflow commands, and watcher launch.    |
| `src-tauri/`               | Desktop windows, release API lifecycle, capabilities, and packaging.           |
| `integrations/screenpipe/` | JEV watcher, Screenpipe skill, and manual workflows.                           |
| `scripts/`                 | Setup helpers, contract generation, sidecar builds, and explicit data tooling. |
| `tests/`                   | Unit and integration checks, isolated fixtures, and browser acceptance.        |

## Documentation

| Topic                                                          | Document                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Installation, credentials, desktop builds, and recovery        | [Setup](docs/SETUP.md)                                        |
| Business rules, acceptance examples, and open decisions        | [Requirements](docs/REQUIREMENTS.md)                          |
| Modules, lifecycle, integration boundaries, and current limits | [Architecture](docs/ARCHITECTURE.md)                          |
| HTTP API, MCP tools, and integration contracts                 | [API reference](docs/API.md)                                  |
| SQLite storage, migrations, replay, and fixtures               | [Database](docs/DATABASE.md)                                  |
| Visual standards and screen behavior                           | [Design](design.md)                                           |
| Dated provider capabilities and unresolved event contracts     | [Screenpipe research](docs/SCREENPIPE_INTEGRATION.md)         |
| Hosted JEV configuration and watcher behavior                  | [JEV guide](integrations/screenpipe/jev-check/README.md)      |
| Browser smoke procedure and acceptance limits                  | [Browser acceptance](tests/acceptance/README.md)              |
| Contributor responsibilities and verification                  | [AGENTS.md](AGENTS.md)                                        |
| Preserved French logical schema                                | [Original database](docs/reference/ORIGINAL_DATABASE.md)      |
| Inactive native-recognition source recovery                    | [Native backup](backups/native-recognition-d575502/README.md) |
