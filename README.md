# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The five-tab local application uses the session, work-period, source, question, and billing tables from [the database design](docs/DATABASE.md). New databases contain no clients, cases, sessions, activity, evidence, or invoices. Initial preferences have a blank identity, a zero base rate, and invoice numbering starting at 1. Work categories remain available. Current screens use typed canonical catalogue, period, source, audit, and billing payloads. Older API contracts remain in a separate deprecated compatibility router; current UI and export operations do not depend on numeric entry aliases. Duration corrections, separate review states, session commands, missing coverage, and React-owned summaries are implemented. Screenpipe integration remains unavailable; [remaining gaps](docs/MOCKUP_GAP.md) include command delivery while the app is closed and provider tag verification.

The interface uses the monochrome Seal identity, a floating top menu, a larger reading scale, and a landscape shell with minimal internal scrollbars for long lists and distinct table headers. Shared selects, summary tiles, cards, the My day calendar, and the Desk pill selector follow the approved HTML mockup in light and dark themes at 1440×900 and 1280×800. My day starts with one-click validation of recognized periods and a side-by-side case question; its calendar marks pending, validated, and empty days. Shared controls provide quick hover and visible keyboard focus feedback, and actions show a bottom-right status message. The My day table signals editable durations, filters by client and case, exports its visible periods in screen order, and fades when more rows are below the fold. Manual entry remains unavailable until its session and time rules are defined. Cases has a practice dashboard with sortable client cards and expandable per-case billing rows, a client level, and case detail with clickable breadcrumbs. The tabs are My day, Cases, Billing, Activity, and Settings; Desk pill controls and preview are under Settings. The interface uses US number formats and USD as the initial currency. Its Oxford/Ink palette gives Validate actions and review statuses distinct colours. See the [interface guide](docs/implementation/interface.md) for the layout and test scope.

Node.js 24 LTS is required. [`.nvmrc`](.nvmrc) pins the development and CI version. With nvm installed, run `nvm install` and `nvm use` from the repository root before the npm commands. From the repository root, run `npm ci`, then `npm run dev` to open the UI at `http://127.0.0.1:5173`. Run the [development checks](#development-checks) before submitting changes. `npm run contract:gen` refreshes generated API types. The [MCP browser smoke workflow](tests/acceptance/README.md) runs `tests/acceptance/smoke.mcp.js` through Playwright MCP against an isolated test database. It covers five tabs, the three-level Cases navigation, the pill preview, and page height at 1440×900 and 1280×800, with optional light and dark screenshots. Startup creates an empty database when needed and preserves existing records. `npm run db:reset` deletes the selected database and recreates it without sample records. It is not a required startup step. Fictional regression fixtures live under `tests/fixtures/` and are loaded only by explicit test setup. The demo reset endpoint and UI control have been removed.

For Tauri development, run `npm run dev:server` separately, then `npm run desktop:dev`. `npm run desktop:build` builds the Windows desktop shell. The Node API is still a separate process and is not packaged in the installer. Native Windows and macOS acceptance, Screenpipe capture and event delivery, and installed-app behavior remain unverified.

## Local environment

Persistence uses Drizzle ORM `1.0.0-rc.4` with the built-in `node:sqlite` driver. The native adapter requires this release-candidate line, so the version is pinned. Existing versioned SQL migrations remain authoritative; no schema push or database reset is needed for this dependency change. See [storage ownership](docs/ARCHITECTURE.md#storage-and-implementation-gates).

The frontend development server and backend share a root `.env` file. Copy [`.env.example`](.env.example) to `.env` if it is missing, then edit the values for your machine. Git ignores `.env`.

`npm run dev`, `npm run dev:server`, `npm run dev:ui`, `npm run db:reset`, and `npm run api:serve` load this file with Node's built-in environment loader. Exported shell variables take precedence. The commands still use their existing defaults when the file is absent. Restart the development processes after changing the file.

| Variable                     | Default                 | Purpose                                           |
| ---------------------------- | ----------------------- | ------------------------------------------------- |
| `UI_HOST`                    | `127.0.0.1`             | Frontend development server host.                 |
| `UI_PORT`                    | `5173`                  | Frontend development server port.                 |
| `TIMEKEEPER_PORT`            | `8787`                  | Local API port and frontend proxy target.         |
| `VITE_TIMEKEEPER_API_URL`    | `http://127.0.0.1:8787` | Desktop frontend API origin, fixed at build time. |
| `TIMEKEEPER_DB`              | `data/timekeeper.db`    | SQLite path relative to the repository root.      |
| `TIMEKEEPER_ALLOWED_ORIGINS` | Empty                   | Additional allowed origins, comma-separated.      |

Keep `UI_HOST` and `UI_PORT` at their defaults for Tauri's development URL. When changing its backend port, set `TIMEKEEPER_PORT` and the matching `VITE_TIMEKEEPER_API_URL`, then allow that loopback origin in `src-tauri/tauri.conf.json`'s content security policy. Export `VITE_TIMEKEEPER_API_URL` when invoking a production build; the build command does not load the root `.env` file. Browser development keeps relative API requests through Vite's proxy. The desktop API URL accepts only HTTP loopback origins without credentials, paths, or query parameters. Screenpipe and JEV configuration is not connected yet.

Date operations use pinned `date-fns` 4.1.0 and `@date-fns/tz` 1.4.1 through one shared module. The UI sends its calendar timezone with date filters and new invoice or source-export snapshots. See the [calendar policy](docs/DATABASE.md#calendar-dates-and-timestamps).

## Development checks

| Command                | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `npm run format`       | Format supported source, configuration, and documentation files with Prettier. |
| `npm run format:check` | Check formatting without changing files.                                       |
| `npm run lint`         | Check JavaScript, TypeScript, and React Hooks. Warnings fail the check.        |
| `npm run lint:fix`     | Apply available ESLint fixes and report remaining issues.                      |
| `npm test`             | Run unit and integration tests.                                                |
| `npm run typecheck`    | Check backend and frontend TypeScript types.                                   |
| `npm run build`        | Build the API and browser interface.                                           |

Run `npm run format:check`, `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` to verify changes. Run the [MCP browser smoke workflow](tests/acceptance/README.md) separately for interface acceptance; it is not part of `npm test`. Prettier owns formatting; ESLint uses the recommended JavaScript and TypeScript rules plus React Hooks checks. Generated API types, build output, local data, and dependencies are excluded. Prettier also excludes the npm lockfile and respects `.gitignore`. Rust and SQL files are outside these tools' scope.

## MVP behavior and retained billing extensions

- Explicit API commands start and end sessions. The active session survives closing the interface, and duplicate commands preserve the original boundaries.
- Work periods carry precise detected and corrected milliseconds. An unknown duration stays unknown. React sums precise durations and rounds only each combined group total up to whole minutes.
- An unresolved period opens its own question in the same transaction. Answers target its period and expected assignment revision. Marker suggestions remain demo aids; folder identification is undecided.
- Time validation, source validation and availability, and per-period billed status are separate. Effective case or duration changes require renewed time validation.
- The retained mockup adds client rates, flat fees, budgets, expenses, VAT, and numbered invoices. React prepares the invoice snapshot; the API validates referenced periods and stores the supplied frozen lines and totals. The applied hourly rate is fixed when a period is marked billed.
- A screenshot proves an observation, not continuous work. Historical minutes in test fixtures are explicit values; no live interval reconstruction or Screenpipe recording is implemented.

**Proposed monetary rounding:** for one case on one invoice, billable minutes are `ceil(sum of precise period milliseconds / 60000)`; the work amount is `round(billable minutes × hourly rate cents / 60)` to whole cents. This is implemented for the demo invoice draft and awaits a requirements decision.

Read-only chat tools, installed Screenpipe workflows, capture, and native packaging remain future work. The [requirements](docs/REQUIREMENTS.md) define the acceptance journey; the [design review](docs/DESIGN_REVIEW.md) tracks provider and product gates.

## Documentation

| Document                                                          | Responsibility                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Requirements](docs/REQUIREMENTS.md)                              | Agreed business rules, use cases, acceptance examples, and open product decisions. |
| [Architecture](docs/ARCHITECTURE.md)                              | Components, ownership, lifecycle, and recovery.                                    |
| [Database](docs/DATABASE.md)                                      | Work-period model, proposed fields, and integrity constraints.                     |
| [Original database](docs/reference/ORIGINAL_DATABASE.md)          | Historical transcription of the supplied diagram.                                  |
| [Screenpipe integration research](docs/SCREENPIPE_INTEGRATION.md) | API evidence, proposed matching methods, and provider limitations.                 |
| [Screenpipe event research](docs/SCREENPIPE_EVENTS.md)            | Trigger mechanisms and release verification gates.                                 |
| [Design review](docs/DESIGN_REVIEW.md)                            | Remaining risks and implementation checkpoints.                                    |
| [Contributor instructions](AGENTS.md)                             | Code organization, dependency rules, and working practices.                        |
| [Mockup gap](docs/MOCKUP_GAP.md)                                  | Differences between the validated mockup and the requirements.                     |
| [Mockup implementation](docs/implementation/architecture.md)      | Imported schema, architecture, recognition, interface, and desktop behavior.       |

The requirements define product behavior. The architecture and database documents explain its intended implementation. Research evidence does not establish runtime support in an installed release.

The [data-format explanation](docs/DATABASE.md#data-formats-in-the-application) maps SQLite columns to current JSON fields. It explains string IDs, millisecond durations, cents and currency, strict calendar dates, explicit timezones, and the separate deprecated API.

Start with [how to read the schema](docs/DATABASE.md#how-to-read-the-schema) for the core tables, ID choices, fixed states, and file responsibilities. `src/contracts/openapi.yaml` is the HTTP API specification, unrelated to OpenAI. It generates TypeScript API types and request validators; it does not create SQLite tables. Edit the specification and run `npm run contract:gen` rather than editing generated files.

## Mockup vs requirements at a glance

The code on this branch aligns the five conflicts with the [requirements](docs/REQUIREMENTS.md). Details are in the [mockup gap](docs/MOCKUP_GAP.md); decision numbers refer to the next section.

| Status | Meaning                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------- |
| 🟢     | Aligned rule implemented in the local demo.                                                    |
| 🔵     | Kept by team decision, although the requirements exclude it. The requirements must be updated. |
| 🟡     | Mockup only: the requirements do not cover it. A decision is needed.                           |
| 🔴     | Conflict: the mockup and the requirements follow different rules.                              |
| ⚪     | Required behavior is absent or only partly built.                                              |

| Topic                                          | Mockup (built)                                                                                           | Requirements                      | Status | Decision |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- | :----: | :------: |
| Stack                                          | Tauri, React, local Node API, SQLite                                                                     | Same                              |   🟢   |    —     |
| Evidence source                                | Fictional Screenpipe references; live API retrieval not connected                                        | Screenpipe API only               |   ⚪   |    —     |
| Clients and cases                              | A case belongs to one client                                                                             | Same                              |   🟢   |    —     |
| Case and global rate                           | Case rate, fallback base rate                                                                            | Case rate, fallback global rate   |   🟢   |    —     |
| Manual corrections win                         | Lawyer changes override automatic results                                                                | Same                              |   🟢   |    —     |
| Billed / unbilled status                       | Per work period in the aligned interface                                                                 | Per work period                   |   🟢   |    —     |
| JEV role                                       | Fictional stored review examples; no workflow integration                                                | Screenpipe workflow owns requests |   ⚪   |    —     |
| Pre-invoices and numbered invoices             | Built: VAT, expenses, disbursements, frozen lines                                                        | Excluded                          |   🔵   |    1     |
| Client rates                                   | Case > client > base rate                                                                                | Excluded                          |   🔵   |    1     |
| Flat fees and budgets                          | Built, 85% budget alert                                                                                  | Excluded                          |   🔵   |    1     |
| Client rules                                   | Built, checked before issuing                                                                            | Not covered                       |   🔵   |    1     |
| Case recognition                               | Weighted markers, score, threshold, learning                                                             | Undefined                         |   🟡   |  2, 11   |
| Case reference format                          | `YYYY-NNN-CODE`, generated                                                                               | Format undecided                  |   🟡   |    2     |
| Task types and non-billable reasons            | Built                                                                                                    | Not covered                       |   🟡   |    —     |
| Off-screen time added by hand                  | Built                                                                                                    | Not confirmed                     |   🟡   |    10    |
| Personal apps left out                         | Built, recoverable                                                                                       | Not covered                       |   🟡   |    —     |
| Desk pill with session and current-period time | Built as a local shell                                                                                   | UI not specified                  |   🟡   |    12    |
| Source pack with SHA-256                       | Built                                                                                                    | Not covered                       |   🟡   |    —     |
| Audit trail                                    | Built                                                                                                    | Undecided                         |   🟡   |    —     |
| Duration unit and rounding                     | Precise milliseconds in work periods; totals rounded once                                                | Same                              |   🟢   |    5     |
| Where amounts are calculated                   | React for active summaries and invoice drafts; issued invoice snapshots are frozen                       | React                             |   🟢   |    5     |
| Review states                                  | Time, source, availability, and billing states separated                                                 | Same                              |   🟢   |    6     |
| Writes through the application layer           | API mutations enter services; compatibility adapters project canonical business records                  | All writes                        |   🟢   |    —     |
| Data model                                     | Sessions and work periods plus documented billing extensions; old tables retained for demo compatibility | Sessions and work periods         |   🟢   |    3     |
| Session start/end commands                     | Idempotent local API implemented; Screenpipe trigger integration pending                                 | Required                          |   ⚪   |    4     |
| Unknown-folder question to the lawyer          | Period-bound question and guarded answer implemented                                                     | Same                              |   🟢   |    2     |
| Duration correction kept apart from detection  | Implemented                                                                                              | Required                          |   🟢   |    —     |
| Source validation and availability             | Implemented per source                                                                                   | Required                          |   🟢   |    6     |
| Coverage gaps shown                            | Explicit retrieval gap and incomplete source state shown                                                 | Required                          |   🟢   |    3     |
| Reconstruction conflicts                       | Persisted; review UI pending                                                                             | Required                          |   ⚪   |    —     |
| Case tags written back to Screenpipe           | —                                                                                                        | Required                          |   ⚪   |    —     |
| Read-only MCP for Screenpipe chat              | —                                                                                                        | Required                          |   ⚪   |    —     |
| End command while the app is closed            | —                                                                                                        | Required, mechanism open          |   ⚪   |    4     |
| Live Screenpipe capture                        | Not connected                                                                                            | Required                          |   ⚪   |   2, 3   |

## Decisions to make

The team builds from the validated mockup's structure, inside the code organization above. Decision 1 is recorded in the requirements. The remaining decisions block parts of the MVP and show proposed options for discussion. See the [mockup gap](docs/MOCKUP_GAP.md) and the [design review](docs/DESIGN_REVIEW.md) for details.

| Priority | Decision                                                    | Status or proposed option                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Billing scope.                                              | **Agreed (2026-10-17): keep the mockup's billing features**: pre-invoices; numbered deposit and final invoices with frozen lines; expenses, disbursements, VAT; client rates with case > client > base cascade; flat fees; budgets with an 85% alert; and client rules. Recorded in [requirements](docs/REQUIREMENTS.md#purpose-and-scope). |
| 2        | Folder identification.                                      | Match the case reference, case title, or a known folder or file name in the window title, file path, or URL. Otherwise, create an unresolved period and ask the lawyer.                                                                                                                                                                     |
| 3        | Duration derivation from observations.                      | A period runs from one case transition to the next. A gap of more than five minutes without observations is shown as missing coverage and not counted.                                                                                                                                                                                      |
| 4        | End command while TimeKeeper is closed.                     | The Screenpipe pipe writes commands to a local inbox folder; TimeKeeper imports them in order at startup.                                                                                                                                                                                                                                   |
| 5        | Billing unit and where amounts are calculated.              | **Agreed (2026-10-17): follow the requirements.** Precise milliseconds, combined-total minute rounding, and React-owned active calculations. Monetary rounding above remains proposed.                                                                                                                                                      |
| 6        | Review states in the interface.                             | **Agreed (2026-10-17): follow the requirements.** Separate time validation, source validation and availability, and billing status.                                                                                                                                                                                                         |
| 7        | Applied rate snapshot.                                      | Fix the rate when a period is marked billed.                                                                                                                                                                                                                                                                                                |
| 8        | Editing a billed period.                                    | Not allowed until the period is marked unbilled again.                                                                                                                                                                                                                                                                                      |
| 9        | Periods counted in each total.                              | Count every period with an effective duration; show the validated share separately.                                                                                                                                                                                                                                                         |
| 10       | Manual periods without evidence (hearing, meeting, travel). | Allow them, marked as manual, with time validation required.                                                                                                                                                                                                                                                                                |
| 11       | Automatic recognition with weighted markers and learning.   | Use markers for suggestions only; the lawyer confirms. Defer learning.                                                                                                                                                                                                                                                                      |
| 12       | Desk pill content.                                          | Show the active session, the active case, and the time of the current period; show amounts only once decision 5 is applied.                                                                                                                                                                                                                 |
