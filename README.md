# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The validated six-screen mockup now lives in the agreed source layout. It has a React and Vite interface, a local Hono API, an 18-table SQLite demo database, generated OpenAPI types, and a Windows Tauri shell with a floating pill. The demo uses fictional data dated 16 October 2026. The app does not yet execute Screenpipe workflows or implement the session and work-period behavior in the requirements; see the [mockup gap](docs/MOCKUP_GAP.md).

Node.js 22.13 or newer is required. From the repository root, run `npm ci`, `npm run db:reset`, then `npm run dev` to open the UI at `http://127.0.0.1:5173`. Run `npm test` (45 imported tests), `npm run typecheck`, and `npm run build` to verify the package. `npm run contract:gen` refreshes generated API types. The browser smoke test at `tests/acceptance/smoke.py` covers six screens and the pill in a local Chromium with Python Playwright installed.

For Tauri development, run `npm run dev:server` separately, then `npm run desktop:dev`. `npm run desktop:build` builds the Windows desktop shell. The Node API is still a separate process and is not packaged in the installer. Native Windows and macOS acceptance, Screenpipe capture and event delivery, and installed-app behavior remain unverified.

## MVP behavior

- Configure clients, cases, a case hourly rate, and a global hourly fallback.
- Assign work periods to cases. Returning to a case creates another period.
- Ask the lawyer about unknown folders and keep the affected period unresolved until answered. Folder identification remains undefined.
- Review source recordings, correct time or case assignments, and validate time and sources separately.
- Preserve corrections during recovery, resolve delayed answers against their original periods, and flag conflicting reconstructions for review.
- Track billed and unbilled status per work period without generating invoices.
- Calculate summaries in React from reviewed evidence and lawyer corrections.
- Sum precise durations first, then round the combined total up to whole minutes. Do not round each work period.

A screenshot proves an observation. The rule for deriving continuous work intervals remains open. Application uptime and screenshot counts do not supply duration.

Inactivity detection, client-specific rates, fixed fees, and invoice generation are outside the MVP. UI design is outside the current documentation session.

Chat-calculated summaries, reusable folder learning, and advanced currency behavior are deferred. Read-only chat queries for stored details remain in scope when TimeKeeper is running. The [requirements](docs/REQUIREMENTS.md) define session-command handling, review transitions, and the full MVP acceptance journey.

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

The code on this branch implements the validated mockup. This table compares it with the [requirements](docs/REQUIREMENTS.md). Details are in the [mockup gap](docs/MOCKUP_GAP.md); decision numbers refer to the next section.

| Status | Meaning |
| --- | --- |
| 🟢 | Aligned: the mockup already follows the requirements. |
| 🔵 | Kept by team decision, although the requirements exclude it. The requirements must be updated. |
| 🟡 | Mockup only: the requirements do not cover it. A decision is needed. |
| 🔴 | Conflict: the mockup and the requirements follow different rules. A decision is needed. |
| ⚪ | Requirements only: not built in the mockup yet. |

| Topic | Mockup (built) | Requirements | Status | Decision |
| --- | --- | --- | :---: | :---: |
| Stack | Tauri, React, local Node API, SQLite | Same | 🟢 | — |
| Evidence source | Screenpipe API only, references kept | Same | 🟢 | — |
| Clients and cases | A case belongs to one client | Same | 🟢 | — |
| Case and global rate | Case rate, fallback base rate | Case rate, fallback global rate | 🟢 | — |
| Manual corrections win | Lawyer changes override automatic results | Same | 🟢 | — |
| Billed / unbilled status | Per time entry | Per work period | 🟢 | — |
| JEV role | Closed questions on existing cases, masked data | Same, owned by the Screenpipe workflow | 🟢 | — |
| Pre-invoices and numbered invoices | Built: VAT, expenses, disbursements, frozen lines | Excluded | 🔵 | 1 |
| Client rates | Case > client > base rate | Excluded | 🔵 | 1 |
| Flat fees and budgets | Built, 85% budget alert | Excluded | 🔵 | 1 |
| Client rules | Built, checked before issuing | Not covered | 🔵 | 1 |
| Case recognition | Weighted markers, score, threshold, learning | Undefined | 🟡 | 2, 11 |
| Case reference format | `YYYY-NNN-CODE`, generated | Format undecided | 🟡 | 2 |
| Task types and non-billable reasons | Built | Not covered | 🟡 | — |
| Off-screen time added by hand | Built | Not confirmed | 🟡 | 10 |
| Personal apps left out | Built, recoverable | Not covered | 🟡 | — |
| Desk pill with live fees | Built (Windows installer) | UI not specified | 🟡 | 12 |
| Source pack with SHA-256 | Built | Not covered | 🟡 | — |
| Audit trail | Built | Undecided | 🟡 | — |
| Duration unit and rounding | Tenths of an hour per line | Milliseconds, minute rounding on totals only | 🔴 | 5 |
| Where amounts are calculated | Server | React | 🔴 | 5 |
| Review states | One validation, then billing | Time, source, and billing states kept separate | 🔴 | 6 |
| Writes through the application layer | Only case assignment so far | All writes | 🔴 | — |
| Data model | Blocks and time entries (18 tables) | Sessions and work periods | 🔴 | 3 |
| Sessions started and ended in Screenpipe | — | Required | ⚪ | 4 |
| Unknown-folder question to the lawyer | "No case" row with a suggestion | Question bound to the period and its revision | ⚪ | 2 |
| Duration correction kept apart from detection | — | Required | ⚪ | — |
| Source validation and availability | — | Required | ⚪ | 6 |
| Coverage gaps shown | — | Required | ⚪ | 3 |
| Reconstruction conflicts | — | Required | ⚪ | — |
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
| 5 | Billing unit and where amounts are calculated. | Follow the requirements: precise milliseconds, minute rounding on combined totals, amounts calculated in React. |
| 6 | Review states in the interface. | Follow the requirements: separate time validation, source validation, and billing status. |
| 7 | Applied rate snapshot. | Fix the rate when a period is marked billed. |
| 8 | Editing a billed period. | Not allowed until the period is marked unbilled again. |
| 9 | Periods counted in each total. | Count every period with an effective duration; show the validated share separately. |
| 10 | Manual periods without evidence (hearing, meeting, travel). | Allow them, marked as manual, with time validation required. |
| 11 | Automatic recognition with weighted markers and learning. | Use markers for suggestions only; the lawyer confirms. Defer learning. |
| 12 | Desk pill content. | Show the active session, the active case, and the time of the current period; show amounts only once decision 5 is applied. |

