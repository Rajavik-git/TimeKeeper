# Screenpipe integration research

Research date: 2026-10-17. Findings concern public documentation and `main`, not a tested installed release. No personal recordings were accessed. No Screenpipe release is pinned. This dated research does not establish installed-release acceptance. The current [API reference](API.md) and [architecture](ARCHITECTURE.md) describe the implemented integration.

## Environment readiness and integration status

The [setup guide](SETUP.md) covers TimeKeeper dependencies, local key discovery through Screenpipe's CLI, and a separately installed Screenpipe service. Setup's network check requests only public `GET /health`. `SCREENPIPE_API_URL` configures that check and the JEV Screenpipe MCP reader. Backend evidence reads and the recording link use `SCREENPIPE_URL`. Keep these URLs on the same instance for a shared workflow. Screenpipe documents port 3030 and authentication for protected routes when enabled. [Screenpipe installation and API readiness](https://docs.screenpipe.com/getting-started).

The HTTP reader, MCP server, workflow instructions, JEV watcher, and recovery consumers exist in source. Setup does not register or launch them. Protected access, capture, installed transport, and tag synchronization still need selected-release verification. The API sidecar does not bundle the separate JEV workflow or Screenpipe MCP dependency.

## Required outcome

Screenpipe supplies recorded evidence and owns context detection. Its configured workflow submits guarded assignments to TimeKeeper, and chat retrieves application details. Returning case associations to Screenpipe tags remains planned; no tag-write adapter is implemented. The [architecture](ARCHITECTURE.md) owns this design. [Requirements](REQUIREMENTS.md) own business behavior.

Resolve captured context against TimeKeeper's case catalogue. Multiple tabs can concern one case, and cases can change within one tab.

Here, "memory" means recorded API activity. `/memories` contains saved AI knowledge rather than the complete capture stream. Use recorded frames and text as evidence. [Screenpipe memories reference](https://docs.screenpipe.com/api-reference/memories/list-memories).

## Capabilities found in provider research

| Capability                           | Documentation evidence                                                                                                                                                                     | TimeKeeper use                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Capture changes in screen context    | Screenpipe documents capture triggered by app switches, focus, interaction, and typing pauses, with accessibility text and OCR fallback.                                                   | Observe recorded context changes. This does not guarantee a public browser-tab-change event. |
| Read recorded activity               | `GET /search` supports time bounds, pagination, content types, app/window/URL filters, and focus filtering. Frame results can include timestamp, frame ID, text, URL, and window metadata. | Retrieve new observations and compare them with previous observations.                       |
| Inspect a recorded frame             | `GET /frames/{frame_id}/context` provides text, nodes, and extracted URLs. `GET /frames/{frame_id}` provides the recorded screenshot.                                                      | Enrich ambiguous observations and display evidence for review.                               |
| Let chat call an external MCP server | The changelog documents custom HTTP MCP connections with a name, URL, optional headers, connection testing, and enablement.                                                                | Connect Screenpipe chat to TimeKeeper's read-only tools.                                     |

Sources: [capture architecture](https://docs.screenpipe.com/architecture), [search reference](https://docs.screenpipe.com/api-reference/search/search-screen-and-audio-content), [frame context](https://docs.screenpipe.com/api-reference/frames/get-frame-context), [frame image](https://docs.screenpipe.com/api-reference/frames/get-frame-by-id), and [Screenpipe changelog](https://docs.screenpipe.com/changelog).

Validate response fields and content types against the selected release. A missing URL does not prove the case is unchanged.

## Recommended two-way architecture

The [architecture](ARCHITECTURE.md) defines the component flow. Screenpipe owns detection and JEV requests. Node validates and persists commands through shared application services. React calculates summaries.

### Screenpipe queries TimeKeeper

The TimeKeeper MCP server exposes current application reads and explicitly scoped workflow writes. Screenpipe chat reaches it through its configured `timekeeper` registration. Current tools include `timekeeper_status`, `list_cases`, `list_work_periods`, `list_questions`, `answer_question`, session commands, and `record_case_transition`. They use the HTTP API and canonical application IDs.

The [API MCP contract](API.md#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server) and [Screenpipe skill](../integrations/screenpipe/timekeeper/SKILL.md) own tool names, request fields, statuses, and write authorization. Registration, transport discovery, running services, and installed-release acceptance are separate. Chat does not calculate authoritative totals or access SQLite.

### TimeKeeper queries Screenpipe

The implemented backend reader imports accessibility, OCR, and audio observations through bounded `/search` requests with `include_cloud=false`. One coordinator runs catch-up at startup, every five minutes, or through **Settings → Screenpipe → Sync now**. It requires existing sessions and protected-read configuration. It saves references, bounded text, and observed context; it does not create work duration or perform case inference. [API D11](API.md#d11-screenpipe-controls-in-settings) and [D13](API.md#d13-source-content-and-late-attachment) own these behaviors.

The separately configured JEV watcher reads screen context through Screenpipe MCP and submits guarded case transitions through TimeKeeper MCP. Its model calls are described in the [JEV guide](../integrations/screenpipe/jev-check/README.md). Backend source import and JEV detection have different responsibilities.

An immediate daemon-event bridge remains proposed. The [event contracts](#event-contracts) describe a transport without a verified capture producer. Implemented polling and catch-up do not establish immediate triggering or a latency guarantee.

Example provider request shape, not an executed request:

```http
GET /search?content_type=accessibility&start_time=<RFC3339>&end_time=<RFC3339>&limit=20&offset=0&include_cloud=false
```

Reads retrieve bounded pages for a fixed session window, deduplicate stable evidence identities, and persist progress with committed source records. Recovery revisits overlapping windows and older content versions for delayed indexing and missing excerpts. Truncation and failed reads preserve incomplete coverage. Filtering all retrieval to the current case would hide transitions.

Provider frame-context and screenshot endpoints remain possible enrichment mechanisms. The backend importer currently uses search results. It never opens Screenpipe's database. Tag write-back remains unimplemented under the [assignment synchronization design](ARCHITECTURE.md#screenpipe-assignment-synchronization).

## Event contracts

Internal capture triggers, SDK recorder events, daemon events, and pipe triggers are separate contracts. Capture reacting to operating-system activity does not establish an external subscription. No dedicated `tab_changed` or legal-case callback was verified. [Capture architecture](https://docs.screenpipe.com/architecture).

### Daemon transport and producer gap

The server registers `/ws/events` outside its generated OpenAPI routes. It forwards internal events as JSON with `name` and `data`. [Server routes](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/server.rs), [WebSocket handler](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/routes/websocket.rs).

```text
ws://localhost:3030/ws/events?images=false
```

Use the configured instance address and authentication. The proposed Screenpipe-side bridge must work independently of a stopped TimeKeeper backend. Keep credentials out of the interface and logs.

The query has no event-name filter. Filter messages in the bridge. `images=false` removes images from `ocr_result` and `ui_frame`, but remaining fields can contain sensitive data. The handler accepts application events. TimeKeeper must publish no application events. Protocol acknowledgements are separate.

Recognized event names do not establish a producer. The reviewed path from `event_driven_capture.rs` through `paired_capture.rs` to `insert_snapshot_frame_with_ocr` contains no matching publication or established post-persistence notification. Neither `ui_frame`, `ocr_result`, nor daemon-level `app_switched` is a verified capture trigger. [Capture engine](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/event_driven_capture.rs), [paired capture](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-capture/src/paired_capture.rs), [frame persistence](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-db/src/db/frames.rs).

If immediate triggering requires a new producer, it must notify after persistence and API availability. A proposed payload contains source identity, frame ID, capture timestamp, and schema version, without text or images. This requires separate authorized implementation and protected-read compatibility.

### Delivery and recovery

The in-memory broadcast bus has no durable cursor or replay. Slow or disconnected consumers can miss events. Recover through deduplicated memory API reads. [Event manager](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-events/src/events_manager.rs).

Protected reads reject `/ws/events` with nonretryable `503 privacy_surface_unavailable`. History-only mode returns `409 search_only` while background work is suspended. Show event mode as unavailable and use permitted memory reads. Do not disable protections or reconnect continuously. [Privacy middleware](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/routes/privacy_release.rs), [history-only middleware](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/search_only.rs).

The proposed bridge subscribes before catch-up, coalesces signals, and retrieves persisted observations. After reconnecting, it resumes from saved progress with overlap and retains low-frequency reconciliation. Empty reads receive bounded retries because indexing can lag. Unavailable evidence preserves the active case and marks retrieval incomplete. An identified unknown-folder transition follows the separate [unresolved-period rule](REQUIREMENTS.md#cases-and-work-periods).

Events wake retrieval. They prove neither case assignment nor continuous duration. Assignments use a separate verified command contract, and the [architecture](ARCHITECTURE.md#screenpipe-assignment-synchronization) owns write-back. The socket does not establish durable stopped-app command delivery.

### SDK recorder events

`@screenpipe/sdk/session` creates its own native `Recorder`. Its `app_switched` compares `appName`, `windowTitle`, and `browserUrl` every second by default. It misses content changes when those fields stay unchanged. `frames_progress` reports counts and elapsed time every five seconds by default, without a persisted frame ID or proof of `/search` availability. `paused` and `resumed` describe that recorder's filter state. [SDK session](https://github.com/screenpipe/screenpipe/blob/main/packages/sdk/session/index.js), [SDK types](https://github.com/screenpipe/screenpipe/blob/main/packages/sdk/session/index.d.ts).

These events do not subscribe to the existing desktop recorder. Do not add a second recorder or an independent screen or browser watcher.

### Pipe triggers and skills

The native pipe scheduler listens to meeting events, `workflow_event`, connection triggers, and pipe completion. It does not subscribe to `app_switch`, `app_switched`, or `window_focus`. Adding these names to `trigger.events` does not connect a producer. The reviewed code parses but does not evaluate natural-language `trigger.custom`. [Pipe configuration and scheduler](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-core/src/pipes/mod.rs).

Imported skills supply instructions to pipe and chat sessions, not listeners. A pipe can instruct its agent to use TimeKeeper, but that instruction supplies no trigger. [Skill importer](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/src-tauri/src/skills.rs).

A missing bridge must convert a verified signal into a supported workflow event or explicit `POST /pipes/{name}/run`. The latter adds an automation-control call beyond memory reads. Both options need implementation, deduplication, execution limits, and source verification. Filter signals before agent execution and use one assignment writer. App switches can retain a case, and folder changes can occur within one app. [Scheduled tasks](https://docs.screenpipe.com/scheduled-tasks).

### Release acceptance gate

Event mode remains proposed until these checks pass:

1. Pin the installed Screenpipe release and inspect its producer code.
2. Verify authenticated `/ws/events` access under intended privacy settings.
3. Observe messages after app, window, tab, URL, and same-tab content changes separately on macOS and Windows.
4. Confirm each observation becomes available through the memory API with stable identity and capture timestamp.
5. Measure event-to-memory delay and define bounded retries.
6. Verify reconnect, missed and duplicate events, paused capture, and protected-read rejection.
7. Confirm the subscriber creates no recorder and publishes no application events. Verify assignment delivery separately.

Polling remains a fallback and recovery path. It does not establish immediate triggering.

## Resolving the correct case

This detection algorithm is proposed. Folder identification and transition boundaries remain undefined.

1. Load a new recorded observation with source ID, timestamp, app, window, URL, and relevant text when present.
2. Compare the observation with the previous context. Ignore irrelevant cosmetic changes, but inspect changed text even when the URL and window title stay the same.
3. Retrieve candidates. A proposed match uses a case reference, document identifier, or configured URL/path association before a client name alone.
4. If one active case has an unambiguous identifying match with no conflicting evidence, assign that existing case automatically as an inference pending lawyer validation.
5. Otherwise, use JEV for semantic continuity and candidate selection.
6. Verify case existence, client relationship, eligibility, and observation identity before applying the result.
7. Apply transitions using capture timestamps and the [period protection rules](REQUIREMENTS.md#cases-and-work-periods). Preserve sibling periods, corrections, and validated periods. Flag proposed protected-period splits without counting replacement time.
8. Retain the active case for ordinary ambiguity. An unidentified new folder requires an unresolved period and a lawyer question. Apply the requirements' question, period, session, and assignment-revision guard. Closure and evidence imports preserve it. Delayed answers cannot change a newer active case. Never invent a case ID.

Evaluate deterministic matches against active content and conflicting references. Client names, sidebar references, and quoted documents can identify the wrong case.

Save explicit TimeKeeper selections as authoritative assignments without screen-based rediscovery. Exclude the review interface from classification, or distinguish historical review from new work, to prevent feedback loops.

## JEV's role

The active watcher sends a `Choice` question named `tab_change` with `yes`, `no`, and `uncertain` options. Only a sufficiently confident `yes` permits the next request. That request selects among aliased existing cases and an explicit unresolved option. Code maps the selected alias back to its original ID; the model does not create case identifiers. [Choice reference](https://docs.typesafe.ai/primitives/choice).

Before applying a result, the watcher checks whether the observed context remains current. The application then checks the original active-period and assignment-revision snapshot. Manual corrections and newer assignments remain authoritative. An uncertain response is not proof that the case changed.

The current tab-change request treats changed content within the same tab as no switch. It therefore does not satisfy the required case-change scenario driven only by same-tab content. Folder identification and representative transition acceptance remain open. The [requirements](REQUIREMENTS.md#acceptance-examples) define the target behavior.

The watcher uses `POST https://api.typesafe.ai/v1/systemone` with bounded structured state and only explicitly permitted fields. Selected recorded text leaves the device for TypeSafe's hosted API. Missing credentials or invalid permitted fields prevent inference. The [JEV guide](../integrations/screenpipe/jev-check/README.md) owns configuration, numeric defaults, request order, and verification limits. [TypeSafe API](https://docs.typesafe.ai/api).

Confidence thresholds need representative case changes, ambiguous names, and incomplete captures. A concentrated distribution is not proof of a correct assignment. [Confidence guidance](https://docs.typesafe.ai/confidence).

Retrospective history generation is a separate explicit workflow. It evaluates already imported evidence through `generate_history_proposals`, produces drafts, and requires lawyer-supplied worked duration before acceptance. It does not use the live watcher's tab-change gate or establish automatic duration derivation. [API D14](API.md#d14-history-proposals-and-explicit-acceptance) records this newly connected source path and pending runtime acceptance.

## Persistence requirements

Compare the implemented migrations with the [database design](DATABASE.md) before adding integration storage. Preserve:

- case-matching metadata, such as aliases and known document or URL associations, with explicit scope and precedence;
- source provenance sufficient for replay, including source type, instance/device identity where needed, recorded timestamp, and external record ID;
- assignment state separate from time validation, with method, selected case, candidate evidence, model version where applicable, and unresolved reason;
- retrieval progress and deduplication rules;
- a revision or equivalent stale-result guard so delayed inference cannot replace a newer manual assignment;
- independent period assignment so one correction does not change sibling periods.

Map evidence identities to canonical provider tag targets separately. All aliases for one target must agree. Verify resulting tags before marking synchronization complete and preserve unrelated tags. The [architecture](ARCHITECTURE.md#screenpipe-assignment-synchronization) owns target and delivery rules. Installed-release mapping remains unverified.

## Required acceptance checks

1. Two different tabs concern the same case: keep the case assignment.
2. Two cases belong to the same client: select the case reference, not only the client.
3. A case changes inside one tab without a URL change: use newly recorded content.
4. A detected new-folder transition has no reliable case match: keep its period unresolved and ask the lawyer. Ordinary ambiguous or background content does not clear the active case.
5. A lawyer manually changes the assignment before JEV responds: retain the manual correction.
6. Screenpipe capture is paused or indexing is delayed: display coverage uncertainty rather than inventing work time.
7. TimeKeeper restarts: replay API evidence without duplicating periods. Any change to effective case or duration clears time validation; identical replay preserves it. A proposed split of a corrected or validated period remains a review conflict.
8. Screenpipe chat asks about a period: return the same case ID and validation state as the interface.
9. The lawyer reviews an old case in TimeKeeper: do not count that display as new work on the old case by default.
10. All observations used for automatic assignment have Screenpipe API provenance. Assignment metadata is delivered separately to Screenpipe, with acknowledgement and revision checks; source recordings are not rewritten.
