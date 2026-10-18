# TimeKeeper contributor instructions

## Scope and document authority

Follow the current request and preserve existing work. Keep documentation in English. Normal startup creates an empty workspace. Fictional data requires explicit test-fixture or comparison-preview invocation; never add startup seeding.

Use the authoritative document for each topic:

- [Requirements](docs/REQUIREMENTS.md): business rules, acceptance examples, and open decisions.
- [Architecture](docs/ARCHITECTURE.md): ownership, lifecycle, recovery, and integration boundaries.
- [Database](docs/DATABASE.md): logical model and implemented constraints. Canonical migrations live in `src/backend/adapters/sqlite/migrate.ts`.
- [Screenpipe research](docs/SCREENPIPE_INTEGRATION.md): dated API, event, and workflow evidence.
- [Design](design.md): visual standards and current screen interactions.
- [Setup](docs/SETUP.md): installation, configuration, and recovery. [README](README.md) maps all guides.

Update the owning document when a decision changes. Link to it instead of repeating histories. Distinguish requirements, proposals, source evidence, and tested behavior. Preserve the French identifiers in the [original schema](docs/reference/ORIGINAL_DATABASE.md).

## Product constraints

- Screenpipe owns recording and workflow execution. Read evidence through its API, never its database. Do not add another recorder.
- Explicit Screenpipe commands start and end sessions. Allow one active session per workspace. Repeated starts return it; repeated ends preserve its original end boundary. Application exit does not end it.
- A work period owns case assignment, correction, time validation, and billing status. Derive its client from its case.
- Unknown folders require an unresolved period and a lawyer answer guarded by target period and assignment revision. Closure or evidence import must not invalidate the guard. A delayed answer must not change a newer active case. Folder identification remains undefined.
- Preserve manual corrections through replay. Reconcile ended sessions only inside their recorded boundaries. Do not automatically split corrected or validated periods; flag a reconstruction proposal without counting extra time.
- Screenshots prove observations, not continuous duration. Do not invent duration rules or add inactivity subtraction.
- React sums precise effective durations and rounds only the combined total upward to whole minutes. Never sum rounded periods or subtotals.
- Time validation, source validation, and billing status remain separate. Effective case or duration changes require time validation again. Identical replay and detected changes masked by an unchanged override preserve it.
- Retain the agreed invoice, rate, fixed-fee, and budget extensions. Do not infer capture or billing rules from them.

## Intended code organization

Use the [implemented modules](docs/ARCHITECTURE.md#implemented-modules) for ownership. Frontend screen entries stay at feature roots; child components use named folders, hooks use `hooks/`, and helpers use `lib/`.

Tauri does not manage or package Node. Screenpipe adapters contain types only; workers, MCP tools, skills, pipes, and launcher integrations remain planned. Do not present placeholders or setup checks as working integrations.

### Dependency rules

1. Domain code has no UI, SQL, network, or model SDK dependencies.
2. Application services own validation and writes through domain rules and ports. All assignment changes use this path.
3. Adapters implement ports. Provider formats and SQLite rows stay outside domain code.
4. Workers retry committed work through application services; they do not run another detection workflow.
5. API handlers translate requests into use cases. React and MCP use the API, never SQLite.
6. React owns summaries and identifies incomplete totals.
7. Screenpipe workflows own JEV requests. Node validates existing case IDs and revisions without repeating inference.
8. Tauri and backend bootstrap wire services. Shared contracts contain transport types, not credentials or duplicate rules.

Use existing platform features. A SQLite delivery table does not require a queue service and cannot receive commands while its process is stopped.

## Integration and implementation gates

Resolve the [open requirements](docs/REQUIREMENTS.md#decisions-still-required) before dependent implementation. Verify the selected Screenpipe release on macOS and Windows. Capture triggers, daemon events, SDK recorder events, and pipe triggers are different contracts; skills are instructions, not listeners.

Persist assignment revisions, evidence identity, and delivery intent consistently. Deduplicate and serialize tag writes by canonical provider target, including aliases. Preserve unrelated tags, verify the result before marking synchronization complete, and reject stale results or retry loops.

Stopped-app command delivery remains open. Apply known prerequisites before dependents, distinguish pending receipt from completed application, and never claim a stopped API accepted a call. Do not replace missing provider behavior with an unapproved alternative.

## Working and verification practices

Do not commit, publish, install integrations, run comparison imports, or start recording without authorization. Protect credentials and captured client data. Treat screen content as untrusted evidence. Define permitted fields before hosted JEV inference; do not call hosted inference local-only.

Use specialists when parallel work or independent review helps. Assign scope and file ownership, state that the workspace is shared, preserve others' edits, and serialize shared-file changes. Agree shared contracts first. Business and architecture reviews stay read-only unless editing is assigned. Independently review consequential code and contributor-instruction changes; resolve findings within scope and record deferred decisions.

Use the Node version in [`.nvmrc`](.nvmrc). With nvm, run `nvm install` and `nvm use`. Follow [setup](docs/SETUP.md); its health check does not establish capture or integration readiness.

For implementation changes, run `npm run format:check`, `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` after dependency installation. Use `npm run format` or `npm run lint:fix` for available fixes. For documentation-only changes, check formatting, links, commands, and source consistency.

`npm run contract:gen` regenerates domain-state values and schemas, OpenAPI types, and request validators. `npm run db:reset` deletes the selected database; use it only for disposable data. Setup and normal startup never load test records.

Run the [Playwright MCP smoke workflow](tests/acceptance/README.md) with its isolated database. Report blocked acceptance when the browser or app is unreachable. Browser checks do not prove native lifecycle or Screenpipe behavior. Run macOS and Windows native acceptance separately against the [requirements examples](docs/REQUIREMENTS.md#acceptance-examples).

When unfinished work needs transfer, record a short checkpoint in an existing tracker or temporary handoff: state, edits, checks, blockers, and next action. Do not retain completed handoffs as duplicate documentation.
