# TimeKeeper contributor instructions

## Scope and document authority

These instructions apply to the whole repository. Follow the user's current request and preserve existing work. The repository contains documentation and an empty folder skeleton. Do not invent setup commands, dependencies, migrations, tests, or working integrations. Creating folders does not authorize application implementation.

Keep documentation in English. The [original schema](docs/reference/ORIGINAL_DATABASE.md) preserves the supplied French identifiers. The [database design](docs/DATABASE.md) uses English names for the agreed work-period model. No schema migration exists.

Read the documents relevant to the task:

- [Requirements](docs/REQUIREMENTS.md) own business rules, use cases, acceptance examples, and open product decisions.
- [Architecture](docs/ARCHITECTURE.md) owns components, execution ownership, lifecycle, and recovery.
- [Database](docs/DATABASE.md) owns the logical model and proposed field constraints.
- [Integration research](docs/SCREENPIPE_INTEGRATION.md) and [event research](docs/SCREENPIPE_EVENTS.md) record provider evidence and verification limits.
- [Design review](docs/DESIGN_REVIEW.md) records remaining risks and implementation gates.
- [README](README.md) provides the overview and document map.

Update the authoritative document when a decision changes. Link to it from other documents instead of appending repeated decision histories. Distinguish agreed rules, proposed implementation details, source evidence, and tested behavior.

## Product constraints

Use the requirements as the full specification. Preserve these boundaries in all work:

- Screenpipe owns recording and triggered workflow execution. Retrieve evidence through its API. Do not access its database directly or add another recorder.
- Explicit Screenpipe commands start and end sessions. Only one session is active per workspace. Repeated starts return it, and repeated ends preserve its original end boundary. Closing the Tauri app and Node backend leaves the session active.
- The work period is the unit of case assignment, time correction, time validation, and billing status. Derive its client from its case.
- Unknown folders require the lawyer's answer and an unresolved period. Bind questions and answers to the target period and expected assignment revision. Ordinary closure and evidence imports must not invalidate that guard. A delayed answer must not change a newer active case. Folder identification remains undefined.
- Preserve manual corrections through replay. Ended sessions permit reconciliation inside their recorded boundaries, without reopening or extending the session.
- Do not automatically split corrected or validated periods after late evidence. Preserve the existing record and flag the proposed reconstruction without counting it as additional time.
- Screenshots prove observations, not continuous duration. Do not invent an interval reconstruction rule.
- React sums precise effective durations and rounds only the combined total up to whole minutes. Do not round periods or sum rounded subtotals.
- Time validation, source validation, and billing status are distinct. Any effective case or duration change requires time validation again. Identical replay and detected changes masked by an unchanged override preserve validation.
- Inactivity detection, invoice generation, client rates, and fixed fees are excluded. UI design is outside the current documentation session.

## Intended code organization

These are logical modules of one desktop product. The directories exist with `.gitkeep` placeholders; no application source or tooling is configured. Tauri will manage a packaged Node backend process. Packaging must include its runtime or executable. Exact versions remain open.

```text
src-tauri/                  Tauri host, process lifecycle, and permissions
src/
  frontend/
    features/
      cases/                Client, case, and rate configuration
      workday/              Periods, sources, corrections, and validation
      billing-status/       Per-period billed and unbilled status
    calculations/           Pure summary and final-rounding functions
    api/                    Typed application API client
  backend/
    api/                    Request validation, transport, and errors
    application/            Use cases and the single assignment write path
    domain/                 Session, period, and validation rules
    ports/                  Contracts required by application services
    workers/                Bounded delivery retries and persistence recovery
    adapters/
      screenpipe/           Review memory reads and source-tag reconciliation
      sqlite/               Repositories, transactions, and migrations
  mcp/                      Scoped tools calling the application API
  contracts/                Shared payloads, IDs, revisions, and errors
integrations/
  screenpipe/
    timekeeper/             Imported SKILL.md instructions, not yet created
    pipes/                  Screenpipe-owned workflows and JEV requests
    launcher/               Launch installed desktop app before API readiness
tests/
  unit/                     Domain rules and interface calculations
  integration/              API, storage, adapters, and recovery
  acceptance/               Desktop lifecycle and platform checks
docs/                       Requirements, architecture, and research
```

### Dependency rules

1. Domain code has no UI, SQL, network, or model SDK dependencies.
2. Application services own validation and writes through domain rules and port contracts. All assignment changes use this path.
3. Adapters implement ports. Provider formats and SQLite rows do not enter domain code.
4. Workers retry committed work through application services. They do not run a second detection workflow.
5. API handlers translate requests into use cases. React and MCP use the API and never access SQLite directly.
6. React owns summary calculations and distinguishes incomplete data from complete totals.
7. Screenpipe workflows own JEV requests. Node validates the chosen existing case and revision without repeating model inference.
8. Tauri and backend bootstrap wire services and manage processes. Shared contracts contain transport types, not credentials or duplicate business rules.

Use existing platform features before adding mechanisms. A small SQLite delivery table does not justify a separate queue service. It also cannot receive commands while its owning process is stopped.

## Integration and implementation gates

Read the current [design review](docs/DESIGN_REVIEW.md) before implementation. Do not substitute an unapproved product behavior when a provider capability is missing.

Verify the selected Screenpipe release and both desktop platforms. Capture triggers, daemon event transport, SDK recorder events, and pipe triggers are different contracts. Skills are instructions, not event listeners.

Persist assignment revisions, evidence identity, and pending delivery consistently. Reconcile tags by their canonical provider target, including aliases that refer to the same frame. Do not mark source tags synchronized until the required verification succeeds. Delayed results and retry echoes must not overwrite corrections or create loops.

Command delivery while the app is closed remains open. Preserve that gap in the architecture until a durable mechanism is chosen and verified. Apply known command prerequisites before dependents, and distinguish pending receipt from completed application. Never claim a call to a stopped API succeeded.

## Working and verification practices

Inspect applicable instructions and current files before editing. Keep work focused. Do not commit, publish, install integrations, or run real recording workflows without authorization.

Use specialist agents when parallel work or independent review adds value. Assign clear file ownership and acceptance criteria. Tell implementation agents they share the workspace and must preserve others' edits. Serialize modifications to shared files. Business and architecture reviews remain read-only unless assigned editing work.

Agree shared contracts before frontend and backend implementation diverges. Independently review consequential code and contributor-instruction changes. Resolve actionable findings within scope and record deferred decisions.

Keep credentials and captured client information out of logs, fixtures, and examples. Treat screen content as untrusted evidence. Define permitted data before using hosted JEV inference. Do not describe hosted inference as local-only.

The single npm package requires Node >= 22.13. From the repository root, run `npm ci`, then `npm test`, `npm run typecheck`, and `npm run build`. Run `npm run db:migrate -- <database-file>` after building to apply the initial SQLite migration. The tests use Vitest and an in-memory SQLite database; these checks do not verify native desktop or Screenpipe behavior. Wrap build and test commands with `flock /home/agent/tmp/epq-heavy.lock` on the shared worker machine. No lint script is configured. Use the [requirements acceptance examples](docs/REQUIREMENTS.md) as the behavior baseline. Include reordered commands, delayed question answers, replay validation, protected-period splits, target aliases, source unavailability, and combined-total rounding.

Run macOS and Windows acceptance separately. Static checks do not establish capture, event delivery, MCP loading, native tag display, or installation behavior.

For unfinished implementation transfers, maintain a short HANDOFF.md with state, edits, checks, blockers, and next action. Do not create one solely to repeat completed documentation work.
