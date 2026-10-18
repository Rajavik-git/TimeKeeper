# TimeKeeper architecture

## Scope and ownership

TimeKeeper implements React, a local Hono API, application services, and SQLite persistence for the [requirements](REQUIREMENTS.md). Tauri hosts the desktop windows. Debug development uses a separately running Node API. Windows release packaging includes a Node API sidecar with readiness and parent-process safeguards. The current sidecar builder has no macOS target. Node uses [`.nvmrc`](../.nvmrc). Package and Cargo lockfiles record dependency versions.

Screenpipe owns recording and triggered workflows. Node validates commands and writes records. React calculates summaries. The [setup guide](SETUP.md) owns environment preparation. Its public-health check does not wire integrations. The Screenpipe release and native release acceptance remain open.

## Components and flows

The diagram shows connections present in this source tree. The [feature tracker](FEATURES.md) records integration and validation gaps. Durable evidence ingestion, event-trigger bridges, and tag synchronization are not connected in this checkout. See [implemented modules](#implemented-modules) for ownership and [AGENTS.md](../AGENTS.md) for dependency rules.

```mermaid
flowchart LR
    Lawyer[Lawyer]
    subgraph SP[Screenpipe]
        Recorder[Recorder and local HTTP API]
        Chat[Chat and manual pipes]
    end
    subgraph TK[TimeKeeper]
        Host[Tauri release host]
        UI[React review and desk pill]
        MCP[MCP tools]
        Link[Optional recording-session link]
        API[Hono API and application services]
        DB[(SQLite)]
        Host -->|Start and supervise packaged API| API
        UI <-->|Typed HTTP requests| API
        MCP -->|Commands and detail reads| API
        Link -->|Session commands| API
        API <--> DB
    end
    Lawyer --> UI
    Lawyer --> Chat
    Chat <-->|Authenticated loopback HTTP| MCP
    API -->|Read focus and screenshots| Recorder
    Link -->|Poll public health| Recorder
```

| Component                        | Responsibility                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Screenpipe recorder and API      | Capture activity and expose recorded observations.                                       |
| Screenpipe chat and manual pipes | Call TimeKeeper tools for explicit session commands and question answers.                |
| MCP server                       | Translate tools into application API requests. Never open the business database.         |
| Optional session link            | Observe public health and deliver linked session boundaries through the API.             |
| Screenpipe HTTP adapter          | Read recent focus, frame metadata, and screenshot images. Keep credentials server-side.  |
| Pill recognition                 | Match recorded application and window metadata against active cases and configured cues. |
| Node application services        | Validate commands and preserve revisions and corrections through shared write paths.     |
| React interface                  | Review, correct, validate, manage billing status, and calculate summaries.               |
| Tauri release host               | Start the packaged API, wait for readiness, and stop its owned sidecar on Quit.          |
| SQLite                           | Store detailed records, recovery state, and frozen issued invoices.                      |

## Implemented modules

The current request path is `React -> typed API client -> Hono -> application services -> repository ports -> SQLite`. `src/contracts/openapi.yaml` owns HTTP payloads. `npm run contract:gen` generates domain-state values, API types, and request schemas. Hono uses Ajv 2020 and `ajv-formats`, limits request size, and returns sanitized errors. `application/errors.ts` owns stable error codes. ESLint checks dependency direction.

| Owner                     | Responsibility                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CatalogService`          | Catalogue reads and writes.                                                                                      |
| `SessionCommandService`   | Command replay, prerequisites, and session boundaries.                                                           |
| `PeriodAssignmentService` | Assignments and revision-bound questions.                                                                        |
| `PeriodReviewService`     | Details, duration, time validation, and billing transitions.                                                     |
| `EvidenceService`         | Evidence import, source review, and reconstruction notices.                                                      |
| Invoice service           | Check ownership, validation, billing, revisions, pricing, expenses, tax, and amounts before freezing an invoice. |
| `SourceExportService`     | Source packs and issued invoice CSV reads.                                                                       |
| `core-row-mappers.ts`     | Decode rows and reject invalid stored states. Repositories own queries and writes on the transaction connection. |

`service.ts` delegates to focused services with narrow repository ports. Deprecated compatibility routes translate explicit fields into the same commands and transactions. The legacy manual-entry route returns HTTP 501 because its payload lacks session and time boundaries. The canonical route accepts explicit boundaries, but its UI remains disabled pending product rules. Pause routes store annotations without controlling recording.

### Frontend ownership

Feature roots contain screen entries and screen-wide styles. Named folders under `components/` contain child components and their styles. Hooks use `hooks/`; helpers use `lib/`. Imports name implementation files directly. `shared/styles.css` preserves cascade order. Shared styles own controls, shell, and tokens; feature styles own feature selectors. Feature helpers can prepare commands and are not necessarily pure.

`App.tsx` owns navigation, resource selection, review lifetime, and source-return context. `Cases.tsx` coordinates commands and child views. `MyDay.tsx` presents the day; `useDayResources` owns scoped reads and `useDayCommands` owns assignment and validation. Settings sections own forms and errors. Cases and Settings share `ClientEditorDialog` and its dirty-dismissal and pending-submit guards. `CaseSearch` owns search requests, stale responses, and keyboard selection. `dayView` owns grouping, filters, gaps, sorting, and CSV order.

Shared fetch hooks use `openapi-fetch` and own cancellation, stale-response guards, and refresh state. Visible resources poll every five seconds and refresh on focus or resume. Polls skip in-flight requests; explicit refresh can replace them. A refresh failure does not undo a committed mutation. Batch validation refreshes committed successes after a later failure. Read errors remain distinct from write errors.

`/api/workspace` reads catalogue and core records in one transaction. SQL applies calendar and ownership filters without per-period queries or silent truncation. Catalogue and active-session reads remain independent of audit, billing, and reconstruction. My day loads selected-day and month resources. Other screens request full snapshots when needed. Auxiliary failures expose unavailable data rather than empty collections.

`usePeriodReview` owns reviewed snapshots, conflicts, and writes. `usePeriodDraft` owns corrections. Shared edit helpers parse duration and create revision-bearing commands. My day and Billing share the editor. Failed writes retain drafts; validation and billing wait for save or discard. Source navigation retains the draft and originating resource. Question state resets by period identity. Native dialogs contain focus and restore it after closure. `PageHeader` and `ActionNotice` own shared headings and transient feedback. Forms and exports keep local errors.

React calculation modules own summaries, comparison eligibility, budgets, and invoice drafts. Fee results include the amount, known subtotal, currency, and completeness. Saved billed pricing takes precedence. Missing pricing or incompatible currencies prevents a complete total. Frozen invoice lines use `calculations/invoice-fees.ts`; shared invoice arithmetic validates drafts before issue. Issued dialogs and CSV use saved snapshots. `src/shared/csv.ts` quotes cells and handles formula-leading text. [Database formats](DATABASE.md#data-formats-in-the-application) define source packs and receipts.

`calculations/case-budget.ts` owns the 85% warning threshold, precise comparison, and warning text for Cases and Billing. Shared money and rate formatters preserve cents across views. Catalogue presentation hides blank text only; brackets and `N/A` can be legitimate user values.

Main and pill share `WorkPill` and `src/frontend/shared/design-system/tokens.css`. `features/desk/lib/pillView.ts` maps state and preferences; native commands stay in the native entry point. Rust emits `timekeeper:open-my-day` to the main window. Its WebView listener changes the view and unregisters on unmount. That native path remains unverified. [Design](../design.md) owns interface guidance.

### Remaining structural debt

| Module                                        | Constraint for future changes                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PreInvoices.tsx`, `PeriodActivity.tsx`       | Substantial coordination and rendering remain. Extractions must preserve selection, source navigation, and pending writes. |
| Aggregate repository and `ScreenProps`        | Contracts remain broad. Focused services use `Pick<Repository, ...>`; extracted views use explicit props.                  |
| `compatibility.ts`                            | Translate deprecated contracts into canonical commands. Business rules remain in application services.                     |
| `core-repository.ts`, `catalog-repository.ts` | Preserve the transaction connection when moving queries.                                                                   |
| `shared/theme.css`, `legacy.css`              | Imported layout rules remain in lower cascade layers. Changes require checking affected selectors.                         |

Generated contracts, declarative mappings, and ordered migrations have distinct maintenance needs. File size alone does not justify splitting them. Historical migrations remain frozen. Domain state modules own named values; generated frontend members preserve transport values such as `RateOrigin.Case = "matter"`. [Database state ownership](DATABASE.md#why-fixed-states-are-text) defines the change requirements.

## Session lifecycle and application lifecycle

Session state is independent of process state. Main-window close hides the window. Tray **Quit** exits Tauri and stops its owned release API. A debug API started in another terminal stays running. Stopping the API closes SQLite without ending the stored session.

MCP runs as a separate process. `npm run mcp:serve` enables the optional recording-session link; a direct HTTP invocation without `--screenpipe-link` serves manual commands only. [Integration setup](../integrations/screenpipe/README.md) owns those commands.

| Action                        | Current behavior and limits                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit Start in Screenpipe  | Returns the active session, or optionally launches TimeKeeper, waits for readiness, and requests a new session.                             |
| Explicit End in Screenpipe    | Ends the active session through the API. It does not stop Screenpipe recording.                                                             |
| Recording-session link        | Polls health every ten seconds; starts while recording and ends after the configured stop grace period. Boundaries use health observations. |
| Close main window             | Hides the window and preserves session state.                                                                                               |
| Tray Quit                     | Stops Tauri and its owned release API. Does not explicitly end a stored session.                                                            |
| Reopen                        | Opens the same database. Automatic recorded-history catch-up is not implemented.                                                            |
| Commands while API is stopped | Start may use the configured launch command. General durable command delivery remains unresolved.                                           |

The intended exact recording boundaries and recovery guarantees in [requirements](REQUIREMENTS.md#sessions-and-desktop-lifecycle) are broader than this health-polling implementation. A connection loss can resemble stopped recording. Do not infer worked duration from either session uptime or process uptime.

Commands need stable IDs, the authoritative session ID returned by start, effective timestamps, and revision guards. Receipt time cannot replace effective time. Retries have no additional effect.

Recovery applies known prerequisites before dependents. An end waiting for its start stays pending. An end without a valid target cannot create a session. A new start dependent on a pending end waits instead of collapsing into the old session. Unresolved order remains pending or conflicting. A later end timestamp cannot revise an applied boundary.

When the API is stopped, it cannot receive session commands, assignments, or lawyer answers. The separate MCP process can report unavailability and may use its configured launch command on Start. Its session link persists its own delivery state, but there is no general external command inbox. Durable delivery of arbitrary stopped-app commands remains to be chosen and tested.

## Case assignment and evidence flow

The current path is `Screenpipe /search -> TimeKeeper focus API -> desk pill -> recognition API -> canonical period command`. The reader searches recent input, accessibility, and OCR observations. The pill uses application name and window title after two matching observations. It does not use full recorded text or audio to classify a case.

`application/window-recognition.ts` maps active canonical cases and configured cues into the pure domain matcher. High-confidence suggestions apply after a 20-second countdown; lower-confidence and unknown-case states require lawyer action. The transition currently uses the interface's observation time. It is not an exact capture boundary or a complete folder-identification rule.

Delayed answers resolve only their original period. Closure and evidence imports preserve the assignment guard. A newer assignment, superseded question, or replaced period causes a conflict. Answers do not teach reusable folder rules.

Activity preview reads are transient. They do not import `sources`, attach them to periods, or advance durable retrieval progress. Overlap recovery and post-interruption catch-up remain incomplete. Integration of the existing JEV workflow is pending; see the [feature tracker](FEATURES.md). [Screenpipe integration](SCREENPIPE_INTEGRATION.md) separates those proposals from current polling.

Late evidence cannot automatically split corrected or validated periods. Preserve the record, sources, and override. Store a reconstruction proposal separately without adding counted time. The resolution action remains undefined.

## Evidence, durations, and summaries

Screenshots establish observations, not continuous duration. Interval reconstruction and missing-recording behavior remain open. Detected boundaries and duration overrides stay separate. Changing an override does not rewrite observations.

Time validation covers the effective case and duration. Changes to either invalidate it. Identical replay and detected changes masked by an unchanged override preserve it. Source validation, time validation, and billing status remain distinct. [Requirements](REQUIREMENTS.md#state-transitions) owns the transition rules.

React uses an override when present and otherwise a supported detected duration. Each selected total uses the complete, precise input set:

```text
combined_minutes = ceil(sum(effective_duration_ms) / 60000)
```

Two 20-second periods total one minute. Zero remains zero. Rounded subtotals cannot be summed to obtain the overall total. Missing pages, unknown durations, and unavailable recordings must expose incomplete coverage.

## Screenpipe assignment synchronization

The planned adapter uses TimeKeeper-owned tags:

```text
timekeeper:<workspace-id>:client:<client-id>
timekeeper:<workspace-id>:case:<case-id>
```

SQLite owns assignment revisions and derives the client from the case. The workspace ID prevents collisions between databases. Screenpipe documents [adding](https://docs.screenpipe.com/api-reference/tags/add-tags) and [removing tags](https://docs.screenpipe.com/api-reference/tags/remove-tags). Target-release behavior and native display remain unverified.

Evidence identity differs from tag-target identity. Multiple records may refer to one frame. The canonical target key contains the Screenpipe instance, target type, and target ID. Do not infer that mapping from timestamps or text.

Aliases must agree on ownership and desired case. Conflicting aliases block synchronization. Deduplicate and serialize writes and ownership changes by canonical target. Check current ownership, desired tags, and revision before writing. A move supersedes former delivery intents. Preserve unrelated tags and verify the resulting tags before acknowledging the same revision. Failed or deleted targets remain unsynchronized. Retries cannot undo corrections or trigger detection loops. Chat text is not a storage acknowledgement.

## MCP and JEV boundaries

Chat reads follow `Screenpipe chat -> MCP -> application API -> SQLite`. Eight implemented tools cover status, sessions, cases, periods, questions, answers, and link status. HTTP uses loopback bearer authentication; stdio serves one local client. [API contracts](API.md#mcp-tools) own tool names and outcomes.

The skill and manual pipes exist but require separate installation. Skills are instructions, not event listeners or connection registration. Installed Screenpipe transport compatibility remains unverified.

JEV is implemented with validation pending. The [integration tracker](FEATURES.md#implemented-integrations-awaiting-validation) records source availability and integration work. The intended boundary remains Screenpipe-owned inference followed by Node validation of an existing case and revision. Confirm permitted hosted fields before running that workflow. Chat-calculated summaries remain deferred. A stopped API cannot satisfy detail reads.

## Storage and implementation gates

[DATABASE.md](DATABASE.md) defines the logical model and physical constraints. Drizzle mappings in `src/backend/adapters/sqlite/tables.ts` use the existing `node:sqlite` connection. One cached Drizzle client per connection keeps query-builder operations and retained parameterized SQL inside the same savepoints. Domain and application ports do not depend on Drizzle.

`src/backend/adapters/sqlite/migrate.ts` alone owns schema upgrades, constraints, indexes, and triggers. Drizzle mappings do not generate migrations. Do not run schema push against existing workspaces.

`tag_targets` and `assignment_deliveries` exist, but assignments do not yet create delivery intent. No provider worker runs. The Screenpipe HTTP reader serves focus and media previews only; it does not synchronize tags or advance persistent retrieval progress. Atomic delivery persistence, provider reconciliation, and verification remain required.

[Requirements](REQUIREMENTS.md) tracks dependent decisions and acceptance examples. Native acceptance must run separately on macOS and Windows.

## Current catalogue, activity, and calendar boundaries

Current screens use canonical catalogue and period APIs. `CatalogService` owns catalogue operations; `SourceExportService` owns source packs and invoice CSV reads. Deprecated compatibility routes translate permitted fields into the same use cases. They retain numeric aliases for older callers, but current screens do not use those aliases.

Period edits, assignment, validation, and billing require their relevant reviewed revisions. Conflicts remain visible. The interface does not silently reload and retry. React owns summaries and invoice drafts. Shared `src/shared/invoice-math.ts` arithmetic lets the invoice service verify proposed amounts against periods, expenses, rates, and tax before freezing them.

The period editor separates corrections, time validation, evidence review, and billing. Screenpipe owns open-period assignment. Issued invoice membership locks edits. A read-only endpoint exposes reconstruction proposals without implying an apply or reject action.

`src/shared/dates.ts` owns calendar conversion and arithmetic. The [calendar policy](DATABASE.md#calendar-dates-and-timestamps) specifies date-only values, instants, explicit timezone, and start-day grouping. Whole-period display does not resolve clipping or midnight-splitting rules. Precise durations and historical invoice snapshots remain authoritative.

## Compatibility recognition

The pure recognition algorithm is deterministic. The current pill uses it through `application/window-recognition.ts` with recorded app and window metadata and the canonical catalogue. The compatibility block route also retains it. Guarded question answers do not learn cues. This heuristic is not the agreed folder-identification rule, and the matcher itself makes no Screenpipe, JEV, or model calls.

`recognize(signals, catalog)` in `src/backend/domain/recognition.ts` is pure. It accepts app, window title, optional browser URL, OCR, transcripts, speakers, and previous-block context, plus clients, matters, and markers. The SQLite compatibility adapter supplies neither browser URLs nor previous-block continuity.

The full matter reference and its `YYYY-NNN` prefix count as one implicit cue. Client name is another. Default weights are `reference` and `case_number` 0.95, `opposing_party` and `file` 0.60, `client_name` 0.30, `email` 0.45, `domain` 0.35, and `keyword` 0.15. Explicit marker weights can range from 0 to 1. Domain markers match only browser URLs. Matching ignores case and accents, treats underscores as spaces, and requires whole-word boundaries. Each distinct cue contributes once per matter. Results retain its type, value, signal location, and weight.

```text
score = min(0.99, 1 - product(1 - cue_weight) + continuity)
```

Continuity adds 0.1 when the previous block has the same matter, app, and title. `decision(candidates, threshold)` assigns at `max(threshold, 0.5)`. Scores from 0.5 up to that threshold propose a matter with `to_check`. Lower scores and tied shared-client-only matches propose none. The compatibility caller uses `confidence_threshold`, 0.8 in the historical fixture.

Only explicit fixture setup refreshes confidence, marker `hits`, and `last_seen_at`. A hit counts one explicit cue per block and candidate, including proposals. Historical assignments stay unchanged, even below the threshold. `GET /api/blocks/{id}/recognition` neither changes counts nor learns cues. Reusable learning remains deferred in [requirements](REQUIREMENTS.md).
