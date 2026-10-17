# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The five-tab fictional demo now uses the session, work-period, source, question, and billing tables from [the database design](docs/DATABASE.md). The imported 18-table mockup remains as a compatibility catalogue and evidence display; its API writes now enter application services and synchronize canonical records where applicable. Duration corrections, separate review states, session commands, missing coverage, and React-owned summaries are implemented. This is a demo, not a live Screenpipe integration; [remaining gaps](docs/MOCKUP_GAP.md) include command delivery while the app is closed and provider tag verification.

The interface uses the monochrome Seal identity, a floating top menu, a larger reading scale, and a landscape shell with internal scrolling for long lists. My day starts with one-click validation of recognized periods and a side-by-side case question; its calendar marks pending, validated, and empty days. Cases has a practice dashboard with sortable client cards and expandable per-case billing rows, a client level, and case detail with clickable breadcrumbs. The tabs are My day, Cases, Billing, Activity, and Settings; Desk pill controls and preview are under Settings. The refreshed US demo uses dollars, US number formats, American names and companies, and zero sales tax. Its Oxford/Ink palette gives Validate actions and review statuses distinct colours. See the [interface guide](docs/implementation/interface.md) for the layout and test scope.

Node.js 22.13 or newer is required. From the repository root, run `npm ci`, `npm run db:reset`, then `npm run dev` to open the UI at `http://127.0.0.1:5173`. Run `npm test`, `npm run typecheck`, and `npm run build` to verify the package. `npm run contract:gen` refreshes generated API types. The browser smoke test at `tests/acceptance/smoke.py` covers five tabs, the three-level Cases navigation, the pill preview, and page height at 1440×900 and 1280×800 in a local Chromium with Python Playwright installed. Set `CAPTURE_DIR` to save light and dark screenshots. An existing local database retains its data until Reset demo is chosen.

For Tauri development, run `npm run dev:server` separately, then `npm run desktop:dev`. `npm run desktop:build` builds the Windows desktop shell. The Node API is still a separate process and is not packaged in the installer. Native Windows and macOS acceptance, Screenpipe capture and event delivery, and installed-app behavior remain unverified.

## MVP behavior and retained demo extensions

- Explicit API commands start and end sessions. The active session survives closing the interface, and duplicate commands preserve the original boundaries.
- Work periods carry precise detected and corrected milliseconds. An unknown duration stays unknown. React sums precise durations and rounds only each combined group total up to whole minutes.
- An unresolved period opens its own question in the same transaction. Answers target its period and expected assignment revision. Marker suggestions remain demo aids; folder identification is undecided.
- Time validation, source validation and availability, and per-period billed status are separate. Effective case or duration changes require renewed time validation.
- The retained mockup adds client rates, flat fees, budgets, expenses, VAT, and numbered invoices. React prepares the invoice snapshot; the API validates referenced periods and stores the supplied frozen lines and totals. The applied hourly rate is fixed when a period is marked billed.
- A screenshot proves an observation, not continuous work. The demo's historical minutes are explicit seed values; no live interval reconstruction or Screenpipe recording is implemented.

**Proposed monetary rounding:** for one case on one invoice, billable minutes are `ceil(sum of precise period milliseconds / 60000)`; the work amount is `round(billable minutes × hourly rate cents / 60)` to whole cents. This is implemented for the demo invoice draft and awaits a requirements decision.

Read-only chat tools, installed Screenpipe workflows, capture, and native packaging remain future work. The [requirements](docs/REQUIREMENTS.md) define the acceptance journey; the [design review](docs/DESIGN_REVIEW.md) tracks provider and product gates.

## Screenpipe integration

### Start TimeKeeper button and tab detection

Screenpipe runs on its own; a TimeKeeper session starts only when the lawyer runs the manual **Start TimeKeeper** pipe. It calls the TimeKeeper MCP tool `start_session`: an active session is left unchanged, otherwise a new one starts. While a session runs, the same tool starts the read-only JEV tab-change detection in the background; it stops when the session ends. See [API D7](docs/API.md#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe) and the [architecture](docs/ARCHITECTURE.md#start-button-and-tab-detection).

1. Start the API (`npm run dev:server`) and register the MCP server in Screenpipe, for example as a custom HTTP connection to `http://127.0.0.1:3032/mcp` after running `npx tsx src/mcp/server.ts --http` (Screenpipe's bundled `bun` also runs it).
2. Install [integrations/screenpipe/pipes/start-timekeeper](integrations/screenpipe/pipes/start-timekeeper/pipe.md) with the CLI of your Screenpipe release, as for the JEV pipe below. If pipes cannot call MCP tools, set `TIMEKEEPER_START_COMMAND` in its `.env` (see its `.env.example`).
3. For tab detection, fill `integrations/screenpipe/jev-check/.env` from its `.env.example`. Without it, sessions still start and the result reports `tab_detection: not_configured`. Set `TIMEKEEPER_TAB_DETECTION=off` to disable it.

These steps have been checked with a stand-in API and the real Screenpipe MCP on Windows, not yet with the Node API or an installed pipe run.

### Optional JEV integration for Screenpipe

The integration consists of [pipe.md](integrations/screenpipe/pipes/timekeeper/pipe.md). Its instructions let the Screenpipe agent ask JEV whether the active case changed and, if so, which existing case matches. The pipe needs no helper script, SDK, package install, or separate skill import. To run the chain Screenpipe → MCP → JEV → result from a terminal, use the read-only [JEV tab-change check](integrations/screenpipe/jev-check/README.md). JEV is optional: without the installed pipe's `.env`, the workflow skips JEV. See the [pipe workflow](docs/ARCHITECTURE.md#jev-pipe-workflow).

JEV has no workflow memory. Each comparison includes the active case, its previous observation, and the newer observation. `same_case` returns `no_change`; `uncertain` does not switch the assignment. For a supported switch, the workflow identifies a unique existing destination automatically and returns `identified` with `applied: false`. It sends an unresolved-switch request through MCP only when no unique destination matches. Read-only MCP case queries remain allowed.

Missing previous evidence means uncertain, not unchanged. Initial assignment, operational failures, and incomplete lookups do not trigger the switch request. The scoped MCP tool does not exist yet; a qualifying unresolved switch returns `blocked` with delivery `not_sent` while the tool is unavailable.

1. Start Screenpipe with its local API available.
2. Import the pipe with Screenpipe's [local pipe installation](https://docs.screenpipe.com/scheduled-tasks), using the CLI installed with your Screenpipe release rather than an unpinned package. The desktop app keeps it under `~/.screenpipe/cli/<version>/`. Replace the absolute source path below.

   In bash:

   ```sh
   SCREENPIPE_CLI="$HOME/.screenpipe/cli/<version>/screenpipe"
   cd "$(mktemp -d)" && "$SCREENPIPE_CLI" pipe install "/ABSOLUTE/PATH/TimeKeeper/integrations/screenpipe/pipes/timekeeper"
   ```

   In PowerShell:

   ```powershell
   $cli = "$env:USERPROFILE\.screenpipe\cli\<version>\screenpipe.exe"
   Push-Location (New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))); & $cli pipe install "C:\ABSOLUTE\PATH\TimeKeeper\integrations\screenpipe\pipes\timekeeper"; Pop-Location
   ```

3. If you want to use JEV, create `~/.screenpipe/pipes/timekeeper/.env` in a local editor with these settings. Preserve any existing credentials.

   ```dotenv
   JEV_ALLOWED_FIELDS=
   TYPESAFE_API_KEY=
   TYPESAFE_MODEL=jev-latest
   ```

4. If you created `.env`, fill `TYPESAFE_API_KEY` locally with a key from the [TypeSafe console](https://console.typesafe.ai/). Set `JEV_ALLOWED_FIELDS` to the approved comma-separated fields listed [below](#allowed-jev-fields). There is no separate enable flag. An empty key or field selection prevents a request.
5. Select a working AI preset for the task in **Scheduled tasks → My tasks**. Keep the pipe disabled until the required TimeKeeper tools and workflow contracts exist.

To skip JEV, leave `.env` absent or move it out of the installed pipe directory. The agent must explicitly load this file in the same invocation as the request; it must not fall back to a key from the process environment. Keep the key out of `pipe.md`, prompts, and logs. The frontend and application backend do not need it.

The pipe uses `schedule: manual` and `enabled: false`. Results retain the original target, baseline case, source references, and assignment revision. The application remains the only assignment writer. An identified destination is not saved or made the active case; matched-case persistence and repeated switch detection remain open. Missing TimeKeeper API and MCP tools, folder detection, and event delivery still prevent an end-to-end workflow.

Field filtering and response checks are agent instructions, not code-enforced guarantees. Enabled JEV requests use TypeSafe's hosted API. Live requests, Screenpipe loading, and desktop platform behavior have not been verified.

#### Allowed JEV fields

`JEV_ALLOWED_FIELDS` is a TimeKeeper setting. It tells the Screenpipe agent which information it may send to TypeSafe. `previous_observation.` fields describe earlier evidence associated with the active case and its assignment revision. `observation.` fields describe the newer activity. `candidates.` fields describe existing cases returned by TimeKeeper.

| Field | Information permitted in the request |
| --- | --- |
| `previous_observation.text` | Recorded screen text from the earlier observation. |
| `previous_observation.app_name` | Application name from the earlier observation. |
| `previous_observation.window_title` | Window title from the earlier observation. |
| `previous_observation.url` | Page URL from the earlier observation, when available. |
| `observation.text` | Recorded screen text, such as accessibility text or OCR output. |
| `observation.app_name` | Name of the application associated with the observation. |
| `observation.window_title` | Title of the recorded window. |
| `observation.url` | Page URL associated with the observation, when available. It can be stale; see the note below. |
| `candidates.reference` | Reference of each candidate case. |
| `candidates.title` | Title of each candidate case. |
| `candidates.client_name` | Name of the client associated with each candidate case. |

For example, this selection permits screen text and window titles from both observations, case references, and case titles:

```dotenv
JEV_ALLOWED_FIELDS=previous_observation.text,previous_observation.window_title,observation.text,observation.window_title,candidates.reference,candidates.title
```

This selection sends recorded screen text to TypeSafe. A narrower selection is permitted but less reliable. In a synthetic test with `jev-1.13.0`, window titles alone produced `same_case` for a switch to an unknown folder and for an ambiguous inbox, which would silently keep the previous case. See the [design review](docs/DESIGN_REVIEW.md).

Select only fields approved for your deployment. Previous-observation fields require explicit selection; permission for `observation.` fields does not include them. A comparison needs at least one permitted nonblank field from each observation; any selectable field counts, so the window-title example above is sufficient.

URL fields are weaker evidence than window titles. On Windows with Screenpipe 2.7.109, captures of a newly selected browser tab kept the previous tab's URL, which can wrongly suggest that work continued on the same page. Initial assignment needs only the newer observation. Every candidate also needs at least one permitted descriptive field containing text. Missing required content or an unsupported selection prevents a request.

The pipe instructs the agent to exclude screenshots, actual case and client IDs, timestamps, and assignment revisions. It uses temporary aliases for case and client IDs. Selecting a field does not redact private information within its text. See the [configuration and data boundary](docs/ARCHITECTURE.md#jev-configuration-and-data-boundary) for the full contract.
## Documentation

| Document | Responsibility |
| --- | --- |
| [Requirements](docs/REQUIREMENTS.md) | Agreed business rules, use cases, acceptance examples, and open product decisions. |
| [Architecture](docs/ARCHITECTURE.md) | Components, ownership, lifecycle, and recovery. |
| [Database](docs/DATABASE.md) | Work-period model, proposed fields, and integrity constraints. |
| [Original database](docs/reference/ORIGINAL_DATABASE.md) | Historical transcription of the supplied diagram. |
| [Screenpipe integration research](docs/SCREENPIPE_INTEGRATION.md) | API evidence, proposed matching methods, and provider limitations. |
| [Screenpipe event research](docs/SCREENPIPE_EVENTS.md) | Trigger mechanisms and release verification gates. |
| [Design review](docs/DESIGN_REVIEW.md) | Remaining risks and implementation checkpoints. |
| [Contributor instructions](AGENTS.md) | Code organization, dependency rules, and working practices. |
| [Mockup gap](docs/MOCKUP_GAP.md) | Differences between the validated mockup and the requirements. |
| [Mockup implementation](docs/implementation/architecture.md) | Imported schema, architecture, recognition, interface, and desktop behavior. |

The requirements define product behavior. The architecture and database documents explain its intended implementation. Research evidence does not establish runtime support in an installed release.

## Mockup vs requirements at a glance

The code on this branch aligns the five conflicts with the [requirements](docs/REQUIREMENTS.md). Details are in the [mockup gap](docs/MOCKUP_GAP.md); decision numbers refer to the next section.

| Status | Meaning |
| --- | --- |
| 🟢 | Aligned rule implemented in the local demo. |
| 🔵 | Kept by team decision, although the requirements exclude it. The requirements must be updated. |
| 🟡 | Mockup only: the requirements do not cover it. A decision is needed. |
| 🔴 | Conflict: the mockup and the requirements follow different rules. |
| ⚪ | Required behavior is absent or only partly built. |

| Topic | Mockup (built) | Requirements | Status | Decision |
| --- | --- | --- | :---: | :---: |
| Stack | Tauri, React, local Node API, SQLite | Same | 🟢 | — |
| Evidence source | Fictional Screenpipe references; live API retrieval not connected | Screenpipe API only | ⚪ | — |
| Clients and cases | A case belongs to one client | Same | 🟢 | — |
| Case and global rate | Case rate, fallback base rate | Case rate, fallback global rate | 🟢 | — |
| Manual corrections win | Lawyer changes override automatic results | Same | 🟢 | — |
| Billed / unbilled status | Per work period in the aligned interface | Per work period | 🟢 | — |
| JEV role | Fictional stored review examples; no workflow integration | Screenpipe workflow owns requests | ⚪ | — |
| Pre-invoices and numbered invoices | Built: VAT, expenses, disbursements, frozen lines | Excluded | 🔵 | 1 |
| Client rates | Case > client > base rate | Excluded | 🔵 | 1 |
| Flat fees and budgets | Built, 85% budget alert | Excluded | 🔵 | 1 |
| Client rules | Built, checked before issuing | Not covered | 🔵 | 1 |
| Case recognition | Weighted markers, score, threshold, learning | Undefined | 🟡 | 2, 11 |
| Case reference format | `YYYY-NNN-CODE`, generated | Format undecided | 🟡 | 2 |
| Task types and non-billable reasons | Built | Not covered | 🟡 | — |
| Off-screen time added by hand | Built | Not confirmed | 🟡 | 10 |
| Personal apps left out | Built, recoverable | Not covered | 🟡 | — |
| Desk pill with session and current-period time | Built as a local shell | UI not specified | 🟡 | 12 |
| Source pack with SHA-256 | Built | Not covered | 🟡 | — |
| Audit trail | Built | Undecided | 🟡 | — |
| Duration unit and rounding | Precise milliseconds in work periods; totals rounded once | Same | 🟢 | 5 |
| Where amounts are calculated | React for active summaries and invoice drafts; issued invoice snapshots are frozen | React | 🟢 | 5 |
| Review states | Time, source, availability, and billing states separated | Same | 🟢 | 6 |
| Writes through the application layer | API mutations enter services; adapters synchronize retained demo tables and canonical records | All writes | 🟢 | — |
| Data model | Sessions and work periods plus documented billing extensions; old tables retained for demo compatibility | Sessions and work periods | 🟢 | 3 |
| Session start/end commands | Idempotent local API implemented. Start button: [MCP `start_session`](docs/API.md#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe) and a manual Screenpipe pipe, not yet verified in Screenpipe. End through Screenpipe pending | Required | ⚪ | 4 |
| Unknown-folder question to the lawyer | Period-bound question and guarded answer implemented | Same | 🟢 | 2 |
| Duration correction kept apart from detection | Implemented | Required | 🟢 | — |
| Source validation and availability | Implemented per source | Required | 🟢 | 6 |
| Coverage gaps shown | Explicit retrieval gap and incomplete source state shown | Required | 🟢 | 3 |
| Reconstruction conflicts | Persisted; review UI pending | Required | ⚪ | — |
| Case tags written back to Screenpipe | — | Required | ⚪ | — |
| Read-only MCP for Screenpipe chat | — | Required | ⚪ | — |
| End command while the app is closed | — | Required, mechanism open | ⚪ | 4 |
| Live Screenpipe capture | Simulated demo data | Required | ⚪ | 2, 3 |

## Decisions to make

The team builds from the validated mockup's structure, inside the code organization above. Decision 1 is agreed; the requirements document still awaits its author’s update. The remaining decisions block parts of the MVP and show proposed options for discussion. See the [mockup gap](docs/MOCKUP_GAP.md) and the [design review](docs/DESIGN_REVIEW.md) for details.

| Priority | Decision | Status or proposed option |
| --- | --- | --- |
| 1 | Billing scope. | **Agreed (2026-10-17): keep the mockup's billing features**: pre-invoices; numbered deposit and final invoices with frozen lines; expenses, disbursements, VAT; client rates with case > client > base cascade; flat fees; budgets with an 85% alert; and client rules. The requirements author must update `docs/REQUIREMENTS.md`. |
| 2 | Folder identification. | Match the case reference, case title, or a known folder or file name in the window title, file path, or URL. Otherwise, create an unresolved period and ask the lawyer. |
| 3 | Duration derivation from observations. | A period runs from one case transition to the next. A gap of more than five minutes without observations is shown as missing coverage and not counted. |
| 4 | End command while TimeKeeper is closed. | The Screenpipe pipe writes commands to a local inbox folder; TimeKeeper imports them in order at startup. |
| 5 | Billing unit and where amounts are calculated. | **Agreed (2026-10-17): follow the requirements.** Precise milliseconds, combined-total minute rounding, and React-owned active calculations. Monetary rounding above remains proposed. |
| 6 | Review states in the interface. | **Agreed (2026-10-17): follow the requirements.** Separate time validation, source validation and availability, and billing status. |
| 7 | Applied rate snapshot. | Fix the rate when a period is marked billed. |
| 8 | Editing a billed period. | Not allowed until the period is marked unbilled again. |
| 9 | Periods counted in each total. | Count every period with an effective duration; show the validated share separately. |
| 10 | Manual periods without evidence (hearing, meeting, travel). | Allow them, marked as manual, with time validation required. |
| 11 | Automatic recognition with weighted markers and learning. | Use markers for suggestions only; the lawyer confirms. Defer learning. |
| 12 | Desk pill content. | Show the active session, the active case, and the time of the current period; show amounts only once decision 5 is applied. |
