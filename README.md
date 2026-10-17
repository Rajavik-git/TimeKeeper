# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The six-tab fictional demo now uses the session, work-period, source, question, and billing tables from [the database design](docs/DATABASE.md). The imported 18-table mockup remains as a compatibility catalogue and evidence display; its API writes now enter application services and synchronize canonical records where applicable. Duration corrections, separate review states, session commands, missing coverage, and React-owned summaries are implemented. This is a demo, not a live Screenpipe integration; [remaining gaps](docs/MOCKUP_GAP.md) include command delivery while the app is closed and provider tag verification.

The interface uses the monochrome Seal identity, a floating top menu, a larger reading scale, and a landscape shell with minimal internal scrollbars for long lists and distinct table headers. Shared selects, summary tiles, cards, the My day calendar, and the Desk pill selector follow the approved HTML mockup in light and dark themes at 1440×900 and 1280×800. My day starts with one-click validation of recognized periods and a side-by-side case question; its calendar marks pending, validated, and empty days. Shared controls provide quick hover and visible keyboard focus feedback, and actions show a bottom-right status message. The My day table signals editable durations, filters by client and case, exports its visible periods in screen order, and fades when more rows are below the fold. Its manual-period dialog traps keyboard focus until dismissed. Cases has a practice dashboard with sortable client cards and expandable per-case billing rows, a client level, and case detail with clickable breadcrumbs. The tabs are My day, Cases, Billing, Activity, Settings, and Desktop; Desk pill controls, preview, and the demo reset control are under Settings. Desktop simulates a Windows workspace with fictional case files, document viewers, the live pill, and an embedded TimeKeeper window. The refreshed US demo uses dollars, US number formats, American names and companies, and zero sales tax. Its Oxford/Ink palette gives Validate actions and review statuses distinct colours. See the [interface guide](docs/implementation/interface.md) for the layout and test scope.

Node.js 22.13 or newer is required for development. From the repository root, run `npm ci`, `npm run db:reset`, then `npm run dev` to open the UI at `http://127.0.0.1:5173`. Run `npm test`, `npm run typecheck`, and `npm run build` to verify the package. `npm run contract:gen` refreshes generated API types. With the dev server running and Python Playwright installed, `python3 tests/acceptance/smoke.py` covers the five practice screens, the three-level Cases navigation, the pill preview, and page height at 1440×900 and 1280×800; `python3 tests/acceptance/pill_switch.py` covers the simulated document switch and case question. `python3 tests/acceptance/emulator.py` covers Desktop at 1440×900 and 1366×640, file recognition, the period switch, and the embedded app. Set `CAPTURE_DIR` to save light and dark screenshots. An existing local database retains its data until the demo reset endpoint is invoked.

## Online demo

The [TimeKeeper online demo](https://timekeeper-demo.vercel.app) uses fictional data. Its Desktop tab lets a viewer open case folders and simulated documents, confirm the pill's case suggestion, and inspect the resulting period inside a TimeKeeper window. The static browser catalogue contains metadata and short previews; the source files in `demo/documents` are not served. Regenerate it with `python3 scripts/generate-demo-document-index.py` after changing fictional documents. It runs the React interface and Node API on Vercel, with SQLite in temporary function storage. Data can reset when a function starts or is replaced; concurrent function instances can show different demo state. Use **Settings → Capture and invoices → Reset demo data** to restore the sample in the current instance. This shareable demo does not record a real screen or connect to Screenpipe. See the [deployment notes](docs/implementation/online-demo.md) for the storage limit.

For Tauri development, run `npm run dev:server` separately, then `npm run desktop:dev`. On Windows, `npm run desktop:build` creates the Node API sidecar, checks its first-run demo database and `/api/state`, and builds an NSIS installer containing the backend. An installed Windows user does not need Node or npm: launching TimeKeeper starts the API, shows the floating pill, and leaves the main window accessible from the tray. The pill's Billing view and file-switch prompt use the local API; notifications can be dismissed by X, Later, Escape, or clicking the pill without changing a period, and non-document windows without a case suggestion stay silent. Settings > Desk pill preview can simulate a switch between fictional documents in a browser. See [desktop installation](docs/implementation/desktop.md). Native Windows and macOS acceptance, Screenpipe capture and event delivery, and installed-app behavior remain unverified.


The installed desktop sidecar uses the computer's local calendar date for Today, month comparisons, and new default dates. The fictional September–October 16, 2026 history retains its original dates, including after Reset demo data; older days remain available in the calendar. The web demo and development API continue to use October 16, 2026 as Today.

The Windows shell also provides a filtered active-window change event for document and work apps, plus a separate watcher pause command. The pill window follows the exact width and height of its visible content, without a native border or shadow. Its pill, panel, and notifications use translucent light/dark glass surfaces with inset hairlines, and the page outside those shapes remains transparent. Pausing the watcher does not control Screenpipe recording; see the [desktop implementation](docs/implementation/desktop.md).

## MVP behavior and retained demo extensions

- Explicit API commands start and end sessions. The active session survives closing the interface, and duplicate commands preserve the original boundaries.
- Work periods carry precise detected and corrected milliseconds. An unknown duration stays unknown. React sums precise durations and rounds only each combined group total up to whole minutes.
- An unresolved period opens its own question in the same transaction. Answers target its period and expected assignment revision. Marker suggestions remain demo aids; folder identification is undecided.
- Time validation, source validation and availability, and per-period billed status are separate. Effective case or duration changes require renewed time validation.
- The retained mockup adds client rates, flat fees, budgets, expenses, VAT, and numbered invoices. React prepares the invoice snapshot; the API validates referenced periods and stores the supplied frozen lines and totals. The applied hourly rate is fixed when a period is marked billed.
- A screenshot proves an observation, not continuous work. The demo's historical minutes are explicit seed values; no live interval reconstruction or Screenpipe recording is implemented.

**Proposed monetary rounding:** for one case on one invoice, billable minutes are `ceil(sum of precise period milliseconds / 60000)`; the work amount is `round(billable minutes × hourly rate cents / 60)` to whole cents. This is implemented for the demo invoice draft and awaits a requirements decision.

Read-only chat tools, installed Screenpipe workflows, capture, and native installer acceptance remain future work. The [requirements](docs/REQUIREMENTS.md) define the acceptance journey; the [design review](docs/DESIGN_REVIEW.md) tracks provider and product gates.

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
| Session start/end commands | Idempotent local API implemented; Screenpipe trigger integration pending | Required | ⚪ | 4 |
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
