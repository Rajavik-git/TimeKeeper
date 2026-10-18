# TimeKeeper architecture

## Scope and ownership

TimeKeeper implements React, a local Hono API, application services, and SQLite persistence for the [requirements](REQUIREMENTS.md). Tauri hosts the desktop windows. Node runs separately. Process management and bundling its runtime remain release requirements. Node uses [`.nvmrc`](../.nvmrc). Package and Cargo lockfiles record dependency versions.

Screenpipe owns recording and triggered workflows. Node validates commands and writes records. React calculates summaries. The [setup guide](SETUP.md) owns environment preparation. Its public-health check does not wire integrations. The Screenpipe release and native release acceptance remain open.

## Components and flows

The diagram includes planned connections. The launcher, MCP, trigger bridge, provider reads, tag adapter, and JEV workflow are unimplemented. The pending-command box is an unresolved contract. See [implemented modules](#implemented-modules) for the current call path and [AGENTS.md](../AGENTS.md) for dependency rules.

```mermaid
flowchart LR
    Lawyer[Lawyer]
    subgraph SP[Screenpipe]
        Commands[Explicit start and end commands]
        Bridge[Context-change trigger bridge]
        Workflow[Pipe workflow using TimeKeeper skill]
        Memory[Recorded memory API]
        Tags[Case tags on source frames]
        Chat[Read-only chat queries]
        Commands --> Workflow
        Bridge -.->|Release verification required| Workflow
        Workflow -->|Retrieve evidence| Memory
    end
    Workflow -->|Start and wait for readiness| Launcher[External desktop launcher]
    Workflow -->|Ambiguous context| JEV[JEV]
    subgraph TK[TimeKeeper desktop]
        Host[Tauri host]
        UI[React review and summary calculations]
        MCP[MCP tools]
        API[Node API and application services]
        DB[(SQLite)]
        Adapter[Source-tag adapter]
        Host -.->|Process management pending| API
        UI <--> API
        MCP --> API
        API <--> DB
        API --> Adapter
    end
    Launcher --> Host
    Workflow -->|When available: scoped commands| MCP
    Chat <-->|When available: read tools| MCP
    API -->|Retrieve review sources| Memory
    Adapter -.->|Reconcile and verify tags| Tags
    Workflow -.->|When app is stopped| Pending[Durable command handling: design open]
    Pending -.->|Reconcile after readiness| MCP
    Lawyer --> Commands
    Lawyer --> Chat
    Lawyer --> UI
```

| Component                      | Responsibility                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Screenpipe recorder and API    | Capture activity and expose observations and sources.                                              |
| Screenpipe bridge and workflow | Receive signals, retrieve evidence, resolve cases, ask about unknown folders, and submit commands. |
| JEV                            | Judge ambiguous context using known candidates. Never create case IDs or validate time.            |
| External launcher              | Start or activate Tauri before waiting for API readiness.                                          |
| MCP server                     | Translate scoped commands and read queries into API requests. Never access SQLite directly.        |
| Node application services      | Validate commands and preserve revisions and corrections through one write path.                   |
| Source-tag adapter             | Deliver committed assignments and verify tags.                                                     |
| React interface                | Review, correct, validate, manage billing status, and calculate summaries.                         |
| SQLite                         | Store details, recovery state, and frozen issued invoices.                                         |

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

Session state is independent of process state. The current Rust host hides the main window on close. Tray **Quit** exits Tauri. Neither action stops the separately launched API. Stopping the API closes SQLite without ending the stored session. Coordinated lifecycle remains unimplemented.

| Action                             | Required effect                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Start command in Screenpipe        | Launch or activate TimeKeeper, wait for readiness, and create a session or return the existing active session unchanged. |
| Close TimeKeeper                   | Exit Tauri and Node while preserving the open session and period.                                                        |
| Reopen TimeKeeper                  | Resume and reconcile history without duplicate periods or lost corrections.                                              |
| End command in Screenpipe          | End the targeted session and its active period. Repeated ends retain the original boundary. Screenpipe keeps recording.  |
| Receive evidence after session end | Reconcile observations within the session boundaries without reopening or extending it.                                  |

Commands need stable IDs, the authoritative session ID returned by start, effective timestamps, and revision guards. Receipt time cannot replace effective time. Retries have no additional effect.

Recovery applies known prerequisites before dependents. An end waiting for its start stays pending. An end without a valid target cannot create a session. A new start dependent on a pending end waits instead of collapsing into the old session. Unresolved order remains pending or conflicting. A later end timestamp cannot revise an applied boundary.

When the app is stopped, its API, MCP, and SQLite writer cannot receive session commands, assignments, or lawyer answers. Durable storage outside the process or controlled relaunch remains to be chosen and tested. A local queue and recordings alone cannot preserve those decisions.

## Case assignment and evidence flow

Folder detection and effective boundaries remain undefined. Ordinary application switches preserve the active case. Unknown-folder questions use the [requirements guards](REQUIREMENTS.md#state-transitions), including a target period and expected assignment revision.

1. A verified Screenpipe signal wakes its workflow.
2. The workflow retrieves persisted observations through Screenpipe's API and candidate cases through MCP.
3. The workflow selects an existing case, uses JEV when needed, or asks the lawyer.
4. A scoped MCP command submits the assignment and evidence.
5. Node checks the session boundary, case identity, expected revision, and manual corrections.
6. One transaction saves the assignment and pending tag-delivery intent.
7. The adapter reconciles tags and records verification or retryable failure.

This provider flow is planned. Delayed answers resolve only their original period. Closure and evidence imports preserve the assignment guard. A newer assignment, superseded question, or replaced period causes a conflict. Answers do not teach reusable folder rules.

Recovery rereads overlapping windows, deduplicates source identities, and advances retrieval progress only with committed records. A signal may precede searchable evidence. An empty query does not prove inactivity. [Screenpipe research](SCREENPIPE_INTEGRATION.md) covers transport and producer verification.

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

Chat reads follow `Screenpipe chat -> MCP -> application API -> SQLite`. Workflow writes use separate scoped commands. Desktop controls own corrections and validation. Tool schemas, transport compatibility, and local access controls remain unimplemented.

Screenpipe workflows own JEV calls and candidate selection. Node validates their chosen existing case without repeating inference. [Integration research](SCREENPIPE_INTEGRATION.md) records HTTP MCP, skill import, and JEV evidence. Skills are instructions. They neither register MCP connections nor listen for events. Hosted inference requires a decision about permitted source data.

Chat reports application details unavailable when the API is stopped. Read-only detail queries remain in scope when services are available. Chat-calculated summaries are deferred.

## Storage and implementation gates

[DATABASE.md](DATABASE.md) defines the logical model and physical constraints. Drizzle mappings in `src/backend/adapters/sqlite/tables.ts` use the existing `node:sqlite` connection. One cached Drizzle client per connection keeps query-builder operations and retained parameterized SQL inside the same savepoints. Domain and application ports do not depend on Drizzle.

`src/backend/adapters/sqlite/migrate.ts` alone owns schema upgrades, constraints, indexes, and triggers. Drizzle mappings do not generate migrations. Do not run schema push against existing workspaces.

`tag_targets` and `assignment_deliveries` exist, but assignments do not yet create delivery intent. No provider worker runs. The Screenpipe adapter contains types only. Atomic delivery persistence, provider reconciliation, and verification remain required.

[Requirements](REQUIREMENTS.md) tracks dependent decisions and acceptance examples. Native acceptance must run separately on macOS and Windows.

## Current catalogue, activity, and calendar boundaries

Current screens use canonical catalogue and period APIs. `CatalogService` owns catalogue operations; `SourceExportService` owns source packs and invoice CSV reads. Deprecated compatibility routes translate permitted fields into the same use cases. They retain numeric aliases for older callers, but current screens do not use those aliases.

Period edits, assignment, validation, and billing require their relevant reviewed revisions. Conflicts remain visible. The interface does not silently reload and retry. React owns summaries and invoice drafts. Shared `src/shared/invoice-math.ts` arithmetic lets the invoice service verify proposed amounts against periods, expenses, rates, and tax before freezing them.

The period editor separates corrections, time validation, evidence review, and billing. Screenpipe owns open-period assignment. Issued invoice membership locks edits. A read-only endpoint exposes reconstruction proposals without implying an apply or reject action.

`src/shared/dates.ts` owns calendar conversion and arithmetic. The [calendar policy](DATABASE.md#calendar-dates-and-timestamps) specifies date-only values, instants, explicit timezone, and start-day grouping. Whole-period display does not resolve clipping or midnight-splitting rules. Precise durations and historical invoice snapshots remain authoritative.

## Compatibility recognition

Imported mockup recognition is deterministic. Canonical assignments and guarded answers neither run it nor learn cues. It is not the agreed folder-identification rule. Normal startup has no capture blocks, and recognition makes no Screenpipe, JEV, or model calls.

`recognize(signals, catalog)` in `src/backend/domain/recognition.ts` is pure. It accepts app, window title, optional browser URL, OCR, transcripts, speakers, and previous-block context, plus clients, matters, and markers. The SQLite compatibility adapter supplies neither browser URLs nor previous-block continuity.

The full matter reference and its `YYYY-NNN` prefix count as one implicit cue. Client name is another. Default weights are `reference` and `case_number` 0.95, `opposing_party` and `file` 0.60, `client_name` 0.30, `email` 0.45, `domain` 0.35, and `keyword` 0.15. Explicit marker weights can range from 0 to 1. Domain markers match only browser URLs. Matching ignores case and accents, treats underscores as spaces, and requires whole-word boundaries. Each distinct cue contributes once per matter. Results retain its type, value, signal location, and weight.

```text
score = min(0.99, 1 - product(1 - cue_weight) + continuity)
```

Continuity adds 0.1 when the previous block has the same matter, app, and title. `decision(candidates, threshold)` assigns at `max(threshold, 0.5)`. Scores from 0.5 up to that threshold propose a matter with `to_check`. Lower scores and tied shared-client-only matches propose none. The compatibility caller uses `confidence_threshold`, 0.8 in the historical fixture.

Only explicit fixture setup refreshes confidence, marker `hits`, and `last_seen_at`. A hit counts one explicit cue per block and candidate, including proposals. Historical assignments stay unchanged, even below the threshold. `GET /api/blocks/{id}/recognition` neither changes counts nor learns cues. Reusable learning remains deferred in [requirements](REQUIREMENTS.md).
