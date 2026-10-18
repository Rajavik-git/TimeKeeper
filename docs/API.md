# TimeKeeper application API

This reference describes the current HTTP API, MCP tools, and integration contracts. The [requirements](REQUIREMENTS.md) own business rules. The [architecture](ARCHITECTURE.md) owns module and process responsibilities. `src/contracts/openapi.yaml` owns the generated transport schemas; `npm run contract:gen` regenerates state values, TypeScript types, and runtime request validators. Shared history DTOs also live in `src/contracts/history.ts`, as described in [D14](#d14-history-proposals-and-explicit-acceptance).

Work-period responses expose `observedAppName`, `observedWindowTitle`, and `recognitionConfidence`; deprecated `demo*` aliases remain for compatibility. Pill decisions return `undoExpiresAt` as an ISO timestamp. Clients must stop offering Undo at that deadline rather than starting a new five-second window on receipt.

The integration preserves the current UI's canonical catalogue, empty startup, revision guards, source exports, invoice snapshots, Node version, and desktop process safeguards. Service ownership and dependency injection follow the [implemented modules](ARCHITECTURE.md#implemented-modules).

## Current API

The API listens on loopback, normally `127.0.0.1:8787`. `TIMEKEEPER_PORT` overrides its development port. JSON requests pass schema validation and a size limit. Browser origins use the existing allow-list. Canonical identifiers are opaque strings; retained historical compatibility endpoints can use numeric aliases.

`GET /health` and `GET /api/health` return `{"status":"ok"}` after local inbox consumption has run. They do not establish Screenpipe, JEV, capture, or complete evidence readiness. Slow provider reads run after the API starts.

All errors use `{"error": code, "message": text}` through the application error handler. Clients branch on the code and show the message. They do not parse message text.

| Code                | HTTP | Meaning                                                                                              |
| ------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `invalid-request`   | 400  | Invalid JSON, schema, field, calendar date, or identifier. Oversized requests return 413.            |
| `not-found`         | 404  | Requested record does not exist.                                                                     |
| `no-active-session` | 404  | Operation requires an active or known session.                                                       |
| `conflict`          | 409  | Stale revision, changed replay payload, missing prerequisite state, or a forbidden state transition. |
| `rule-not-decided`  | 409  | Action depends on an unresolved product policy.                                                      |
| `forbidden-origin`  | 403  | Browser origin is outside the allow-list.                                                            |
| `internal`          | 500  | Unexpected failure; storage details are not exposed.                                                 |

`application/errors.ts` defines the one `AppError` class. Refusals are errors, never successful `202` responses. Stored commands waiting for prerequisites and recorded questions use `202 pending`. A stored reconstruction proposal can also return `202`, but requires review and does not mean that replacement time was applied.

### Sessions and commands

| Method and path                           | Behavior                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/sessions`, `/api/sessions/{id}` | List or read sessions.                                              |
| `GET /api/sessions/active`                | Active session or `null`.                                           |
| `POST /api/commands/start`                | Start or return the current session without resetting its boundary. |
| `POST /api/commands/end`                  | End the target session, retaining the first applied end boundary.   |

Commands require `producerId`, `commandId`, `sessionId`, and `occurredAt`; `prerequisiteCommandId` is optional. Identical replay returns the stored outcome. Reusing an identity with a different original payload conflicts. Known prerequisites apply before their dependents. Receipt is distinct from application.

### Work periods and review

| Method and path                                 | Behavior                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/work-periods`                         | Filter by `sessionId`, `caseId`, `clientId`, `date`, `from`, `to`, and `timeZone`. Calendar filters use local start-day grouping. |
| `GET /api/work-periods/{id}`                    | Read a period. The list endpoint derives its client.                                                                              |
| `GET /api/work-periods/{id}/sources`            | Read linked source references.                                                                                                    |
| `POST /api/work-periods`                        | Record a transition. Current inferred transitions require the snapshot described in D10. Recovery retains protected-period rules. |
| `POST /api/work-periods/manual`                 | Existing explicit manual-period contract; does not infer capture or duration rules.                                               |
| `PATCH /api/work-periods/{id}/details`          | Edit details with required `expectedRevision`.                                                                                    |
| `POST /api/work-periods/{id}/assignment`        | Assign an existing case with required `expectedAssignmentRevision`.                                                               |
| `POST /api/work-periods/{id}/detected-duration` | Existing detected-duration update.                                                                                                |
| `POST /api/work-periods/{id}/duration-override` | Set a duration or `null`, with required `expectedRevision`.                                                                       |
| `POST /api/work-periods/{id}/validate-time`     | Validate or remove validation with required `expectedEffectiveRevision`.                                                          |
| `POST /api/work-periods/validate-time`          | Validate 1 to 500 distinct `{id, expectedEffectiveRevision}` targets atomically. One refusal rolls back the batch.                |
| `POST /api/work-periods/{id}/billing-status`    | Set `billed` or `unbilled`, with required `expectedRevision`.                                                                     |

Mandatory reviewed revisions from the UI baseline remain mandatory. They replace the incoming branch's optional guards. HTTP caller behavior must match the generated contract.

### Questions, evidence, and coverage

| Method and path                                                          | Behavior                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /api/questions`                                                     | Filter by session, status, ownership, and calendar inputs.            |
| `POST /api/questions`                                                    | Record a question tied to a session, period, and assignment revision. |
| `POST /api/questions/answer`                                             | Answer the original question with its full guarded identity.          |
| `GET /api/sources`                                                       | Source references, optionally filtered by `periodId`.                 |
| `POST /api/sources`                                                      | Import one reference or an array of 1 to 500, all or nothing.         |
| `POST /api/sources/import`                                               | Retained single-reference import endpoint for existing callers.       |
| `POST /api/sources/{instanceId}/{contentType}/{externalId}/validate`     | Validate by default; `{"validated":false}` removes source validation. |
| `POST /api/sources/{instanceId}/{contentType}/{externalId}/availability` | Existing availability update.                                         |
| `GET /api/coverage-gaps`                                                 | Incomplete retrieval windows with session and calendar filters.       |
| `GET /api/reconstruction-conflicts`                                      | Read stored proposals without implying an apply action.               |

Source imports require `{id, periodId, instanceId, contentType, externalId, recordedAt}`. `periodId` is explicitly `null` when unknown. The response mirrors the request's object or array shape and contains `{id,status}`, with status `imported` or `unchanged`. Duplicate provider identity returns the original source ID. Changed identity payloads conflict. Relocated-source replay preserves prior corrections. This public write contract remains identity-only. The internal search importer can retain bounded source text and context under [D13](#d13-source-content-and-late-attachment).

### Catalogue, billing, and existing UI operations

`GET /api/clients`, `GET /api/cases`, and `GET /api/settings` expose canonical reads through `CatalogService`. Cases include `clientName`; `clientId` and `status` filters are supported. Status must be `active` or `archived`. JEV uses active existing cases, never invented IDs.

The current UI continues using `/api/catalog`, its catalogue writes, and the transactional `/api/workspace` snapshot. Existing invoice, expense, source-pack, CSV, and guarded pill decision endpoints remain available. Historical compatibility endpoints translate to canonical services. New runtime startup never seeds fictional records, and no demo reset endpoint is added by this port.

### A14. Failed inbox commands

`GET /api/inbox/failed` returns entries newest first:

```json
[
  {
    "file": "end-example.json",
    "kind": "end",
    "sessionId": "session-example",
    "occurredAt": "2026-10-17T18:00:00.000Z",
    "error": "conflict",
    "message": "end before start"
  }
]
```

Malformed files have null command fields. Missing error metadata produces a safe `internal` result. `POST /api/inbox/failed/{file}/dismiss` returns `{status:"dismissed",file}` and is idempotent. Unknown files return 404. File names must be single safe JSON names, never traversal paths or sidecar error files. `createApp()` uses an empty consumer unless one is explicitly supplied; application factories do not touch the filesystem.

The API is implemented. A dedicated failed-command interface remains deferred. Dismissing a failure does not apply its original command.

## API decisions

### D1. No local access token for the hackathon

TimeKeeper retains loopback binding and the browser origin allow-list. It does not add an application token. This decision covers inbound TimeKeeper requests. Outgoing Screenpipe authentication remains required.

### D2. Undo a validation through the same endpoint

Time validation accepts `validated:false` alongside required `expectedEffectiveRevision`. Source validation accepts optional `validated:false`. Undo is idempotent and does not change assignment, duration, or billing. Billed or invoiced periods cannot silently lose required validation.

### D3. Read-only chat uses existing read endpoints

Chat tools use the same session, case, period, source, and question reads as other callers. They report application unavailability honestly. They do not calculate totals. Workflow commands and lawyer-answer tools are separately named write operations.

### D4. Error codes replacing pending for refusals

One application error class and one HTTP mapping are retained. Missing rates, case, or duration are conflicts. Undecided billing and reconstruction policies return `rule-not-decided`. Stored pending command outcomes are distinct from those refusals. Drizzle-wrapped SQLite errors remain sanitized.

### D5. Calling Screenpipe's API with its token

Development setup fills a missing root `.env` key through Screenpipe's supported `auth token` command. Existing keys remain unchanged. [Setup and recovery](SETUP.md#prepare-timekeeper) describes discovery, check mode, and retries. Saving a key does not verify protected API access.

The reader uses `SCREENPIPE_URL`, default `http://localhost:3030`, `SCREENPIPE_API_KEY`, and `SCREENPIPE_INSTANCE_ID`, default `local`. Protected reads send `Authorization: Bearer ...` and `X-Screenpipe-Client: api`. Health reads need no key.

A missing key prevents automatic catch-up. A 401/403 pauses automatic retries; an explicit successful connection test or sync can resume them. Changed environment settings require a backend restart. The key is never returned or logged. Timeouts, unavailable reads, invalid pagination, and page-cap truncation leave coverage incomplete. Existing source references remain intact. The adapter reads references for accessibility, OCR, and audio, with cloud reads excluded.

Provider response assumptions remain subject to selected-release acceptance. Unit stand-ins do not verify a real Screenpipe installation.

### D6. Screenpipe reaches the API through the TimeKeeper MCP server

React and TimeKeeper MCP call the HTTP API. MCP never accesses the TimeKeeper business database. A dedicated watcher coordination file is separate from application persistence. The Node MCP server supports stdio and loopback HTTP at `/mcp`. Tool names include status, session Start and End, case and period reads, questions and answers, guarded transitions, watcher status, and recording-link status.

Source command: `npm run mcp:serve`. HTTP command: `npm run mcp:http`. These commands and the registration commands load the root `.env`. Built command from the repository root: `node --env-file-if-exists=.env dist/src/mcp/server.js --http`. `TIMEKEEPER_MCP_PORT` selects the validated port for both the server and installer, defaulting to `3032`. An explicit `--http PORT` overrides it for that server invocation. MCP registration and Screenpipe pipe installation remain explicit setup actions.

MCP request deadlines include the complete response body. Interrupted HTTP uploads remain contained within their request. Identical `answer_question` calls retain a stable response command identity. If delivery may have committed but its acknowledgement is lost, the tool reports `unconfirmed`; repeating that same question and case can retrieve the stored result without applying another assignment. A different answer still conflicts.

### D7. The lawyer starts and ends a session with a button in Screenpipe

Screenpipe recording boundaries and explicit Start and End commands establish TimeKeeper session boundaries. Opening or closing TimeKeeper does not establish one.

The recording link is enabled explicitly with `--screenpipe-link`, for example `npm run mcp:http -- --screenpipe-link`. It polls Screenpipe health every ten seconds and persists its observations. The documented unreachable grace period is `TIMEKEEPER_LINK_GRACE_SECONDS`, default 60. A stop uses the last observed-running boundary, subject to the documented active-period lower bound. The link preserves command identities during retries and allocates a new capture-run identity after a completed end, even when the Screenpipe engine stays running. Successful starts are checked against the active-session API. It does not target a newer session. Malformed health responses do not establish a recording boundary.

The running link persists prepared command identities and end boundaries before delivery. State files use atomic replacement and a mirrored `.backup` copy. Recovery selects the newest valid revision. If existing copies are invalid or unreadable and neither can recover the state, startup refuses to reset it silently. This protects process-interruption recovery; concurrent link processes and power-loss directory durability remain unverified.

Only a running link can observe recording changes. Login startup and real provider stop semantics require selected-release acceptance. Pending receipt is not reported as completed application.

### D8. Synchronization at startup through a local inbox folder

The inbox consumer reads `TIMEKEEPER_INBOX` or `inbox` beside the selected database. Producers write temporary files and atomically rename them to JSON. Each file holds a start or end command, including its original IDs, timestamp, and optional prerequisite.

The consumer applies known causal prerequisites first, then orders independent commands by timestamp and command ID. Applied files move to `done`; invalid or refused commands move to `failed` with sanitized error metadata. Stored pending commands remain available. Unexpected storage or file-move failures remain retryable. Replaying a committed command after a file-move failure does not apply it twice.

Consumption runs before API readiness and every thirty seconds. It does not implement the missing stopped-app producer. Current tools report failed delivery when the API is unavailable. End delivery while all relevant services are stopped remains incomplete.

Evidence catch-up runs after API readiness and every five minutes when Screenpipe is configured. Reads use one-hour windows, a five-minute overlap, and at most 24 windows per run. Unfinished history takes priority over repeated final-tail scans. Completed ended sessions retain a bounded final overlap scan for late indexing. Evidence indexed outside that overlap requires explicit broader reconciliation; this is not a provider completeness guarantee.

A window becomes complete only after all pages and imports succeed. Incomplete pagination fails the read. A previously corrected source attachment stays unchanged. Original-time session ends are rechecked before provider reads, after asynchronous reads, and before imports. Coverage beyond a shortened session is not acknowledged. Gap closure requires the entire failed range to be covered, not merely its end.

### D9. Only past days can be validated

Time validation requires a finished period whose start belongs to a past local calendar day. The backend uses the computer's timezone and an injectable clock for tests. A period beginning yesterday and ending today belongs to yesterday. A running period is never eligible.

The service enforces this rule for direct, bulk, pill, and compatibility callers. The UI disables current-day and running-period validation. Removing validation stays permitted with its revision guard. Existing multi-call UI validation still reports partial progress; the new bulk API is atomic.

### D10. JEV-confirmed tab changes become work-period transitions

JEV is the sole active automatic detector. Native recognition is inactive and backed up under `backups/native-recognition-d575502/`. The pill retains manual answers, validation, undo, and navigation, and reads current periods and questions through the API.

A JEV request captures the active period ID and assignment revision before inference. `record_case_transition` requires:

```text
sessionId, transitionAt, caseId,
expectedActivePeriodId, expectedAssignmentRevision
```

Both expected values are explicitly null when no period exists. The corresponding `POST /api/work-periods` uses the deterministic ID `auto-<sessionId>-<capture epoch milliseconds>`, `mode:current`, and `origin:automatic` or `unresolved`.

The service checks the snapshot atomically. Newer lawyer assignments reject stale inference. Identical applied replay preserves corrections. Stored reconstruction proposals fingerprint the original transition payload; changed reuse conflicts, and unverifiable legacy proposal IDs are refused. Same-case observations do not create another period. A proposed split of a duration-corrected or validated period creates a reconstruction proposal without changing counted periods. Unknown cases create an unresolved period and a revision-bound question. No interval duration is inferred from screenshots.

The watcher compares application and window title together when selecting captures and checking freshness. A known focus boundary is retained when the previous focus event is outside the retrieval window. Missing preceding evidence remains `insufficient_data`; a later screenshot does not replace that boundary.

Retryable evidence and inference failures retain the pending focus change, with delays of one, two, four, eight, sixteen, then at most thirty seconds. Once delivery is uncertain, retries preserve the original payload and guards without another model call. A newer focus event discards the older pending work. Explicit conflicts, accepted reconstruction proposals, and permanent model failures end that check. Invalid successful session responses do not establish that a session ended.

Bun is not required. Source scripts use the pinned Node runtime and `tsx`; the build emits JavaScript MCP and JEV entries. JEV still needs explicitly configured permitted fields, TypeSafe credentials, and separately installed Screenpipe MCP. Those components are not installed or started by normal application startup, and are not bundled into the desktop API sidecar.

### D11. Screenpipe controls in Settings

| Endpoint                                 | Behavior                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/integrations/screenpipe`       | Read configuration readiness, connection-test result, running flags, and batch status. Does not contact Screenpipe. |
| `POST /api/integrations/screenpipe/test` | Make a small authenticated read. Does not import references, create sessions, change recording, or invoke JEV.      |
| `POST /api/integrations/screenpipe/sync` | Run the existing bounded importer immediately. Overlapping manual and scheduled calls share the same run.           |

POST bodies are optional empty objects. All three endpoints return `ScreenpipeIntegrationStatus`. HTTP success means the diagnostic request completed; callers must inspect `connection.status` or `lastRun.outcome`. Missing configuration, no sessions, partial import, and failed import are explicit outcomes. Partial runs retain the counts of references already committed and do not advance `lastSuccessfulSyncAt`. A zero-window batch establishes no authenticated access and does not advance that timestamp. `preserved` counts both skipped out-of-boundary references and existing source attachments left unchanged.

Configuration remains in the backend environment. The coordinator accepts an HTTP loopback origin without credentials, query, fragment, or path and requires a nonblank API token. Status responses contain neither the token nor the configured URL. They contain only sanitized failure categories and messages. Runtime status resets when the backend restarts; persisted references and retrieval checkpoints remain intact.

The Settings section polls status while open. It blocks repeated actions while work is pending and refreshes application reads after an import. Automatic import retains its five-minute cadence and the bounds in [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder). These actions import references within existing sessions. They do not reconstruct historical work periods or install and launch MCP/JEV.

### D12. Visibility of imported sources

Activity's **Imported sources** view reads the unscoped workspace snapshot. It includes all references saved in TimeKeeper, including `workPeriodId: null`. All saved rows remain accessible through search, link-status and content-type filters, and pagination. This does not broaden Screenpipe retrieval beyond existing session boundaries or imply that every provider recording has been imported.

My day keeps its date-scoped period model. Reading a source does not create a period, infer duration, assign a case, validate time, or affect billing. The **Work periods** view retains period-linked sources and review actions. Opening sources from a particular work period still selects that period's review view.

Imported references expose their stored identity, timestamps, validation, availability, observed app and window, and optional source excerpt. They do not fetch media or screen content on display. Absent content stays explicit.

### D13. Source content and late attachment

The importer continues using authenticated, paginated `GET /search` within existing session boundaries. It does not add a keyword filter, because that would omit unrelated evidence. Screenpipe's saved AI memories are not the complete recording stream. The [search reference](https://docs.screenpipe.com/api-reference/search/search-screen-and-audio-content) describes the recorded text and app/window fields.

The internal retrieval path fills missing `excerpt`, `appName`, and `windowName` fields. Excerpts are literal provider text or audio transcription, limited to 1,000 characters. Context fields are limited to 300 characters each. Existing nonblank fields remain unchanged. Full recordings and media stay in Screenpipe. Text is untrusted evidence, rendered as text, and never used as instructions or as an automatic work-period description.

Each sync also rechecks saved unlinked references for the configured provider instance. Attachment requires one containing session and one containing existing period. Period intervals include their start and exclude their end, except the final session-end boundary. Ambiguous or absent matches stay unlinked. Existing attachments and relocation history remain protected. This changes neither period details nor time, billing, validation, or assignment revisions. Direct source API writes retain their conflict guards.

Retrieval checkpoints have a content version. Older identity-only checkpoints do not suppress the first bounded content replay. Once reread, the current checkpoint resumes normal catch-up and final-tail scans. Reads retain the limits and failure rules in [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder). Content that Screenpipe no longer returns cannot be recovered from its reference alone. Optional batch count `updated` reports existing references enriched or attached during that run; older status payloads imply zero.

### D14. History proposals and explicit acceptance

The current source connects an opt-in history workflow to **Activity → History proposals**. This addition appeared during documentation review and has no runtime acceptance recorded here. History routes are declared in OpenAPI and the generated request schemas. Shared DTOs also live in `src/contracts/history.ts`. Documentation review does not establish synchronization of every generated client or response artifact.

| Route                                     | Purpose                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/history?sessionId=…`            | Read configuration status, jobs, and proposals.                                         |
| `POST /api/history/generate`              | Request generation with `sessionId`, `startAt`, and `endAt`.                            |
| `GET /api/history/jobs/{id}`              | Read one job's public status.                                                           |
| `POST /api/history/claim`                 | Claim one pending job for the Screenpipe workflow.                                      |
| `POST /api/history/jobs/{id}/complete`    | Submit `claimId` and draft `proposals`.                                                 |
| `POST /api/history/jobs/{id}/fail`        | Submit `claimId` and a sanitized failure category.                                      |
| `POST /api/history/proposals/{id}/accept` | Submit `expectedRevision`, reviewed case, boundaries, label, and explicit `durationMs`. |
| `POST /api/history/proposals/{id}/reject` | Reject a draft with `expectedRevision`.                                                 |

Generation requires an existing session, imported evidence, a range longer than zero and at most one hour, no overlapping incomplete retrieval gaps, and at most 10,000 supporting sources. Only one job can remain pending or running. An unclaimed job expires after two minutes; a running claim expires after fifteen minutes. `configured` proves valid backend address and key configuration, not that the pipe, MCP transport, or hosted inference is ready.

The backend dispatches `POST /pipes/generate-work-periods/run` through Screenpipe. The pipe calls MCP tool `generate_history_proposals`, which claims the job, sends permitted context to JEV, and submits drafts. Uncertain dispatch acknowledgement does not trigger automatic redispatch. `ready` means drafts exist, not that periods or worked duration were accepted.

Explicit acceptance requires a positive integer duration in milliseconds supplied by the lawyer. It creates a finished, unvalidated, unbilled period with a duration override. Snapshot and revision checks reject stale changes. Existing periods cannot overlap the accepted range, and existing source attachments remain protected. An unresolved accepted case creates a question. Identical accepted replay returns the stored result; changed replay conflicts.

History inference uses the MCP process environment directly. It requires `TYPESAFE_API_KEY` and approved `JEV_ALLOWED_FIELDS`. The watcher-local file alone does not configure this path. The current history source reads `MODEL`, default `jev-latest`, rather than the live watcher's `TYPESAFE_MODEL`. [Setup](SETUP.md#configure-history-proposals) owns deployment instructions and this configuration difference.

### D14. History generation and proposal review

| Endpoint                                  | Behavior                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/history?sessionId=...`          | Read jobs and proposals. Workflow claim tokens are excluded.                                      |
| `POST /api/history/generate`              | Request `{sessionId,startAt,endAt}` and dispatch the manual Screenpipe pipe.                      |
| `GET /api/history/jobs/{id}`              | Read persisted progress; overdue jobs expire on reads.                                            |
| `POST /api/history/claim`                 | Atomically claim one pending job and return its bounded evidence snapshot and private claim ID.   |
| `POST /api/history/jobs/{id}/complete`    | Submit `{claimId,proposals}` atomically. Identical completion replay is preserved.                |
| `POST /api/history/jobs/{id}/fail`        | Submit a safe failure category with the claim ID.                                                 |
| `POST /api/history/proposals/{id}/accept` | Accept reviewed boundaries, case, label and explicit `durationMs`, guarded by `expectedRevision`. |
| `POST /api/history/proposals/{id}/reject` | Reject a draft with `expectedRevision`.                                                           |

Generation permits one active workspace job, up to one hour, 10,000 saved references, 2,048 distinct permitted contexts, and 100 proposals. The workflow batches up to 32 independent JEV choices per request. Repeated context reuses its classification, preserving A → B → A transitions. Same-time contradictions remain unresolved. A point exactly at the exclusive requested end cannot start a proposal. An observation's exclusive endpoint can be one millisecond later; that boundary is not a worked-duration estimate.

The backend checks the TimeKeeper MCP tool capability before sending authenticated `POST /pipes/generate-work-periods/run` to the configured loopback Screenpipe origin. It never runs JEV. The manual pipe calls `generate_history_proposals`; this MCP workflow claims the job, classifies its saved Screenpipe evidence with the existing field filter, and submits drafts. No pending job means no model calls. Raw evidence is not returned to the pipe's chat. Provider acknowledgement establishes dispatch only. An uncertain dispatch is not repeated automatically.

Unclaimed jobs expire after two minutes; running jobs expire after fifteen minutes. Status is persisted across restarts. Snapshots guard source identity, context and attachment, relevant periods, session boundaries and catalogue changes. Source validation or availability reviews alone do not stale a draft. Acceptance requires an explicit positive duration, refuses all existing-period overlaps, and creates a finished period without closing the active one. [Requirements](REQUIREMENTS.md#work-period-proposals-from-history) own the review rules.

## Verification limits

Automated tests use isolated databases and stand-in providers. Native capture, real Screenpipe transport, hosted JEV behavior, login startup, and installed runtime paths require separate acceptance. A loopback HTTP test skips explicitly when the execution environment denies binding. Such a skip is not HTTP transport acceptance.
