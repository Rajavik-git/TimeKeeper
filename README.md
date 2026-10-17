# TimeKeeper

TimeKeeper is a planned desktop application for macOS and Windows. It uses Screenpipe memory to help lawyers review time spent on clients and legal cases. The project is part of a hackathon organized by École 42 and Screenpipe.

## Status and scope

The repository contains documentation and the folder skeleton defined in [AGENTS.md](AGENTS.md). Empty folders contain `.gitkeep` placeholders so Git can retain them. The selected stack is Tauri, React, a local Node.js backend, and SQLite. A single Node.js/TypeScript package now provides the MVP core, SQLite migration, local API module, and automated tests. No desktop executable or Screenpipe runtime integration exists yet.

The lawyer starts and ends a session through explicit commands in Screenpipe. Closing TimeKeeper exits the desktop app and backend but leaves the session active. Reopening reconciles recorded history and preserves manual corrections.

Screenpipe executes the workflow after a trigger. It retrieves recorded evidence through its API and submits session and assignment commands through TimeKeeper's MCP server and application API. Event delivery and command handling while the app is closed still require implementation decisions and verification.

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

The requirements define product behavior. The architecture and database documents explain its intended implementation. Research evidence does not establish runtime support in an installed release.

## Decisions to make

The team builds from the validated mockup's structure, inside the code organization above. These decisions block parts of the MVP. Each line gives a proposed option for discussion; none is agreed until the authoritative document records it. See the [mockup gap](docs/MOCKUP_GAP.md) and the [design review](docs/DESIGN_REVIEW.md) for details.

| Priority | Decision | Proposed option |
| --- | --- | --- |
| 1 | Product scope: keep invoice preparation, client rates, flat fees, budgets, and client rules from the mockup, or keep the requirements' billed/unbilled status only. | Keep pre-invoices without numbered invoice issuing; keep case and global rates only. |
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

