# Screenpipe integration research

Research date: 2026-10-17. This document separates documented provider capabilities from the proposed TimeKeeper design. Public documentation was reviewed; no personal recordings were accessed and no provider calls were executed against user data. A disabled, self-contained [pipe](ARCHITECTURE.md#jev-pipe-workflow) contains instructions for optional JEV requests. Prompt instructions do not establish working Screenpipe integration. Pin and test the installed Screenpipe release before connecting the workflow.

## Required outcome

The [Screenpipe interaction requirements](REQUIREMENTS.md#screenpipe-interaction) define the required outcome. The [architecture](ARCHITECTURE.md#components-and-flows) defines component ownership and the return path for assignments.

Screenpipe captures the visible context. TimeKeeper must resolve that context to its own case catalogue. An observed tab change does not by itself identify a legal case. A legal case can also change inside the same tab, and multiple tabs can belong to one case.

Here, "memory" means recorded activity accessible through Screenpipe's API. The specific `/memories` endpoint contains saved AI knowledge; it is not a complete stream of captured screen changes. Use recorded frames and text as primary evidence. [Screenpipe memories reference](https://docs.screenpipe.com/api-reference/memories/list-memories).

## Verified capabilities

| Capability | Documentation evidence | TimeKeeper use |
| --- | --- | --- |
| Capture changes in screen context | Screenpipe documents capture triggered by app switches, focus, interaction, and typing pauses, with accessibility text and OCR fallback. | Observe recorded context changes. This does not guarantee a public browser-tab-change event. |
| Read recorded activity | `GET /search` supports time bounds, pagination, content types, app/window/URL filters, and focus filtering. Frame results can include timestamp, frame ID, text, URL, and window metadata. | Retrieve new observations and compare them with previous observations. |
| Inspect a recorded frame | `GET /frames/{frame_id}/context` provides text, nodes, and extracted URLs. `GET /frames/{frame_id}` provides the recorded screenshot. | Enrich ambiguous observations and display evidence for review. |
| Let chat call an external MCP server | The changelog documents custom HTTP MCP connections with a name, URL, optional headers, connection testing, and enablement. | Connect Screenpipe chat to TimeKeeper's read-only tools. |
| SDK session events | Source confirms `app_switched` and `frames_progress` belong to a recorder created by the SDK session. | Not a drop-in subscription to the existing desktop recorder. See the event review. |
| Daemon event transport | Source registers `/ws/events`, forwarding the internal event bus. | Candidate trigger transport; relevant capture producers and release availability are not established. |

Sources: [capture architecture](https://docs.screenpipe.com/architecture), [search reference](https://docs.screenpipe.com/api-reference/search/search-screen-and-audio-content), [frame context](https://docs.screenpipe.com/api-reference/frames/get-frame-context), [frame image](https://docs.screenpipe.com/api-reference/frames/get-frame-by-id), and [Screenpipe changelog](https://docs.screenpipe.com/changelog).

The search reference and bundled skills can evolve at different speeds. Treat response fields as version-dependent and validate the actual returned content types. A field can be missing; a missing URL must not be interpreted as an unchanged case.

## Recommended two-way architecture

Use the [component and flow diagram](ARCHITECTURE.md#components-and-flows) for execution ownership. The sections below describe provider capabilities and proposed connection contracts.

### Screenpipe queries TimeKeeper

Register a TimeKeeper HTTP MCP server in Screenpipe's Connections settings. The exact transport implementation must be tested against the chosen release; the documented support for HTTP does not by itself prove every transport variant works.

Proposed tools, not existing Screenpipe APIs:

| Tool | Input | Result |
| --- | --- | --- |
| `find_cases` | Search text and optional client ID | Existing case IDs, references, titles, client IDs, and status. |
| `get_case` | Case ID | Current case metadata. |
| `get_period_context` | Period ID or source references | Stored assignment and evidence references. Inference stays in the Screenpipe workflow. |
| `list_time_entries` | Time bounds and optional case/client ID | Stored entry details with validation and billing states. |

These tools use the application API, never direct SQLite access. Chat can ask which case a recorded period belongs to and receive the actual `case_id`. Tool responses do not create or update Screenpipe memories. Instruction text alone does not register an MCP connection or implement a tool. Current source defines an importable skill as a folder containing `SKILL.md` with YAML `name` and `description`, then Markdown instructions. The current pipe includes its own instructions and does not require a separate skill import. The provider import format is verified in source, not in the installed app. [Official skill importer](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/src-tauri/src/skills.rs).

The [MCP boundary](ARCHITECTURE.md#mcp-and-jev-boundaries) separates read-only case queries from scoped workflow commands. The detection pipe sends a switch request only when evidence supports a switch and no unique existing destination matches. An identified case stays in the Screenpipe result with `applied: false`. The unresolved-switch tool and its schema do not exist yet. Answers to workflow questions remain bound to their target period and expected revision.

### TimeKeeper queries Screenpipe

The intended trigger path is a verified daemon event followed by a bounded `/search` read. The [event source review](SCREENPIPE_EVENTS.md) establishes the WebSocket transport but not a reliable frame producer in the current capture path. Until that release acceptance gate passes, bounded polling is the available fallback; it must not be presented as satisfying an immediate event-trigger requirement. Use a configurable base URL, time window, and the installed instance's authentication. Keep results local with the supported local-only search configuration, such as `include_cloud=false`. Read focused screen evidence when available. Do not filter retrieval to the current client, case, or application: that would hide transitions to another one.

Example request shape, not an executed request:

```http
GET /search?content_type=accessibility&start_time=<RFC3339>&end_time=<RFC3339>&limit=20&offset=0&include_cloud=false
```

Use OCR records when accessibility evidence is unavailable. Retrieve all pages for a fixed window, deduplicate by source type and stable record identity, then sort observations by capture timestamp. Persist retrieval progress only after processing and saving the records. Revisit an overlapping window for delayed indexing and reconcile older ranges after interruption. Window overlap and polling interval require measurement; no latency guarantee is established.

Read `/frames/{frame_id}/context` only when extra context is needed, and load the screenshot for review on demand. Do not access Screenpipe's database files directly. Evidence retrieval does not write to Screenpipe. A separate assignment adapter is required to return case metadata. The selected mechanism is TimeKeeper-owned source tags, detailed in the architecture; its runtime behavior remains unverified.

## Choosing a detection method

| Method | Assessment |
| --- | --- |
| Daemon `/ws/events`, then REST memory reads | Preferred trigger path if a relevant producer is verified in the selected release. Source confirms the transport, not the required capture notification. |
| Poll recorded memory through REST | Fallback and recovery path. Supports replay using the same evidence. Detection follows recording and indexing latency. |
| SDK session events | Not selected: the reviewed SDK creates its own recorder rather than subscribing to the existing desktop instance. |
| Run the self-contained TimeKeeper pipe | Supported event-triggered tasks exist, but the reviewed scheduler does not directly subscribe to app switching. A bridge or explicit execution is required; see the event review. Choose one assignment writer. |
| Add an independent screen or browser watcher | Outside the requested Screenpipe-memory-only evidence path. Not recommended for this design. |

The REST documentation index omits the daemon WebSocket route. Source inspection establishes `/ws/events`, but no dedicated `tab_changed` or legal-case-change callback was verified. See [event triggers](SCREENPIPE_EVENTS.md) for producer gaps, authentication, delivery limits, and privacy restrictions.

## Resolving the correct case

The following candidate-matching algorithm remains a proposal. Its reference and URL matching rules have not been validated. The selected handoff rule sends only unresolved switches to the application; it does not persist matched cases.

1. Load a new recorded observation with source ID, timestamp, app, window, URL, and relevant text when present.
2. Compare the observation with the previous context. Ignore irrelevant cosmetic changes, but inspect changed text even when the URL and window title stay the same.
3. Retrieve possible cases from TimeKeeper. Folder identification is deferred; the following is a candidate strategy, not an agreed rule. Match a case reference, a known document identifier, or a configured URL/path association before relying on a client name alone.
4. If one existing case has an unambiguous identifying match with no conflicting evidence, retain that case as the detected destination. Identification does not save an assignment.
5. Otherwise, if JEV is enabled, use it for semantic continuity and candidate selection. If JEV is disabled, follow the existing ambiguous-context and unknown-folder rules in step 8.
6. Verify that the selected case exists, belongs to the selected client, remains eligible, and still matches the observation being processed.
7. Only when a switch is supported but no unique destination matches, send a scoped unresolved-switch request through an available MCP tool. The [application flow](ARCHITECTURE.md#case-assignment-and-evidence-flow) owns any resulting write and its revision checks. Missing tools, incomplete lookups, and provider failures do not authorize a substitute write.
8. Apply the [case and work-period rules](REQUIREMENTS.md#cases-and-work-periods) for ambiguous content, unknown folders, and delayed answers. The precise transition boundary remains to be defined.

A client name is insufficient when that client has several cases. A case reference appearing in a sidebar or quoted document is not necessarily the active case. Candidate matching must consider the active content and conflicting references. Deterministic rules also need evaluation; they are not automatically reliable simply because they avoid an AI call.

A matched destination does not advance the authoritative active-case baseline. How to persist matched cases and avoid repeated detection of the same switch remains open. Use captured evidence timestamps for any proposed boundary, never model-response time.

For a case change selected directly in TimeKeeper, the application already knows the chosen ID. Save that explicit user action as the authoritative assignment. Do not ask Screenpipe to rediscover it from the screen. Screenpipe chat obtains the updated assignment through MCP. Exclude the TimeKeeper review interface from automatic classification, or otherwise distinguish reviewing old evidence from doing new case work, to prevent feedback loops.

## JEV's role

JEV is optional and used only by the Screenpipe workflow. The workflow skips JEV when the installed pipe's `.env` is absent. A present file must supply a nonempty key and permitted field selection. The [architecture](ARCHITECTURE.md#jev-configuration-and-data-boundary) defines this configuration boundary.

The pipe instructs Screenpipe's agent to compare an earlier observation associated with the authoritative active case and assignment revision against a newer observation. The request includes the current case and candidate descriptions. If a candidate search omits the current case, the agent must fetch and include it. A new folder context is not required before this comparison. An app or tab change alone does not prove a case change. See the [pipe workflow](ARCHITECTURE.md#jev-pipe-workflow).

JEV has no TimeKeeper workflow memory. The agent supplies the comparison context with every request. TypeSafe accepts structured `state`, and each question evaluates the same state independently. The pipe uses two `Choice` questions in one HTTP request. [State reference](https://docs.typesafe.ai/concepts/state), [Choice reference](https://docs.typesafe.ai/primitives/choice).

| Question | Options | Use |
| --- | --- | --- |
| `case_transition` | `same_case`, `case_switch`, `uncertain` | Assess whether the newer observation shows work on a different case. |
| `case_selection` | Existing candidate aliases and `unresolved` | Ask which existing case matches the newer observation if the case changed. Use this answer only when `case_transition` is `case_switch`. |

`same_case` returns `no_change`. `uncertain` leaves the active assignment unchanged without claiming continuity. Neither result sends a switch request. For a supported switch to a uniquely matched, distinct existing case, Screenpipe returns `identified` with `applied: false`. It does not send a write through MCP or the direct application API. A switch that selects the current case is conflicting evidence and remains uncertain.

Only a supported switch with no unique destination match qualifies for a scoped MCP unresolved-switch request. This includes an independently established unknown-folder switch, which bypasses JEV. The application remains the sole writer and must check the original target, assignment revision, question guard, and manual corrections before it changes a period or requests the lawyer's answer. No tool name or schema is implemented. If the tool is unavailable, report `blocked` with delivery `not_sent`.

If an active case exists but its previous evidence is unavailable, the pipe returns uncertainty without a model request. With no active case, it asks only for initial case selection and reports `transition: not_evaluated`; initial assignment does not send a switch request. Operational failures, incomplete candidate lookups, and malformed provider responses are not evidence of no match and must not trigger a fallback write. Folder identification and exact transition timestamps remain unverified.

The pipe sends only fields selected by `JEV_ALLOWED_FIELDS`, plus temporary candidate and client aliases. Comparing observations requires permitted content from both `previous_observation` and `observation`; historical fields need explicit permission. The target, baseline case, both source references and timestamps, and original expected revision stay local. The agent maps a selected alias to an existing case. These steps depend on the agent following the instructions; they are not enforced by code. JEV must not generate identifiers or create cases.

No confidence threshold has been calibrated. Automatic identification does not validate time or prove that the selected case is correct. Future thresholds require evaluation with representative case changes, ambiguous names, and incomplete captures. A concentrated model distribution is not proof of a correct assignment. [Confidence guidance](https://docs.typesafe.ai/confidence).

The documented HTTP endpoint is `POST https://api.typesafe.ai/v1/systemone`. The pipe directs the Screenpipe agent to use HTTP with selected text context. No SDK dependency or screenshot input is required. Hosted inference sends that context to TypeSafe. Define the permitted fields for each deployment before enabling requests. See the [data boundary](ARCHITECTURE.md#jev-configuration-and-data-boundary) and [TypeSafe API](https://docs.typesafe.ai/api).

Screenpipe documents agents that can call external APIs from `pipe.md`, with external credentials kept in a local `.env` file. This supports the selected pipe-only approach; it does not prove that the current TimeKeeper workflow runs in an installed release. [Screenpipe scheduled tasks](https://docs.screenpipe.com/scheduled-tasks).

## Persistence requirements

The [database design](DATABASE.md) now includes period assignment, source identity, revisions, retrieval progress, and command and delivery records. It is a documentation design, not an applied migration. Integration work must preserve:

- case-matching metadata, such as aliases and known document or URL associations, with explicit scope and precedence;
- source provenance sufficient for replay, including source type, instance/device identity where needed, recorded timestamp, and external record ID;
- assignment state separate from time validation, with method, selected case, candidate evidence, model version where applicable, and unresolved reason;
- retrieval progress and deduplication rules;
- the [revision guards and period constraints](DATABASE.md#work_periods) used by application services.

Map evidence identity separately to the canonical provider tag target before synchronization. All aliases for one target must agree on its assignment. See the [architecture](ARCHITECTURE.md#screenpipe-assignment-synchronization) for target ownership and delivery ordering. Recorded API capabilities do not establish that this mapping has been verified in the installed release.

## Required acceptance checks

Business acceptance examples are maintained in [REQUIREMENTS.md](REQUIREMENTS.md#acceptance-examples). Provider event checks are maintained in the [release acceptance gate](SCREENPIPE_EVENTS.md#release-acceptance-gate).

Evaluate the candidate-matching proposal with cases that share a client, same-tab content changes, and old-case review in TimeKeeper. These checks must establish whether the proposed identification and feedback-loop guards work; they do not define an accepted folder-identification algorithm.

Return to the [architecture](ARCHITECTURE.md) or [README](../README.md).

Product behavior and use cases are maintained in [REQUIREMENTS.md](REQUIREMENTS.md). Session lifecycle, stopped-app command handling, JEV ownership, and source-tag synchronization are defined in [ARCHITECTURE.md](ARCHITECTURE.md).
