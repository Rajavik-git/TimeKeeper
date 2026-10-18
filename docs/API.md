# TimeKeeper API and MCP contracts

The API binds to `127.0.0.1`, on port 8787 by default. React and MCP call application services through HTTP. They never open the business database. [OpenAPI](../src/contracts/openapi.yaml) owns request and response schemas; route handlers define the implemented behavior. Compatibility routes remain for older callers.

`npm run contract:gen` regenerates state values, frontend transport types, and request validators. Change their owning sources rather than generated output. [Architecture](ARCHITECTURE.md#implemented-modules) defines service ownership.

## Application API

All paths below use the `/api` prefix. `GET /health`, outside that prefix, reports API readiness with `status: "ok"`.

| Group          | Implemented paths and role                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue      | `/catalog`, `/cases/search`, and `/catalog/*` read or edit clients, cases, settings, categories, markers, and rules.                                                        |
| Sessions       | `/sessions`, `/sessions/active`, `/sessions/{id}` read session state. `/commands/start` and `/commands/end` apply explicit commands.                                        |
| Periods        | `/work-periods` and `/work-periods/{id}` provide records. Dedicated routes handle assignment, details, detected duration, overrides, time validation, and billing status.   |
| Workspace      | `/workspace` returns a scoped catalogue and detailed record snapshot. React calculates summaries.                                                                           |
| Questions      | `/questions` lists or creates questions; `/questions/answer` applies a guarded lawyer answer.                                                                               |
| Evidence       | `/sources`, source validation and availability routes, and `/sources/import` manage stored evidence. Screenpipe preview reads do not call the import route.                 |
| Reconstruction | `/reconstruction/propose` records a reconstruction attempt; `/reconstruction-conflicts` exposes protected conflicts. There is no apply/reject workflow for those conflicts. |
| Billing        | `/billing/state`, `/billing/expenses`, and `/invoices` manage billing details and frozen issued snapshots.                                                                  |
| Pill           | `/recognize`, `/periods/switch`, `/pill/decision`, and `/pill/undo` support deterministic suggestions and period changes.                                                   |

Writes preserve command identities and relevant period or assignment revisions. A stale reviewed snapshot must not overwrite newer work. Start replay returns the existing active session without resetting its boundary. Applied end replay preserves the original end boundary. Exact payload fields are in OpenAPI and the [core routes](../src/backend/api/core-routes.ts).

Application errors use `{ "error": "<code>", "message": "<description>" }`. HTTP 202 is not command completion. Session command responses use `status: "pending"`; application-error responses can use `error: "pending"`. Both indicate an unapplied prerequisite. Invalid requests use 400, missing records use 404, conflicts use 409, and unexpected failures use sanitized 500 responses.

## Screenpipe read endpoints

These routes proxy recorded observations through the backend. They do not expose the Screenpipe token, start recording, store preview evidence, or calculate worked duration.

| Method and path                              | Input and result                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/screenpipe/focus`                  | Reads the latest recorded app/window context from a two-minute window. Shares a result for one second.                                                       |
| `GET /api/screenpipe/frames`                 | Requires `start` and `end` timestamps with `start < end` and a range of at most 24 hours. `limit` defaults to 100 and accepts 1–200. Returns frame metadata. |
| `GET /api/screenpipe/frames/{frameId}/image` | Requires a numeric frame ID. Returns an image, 404 when missing, or 503 when provider access fails.                                                          |

Focus and frame-list responses use `status: "ok"`, `"unauthorized"`, or `"unavailable"`. An `ok` focus can be `null`. Clients must inspect the body status. Frame images use a private five-minute cache. [Screenpipe integration](SCREENPIPE_INTEGRATION.md) owns provider calls and their limits.

## MCP tools

HTTP MCP serves JSON-RPC on `POST http://127.0.0.1:3032/mcp` by default. Every request requires `Authorization: Bearer <TIMEKEEPER_MCP_TOKEN>`. A direct stdio invocation serves one local client without HTTP authentication. [Integration setup](../integrations/screenpipe/README.md) owns commands and configuration.

| Tool                     | Input                          | Behavior                                                                                                          |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `timekeeper_status`      | None                           | Reads API availability, active session, and open period.                                                          |
| `start_session`          | None                           | Explicitly starts or returns the active session. Only `started` and `already_active` establish a running session. |
| `end_session`            | None                           | Explicitly ends the active session. Only `ended` establishes completion; it does not stop Screenpipe.             |
| `list_cases`             | None                           | Reads active canonical cases and their client details.                                                            |
| `list_work_periods`      | Optional `sessionId`           | Reads the selected session's periods, assignments, revisions, and time-validation state.                          |
| `list_questions`         | Optional `sessionId`, `status` | Reads questions; status defaults to `pending`, with `answered`, `superseded`, and `all` also accepted.            |
| `answer_question`        | `questionId`, `caseId`         | Applies the lawyer's chosen existing case through revision guards. Only `answered` establishes completion.        |
| `screenpipe_link_status` | None                           | Reads persisted recording-session-link status and delivery state.                                                 |

Without `sessionId`, period and question reads select the active session, otherwise the most recent one. `pending`, `unconfirmed`, `timekeeper_not_running`, and `error` must not be reported as successful writes. A stale question is refused rather than silently retried.

The optional recording-session link is independent of explicit tool writes. `npm run mcp:serve` enables it. A direct HTTP command without `--screenpipe-link` does not. This server does not expose hosted JEV tools, history generation, billing totals, or tag synchronization tools. The existing JEV implementation and its pending validation are tracked in the [feature backlog](FEATURES.md#implemented-integrations-awaiting-validation).
