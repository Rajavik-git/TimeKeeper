# Screenpipe integration and research

Source review date: 2026-10-18. This document describes the current branch and separates it from provider research and proposed behavior. No Screenpipe release is pinned. Installed-release, macOS, and Windows acceptance remain pending.

## Environment readiness and integration status

[Setup](SETUP.md#connect-screenpipe) covers the local service, URL, and protected-read token. `install.mjs` configures a missing API key through the installed CLI and checks public `GET /health`. It does not query protected recordings, install integrations, or start recording. `--check` never retrieves credentials or writes files. [MCP setup](../integrations/screenpipe/README.md) covers the separate chat connection, skill, manual pipes, and optional session link.

| Part                  | Current source behavior                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider reader       | Reads recorded focus and frame images through HTTP. No Screenpipe database access or additional recorder.                                          |
| Desk pill             | Uses recorded application and window metadata for deterministic case suggestions. High-confidence matches apply after 20 seconds.                  |
| Activity              | Retrieves frame metadata and screenshots for review on demand. Does not attach those previews to stored period evidence.                           |
| MCP                   | Eight tools for sessions, catalogue and period reads, guarded question answers, and link status.                                                   |
| Session link          | Optional health polling starts and ends linked sessions. Enabled by `npm run mcp:serve`.                                                           |
| Skill and pipes       | Chat instructions and manual Start/End workflows exist. Installation is separate.                                                                  |
| Remaining integration | JEV source integration and validation are pending. Durable import/catch-up, immediate event triggers, and verified tag write-back are absent here. |

These are source facts, not proof of a working installed provider workflow. [Architecture](ARCHITECTURE.md) owns component boundaries. [Requirements](REQUIREMENTS.md) owns business rules and unresolved decisions.

## TimeKeeper reads Screenpipe

The HTTP adapter in `src/backend/adapters/screenpipe/http.ts` uses `SCREENPIPE_URL`, then `SCREENPIPE_API_URL`, then `http://127.0.0.1:3030`. Protected requests use `SCREENPIPE_API_KEY`, falling back to `SCREENPIPE_API_KEY_FILE`. The backend never sends the token to the browser.

| Provider endpoint        | TimeKeeper use                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`            | Installer readiness and the optional MCP recording-session link. No token is sent.                                                                    |
| `GET /search`            | Sequential `input`, `accessibility`, and `ocr` reads for recent focus; paginated `ocr` reads for Activity frames. Requests set `include_cloud=false`. |
| `GET /frames/{frame_id}` | On-demand screenshot retrieval through the TimeKeeper API.                                                                                            |

The focus endpoint searches the previous two minutes and shares results for one second. The pill polls every two seconds without overlapping requests and requires two matching observations before using a changed context. The matcher receives the application name and window title. It does not classify full OCR text, audio, or typed input. The adapter can return a browser URL, but current recognition does not use it.

Activity reads up to 200 frames within the latest 24 hours of a period. A nearby frame can support its preview, but those reads do not establish complete evidence coverage or worked duration. They do not populate `sources` or advance persistent retrieval progress.

Provider authentication failures and unavailable reads have separate API states. The reader retries bounded busy responses. Delayed indexing, title ambiguity, missing fields, and same-window content changes remain acceptance risks. [API contracts](API.md#screenpipe-read-endpoints) define the local route limits.

Screenpipe documents its public health endpoint and protected bearer authentication in [installation and API readiness](https://docs.screenpipe.com/getting-started). Its [search reference](https://docs.screenpipe.com/api-reference/search/search-screen-and-audio-content) documents time bounds, content types, pagination, and local/cloud selection. Validate actual response fields against the installed release.

## Screenpipe calls TimeKeeper

The implemented path is `Screenpipe chat or manual pipe -> TimeKeeper MCP -> application API -> SQLite`. HTTP MCP binds to loopback, requires `TIMEKEEPER_MCP_TOKEN`, and serves `/mcp`. Read tools do not calculate summaries. Writes require an explicit request to start or end a session or answer a particular question.

The optional session link operates separately from chat tool calls. It polls public health every ten seconds, with a 60-second stop grace period by default. A connection failure can end a session after that grace period. The recorded boundary is the last observed running time, not a verified recorder event. See [link setup and behavior](../integrations/screenpipe/README.md#follow-screenpipe-recording).

The [Screenpipe changelog](https://docs.screenpipe.com/changelog) documents custom MCP connections. Exact transport compatibility, skill import, and pipe execution must still be checked against the selected release. Skills supply instructions; they do not register a connection or listen for events.

## Case assignment and duration limits

The pill uses deterministic matching, including configured recognition cues. A high-confidence suggestion can apply automatically; other suggestions require lawyer action. This is an implemented heuristic, not a complete folder-identification contract. Its current transition boundary uses the interface's observation time rather than the provider's capture timestamp.

An unknown case can remain unresolved with a period-bound question. Delayed answers must preserve newer assignments through the revision guards in [requirements](REQUIREMENTS.md#cases-and-work-periods). A manual correction takes precedence over later replay.

Screenshots prove observations, not continuous work. Duration derivation, gaps, overlap, and protected-period reconstruction approval remain open. Source review, time validation, and billing status stay separate. No screenshot count or session uptime establishes billable time.

## Event contracts

The following findings are retained from research on 2026-10-17 against public documentation and upstream `main`. They are not verified facts about a pinned installed release. Current TimeKeeper uses polling, not these proposed event connections.

- Internal capture triggers, SDK recorder events, daemon events, and pipe triggers are different contracts. No dedicated legal-case or browser-tab callback was verified.
- `/ws/events` provides a daemon event transport, but the reviewed capture path did not establish a reliable post-persistence producer. Recognized names such as `ui_frame` or `ocr_result` do not prove delivery after every capture.
- The event bus has no durable replay cursor. A proposed bridge would need overlap reads, deduplication, bounded retries for delayed indexing, and committed retrieval progress.
- The reviewed privacy and history-only middleware can reject event access. Do not disable protections to make a listener work.
- `@screenpipe/sdk/session` creates another recorder. It is not a subscription to the existing desktop recorder and is excluded from this design.
- A manual pipe or imported skill is not an app-switch listener. A trigger bridge remains separate work.

Research sources: [capture architecture](https://docs.screenpipe.com/architecture), [daemon WebSocket handler](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/routes/websocket.rs), [event manager](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-events/src/events_manager.rs), [SDK session](https://github.com/screenpipe/screenpipe/blob/main/packages/sdk/session/index.js), and [pipe scheduler](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-core/src/pipes/mod.rs). Upstream `main` can change; select and inspect a release before implementing an event contract.

## JEV validation and deferred tag synchronization

MCP, JEV, and Screenpipe skills are implemented with validation pending. The [integration tracker](FEATURES.md#implemented-integrations-awaiting-validation) records source availability and remaining integration work. Confirm the existing input allowlist, output contract, and thresholds before validation. Hosted inference sends approved data to an external provider. Do not describe it as local-only or enable it through setup.

Returning case associations through Screenpipe tags remains planned. Existing local target and delivery tables do not establish a writer. The [synchronization design](ARCHITECTURE.md#screenpipe-assignment-synchronization) requires canonical target identity, alias agreement, revision guards, preserved unrelated tags, and read-back verification.

## Required acceptance checks

1. Pin the Screenpipe release and verify protected search, response fields, and screenshot retrieval on macOS and Windows.
2. Test app, window, tab, URL, and same-window content changes separately. Confirm that background and ambiguous content do not cause an incorrect case switch.
3. Verify the pill's confirmation, automatic countdown, deferral, and stale-result behavior against manual corrections.
4. Test MCP authentication, read tools, explicit commands, delayed answers, and optional health-linked sessions separately.
5. Stop or disconnect Screenpipe and the TimeKeeper API independently. Verify reported state, session boundaries, retries, and restart behavior.
6. Keep missing media and incomplete coverage visible. Confirm that preview reads do not add counted time or duplicate evidence.
7. Verify durable command delivery, evidence recovery, event triggers, and tag writes only after their missing contracts and implementations exist.
