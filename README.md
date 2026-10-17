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

The requirements define product behavior. The architecture and database documents explain its intended implementation. Research evidence does not establish runtime support in an installed release.
