# TimeKeeper application API

> **Draft for review.** This document describes the existing API, reports the errors found in it, and lists what remains to build. It changes no code. The owners of the affected code decide whether and how to apply each fix.

## About this document

- **Baseline:** the API on `thejoyfulist/mvp` at commit `5ed3a04`. Line numbers in [Errors found](#errors-found) refer to that commit. `mvp` was merged again at `2747b4b`; routes added there are listed in [Current API](#current-api).
- **Authority:** this document owns how behavior is exposed through the API: routes, payload conventions, status codes, and errors. [Requirements](REQUIREMENTS.md) own business rules, [architecture](ARCHITECTURE.md) owns components, and [database design](DATABASE.md) owns storage. This document links to those rules instead of restating them.
- **Contract:** `src/contracts/openapi.yaml` is the machine-readable contract and must agree with this document. `npm run contract:gen` regenerates `src/contracts/generated.ts`.

| Label | Meaning |
| --- | --- |
| **Current** | What the code does at the baseline. |
| **Agreed** | Decided by the team or required by an agreed document. |
| **Proposed** | Suggested here, open for review. |
| **Open** | Depends on an undecided product or provider question. |

How to read the sections:

1. [Current API](#current-api) is the reference. Build against it.
2. [Errors found](#errors-found) lists defects, each with location, impact, and a suggested fix. They are reported only; the code owner evaluates and applies them.
3. [Missing endpoints and rules](#missing-endpoints-and-rules) lists the API work still to do.
4. [Possible later cleanups](#possible-later-cleanups) lists naming and style changes that are not defects.
5. [API decisions](#api-decisions) records the choices made by the API owner. Implement them as written.

## Current API

### Transport

| Topic | Current behavior |
| --- | --- |
| Server | Hono with `@hono/node-server`, started by `src/backend/api/index.ts`. In the installed Windows app, Tauri starts it as the `timekeeper-api` sidecar when the app opens and stops it when the app exits (`src-tauri/src/main.rs`, from `mvp` at `d335885`). In development the sidecar is not started; run `npm run dev:server`. |
| Address | `127.0.0.1` only, port `8787`, overridable with `TIMEKEEPER_PORT` in development. The installed app always uses `8787`. |
| Database | `TIMEKEEPER_DB`, default `data/timekeeper.db` in development. The installed app sets it to `timekeeper.db` in the app data folder: `%APPDATA%\com.timekeeper.desktop\` on Windows, `~/Library/Application Support/com.timekeeper.desktop/` on macOS. |
| Routes | Demo and mockup routes in `src/backend/api/app.ts`. Canonical session, period, question, source, and billing routes in `src/backend/api/core-routes.ts`, mounted under `/api`. |
| Browser origins | CORS allow-list in `app.ts`: Tauri origins and the Vite dev server (`127.0.0.1:5173`, `localhost:5173`). `UI_PORT` adds the dev server on another port (`127.0.0.1` and `localhost`), and `TIMEKEEPER_ALLOWED_ORIGINS` adds a comma-separated list, for example a shared preview (both from `mvp` at `d7ce0e0`). On Vercel (`VERCEL` set), the demo's own `https://<host>` origin is also allowed (`mvp` at `eded19c`). Other origins get `403 forbidden-origin`. Requests without an `Origin` header are allowed. |
| Bodies | JSON. |
| Authentication | None. Any local process can call the API. Kept as is for the hackathon ([D1](#d1-no-local-access-token-for-the-hackathon)). |
| Frontend client | `openapi-fetch` with generated types, in `src/frontend/api/client.ts`. |

### Conventions in use

| Topic | Current behavior |
| --- | --- |
| Canonical IDs | Opaque strings, at most 200 characters (sessions, work periods, questions, cases, clients). |
| Mockup IDs | Positive integers (firm, task, marker, expense, invoice, block, source detail). |
| Source identity | `instanceId` + `contentType` + `externalId`, in the URL path. |
| Timestamps | UTC ISO 8601 with `Z`, up to milliseconds. Other formats are rejected (`service.ts:12`). |
| Durations | Nonnegative integer milliseconds, `...Ms`. `null` means no value. |
| Money | Nonnegative integer cents, `...Cents`, with an ISO 4217 currency for rates. |
| Commands | `producerId`, `commandId`, `sessionId`, `occurredAt`, optional `prerequisiteCommandId`. A repeated command returns its first outcome. A reused `commandId` with a different payload is a `conflict`. A command waiting for its prerequisite returns `202` with `{"status":"pending","commandId":...}`. |
| Assignment guard | Assignment and question answers carry `expectedAssignmentRevision`; a mismatch is a `conflict`. A lawyer assignment wins over an automatic one. |
| Totals | The API returns precise values. React calculates combined totals and rounding (decision 5, agreed 2026-10-17). |
| Review states | Time validation, source validation and availability, and billing status are separate (decision 6, agreed 2026-10-17). |

### Errors in use

All routes return `{"error": code, "message": text}` through one handler (`src/backend/api/http.ts`). Clients branch on `error`; `message` is for people and must not be parsed.

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid-request` | 400 | Malformed JSON, or a missing or invalid field. |
| `not-found` | 404 | The target record does not exist. |
| `no-active-session` | 404 | A command needs an active or known session and there is none. |
| `conflict` | 409 | Stale revision, reused ID with a different payload, a state that forbids the action, something that must be set first, or a storage constraint. |
| `rule-not-decided` | 409 | The action depends on a product rule that is still open ([D4](#d4-error-codes-replacing-pending-for-refusals)). |
| `forbidden-origin` | 403 | Browser origin outside the CORS allow-list. |
| `internal` | 500 | Unexpected failure. Details are logged on the server only. |

`202` with `{"status":"pending", ...}` is a success: the request is stored and applied later. Only `POST /api/commands/start`, `POST /api/commands/end`, and `POST /api/questions` return it.

Before these fixes, core and demo routes used different status mappings; see [E3](#e3-two-error-handlers-with-different-status-mappings).

### Endpoints

Expected callers: `ui` (React), `workflow` (scoped MCP commands used by Screenpipe pipes), `chat` (read-only MCP tools used by Screenpipe chat), `demo` (demo only). Only React and the TimeKeeper MCP server call this HTTP API directly; see [D6](#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server).

#### Sessions and commands

| Method and path | Callers | Purpose | Responses declared |
| --- | --- | --- | --- |
| `GET /api/health` | launcher, ui | `{"status":"ok"}` once the API can receive requests ([A1](#missing-endpoints-and-rules)). | 200, 500 |
| `GET /api/sessions` | ui, chat | List sessions. | 200, 500 |
| `GET /api/sessions/active` | ui, chat, workflow | Active session or `null`. | 200, 500 |
| `GET /api/sessions/{id}` | ui, chat | One session. | 200, 400, 404, 500 |
| `POST /api/commands/start` | workflow | Start or return the active session. | 200, 202, 400, 404, 409, 500 |
| `POST /api/commands/end` | workflow | End the target session; keeps the first end boundary. | 200, 202, 400, 404, 409, 500 |

#### Work periods

| Method and path | Callers | Purpose | Responses declared |
| --- | --- | --- | --- |
| `GET /api/work-periods` | ui, chat | All periods, with derived `clientId`. | 200, 500 |
| `GET /api/work-periods/{id}` | ui, chat | One period, with derived `clientId` like the list. | 200, 400, 404, 500 |
| `GET /api/work-periods/{id}/sources` | ui, chat | Sources of one period. | 200, 400, 404, 500 |
| `POST /api/work-periods` | workflow | Record a detected case transition (`mode`: `current` or `recovery`). | 200, 202, 400, 404, 409, 500 |
| `POST /api/work-periods/manual` | ui | Create a manual period. | 200, 400, 404, 409, 500 |
| `PATCH /api/work-periods/{id}/details` | ui | Label, billable, non-billable reason, excluded. | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/{id}/assignment` | ui, workflow | Assign a case, guarded by `expectedAssignmentRevision`. | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/{id}/detected-duration` | workflow | Set the detected duration. | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/{id}/duration-override` | ui | Set or remove (`null`) the lawyer's duration. | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/{id}/validate-time` | ui | Validate the current effective time. Optional `expectedEffectiveRevision` ([A2](#missing-endpoints-and-rules)); `{"validated": false}` removes the validation ([D2](#d2-undo-a-validation-through-the-same-endpoint)). | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/validate-time` | ui | Validate several periods all or nothing ([A3](#missing-endpoints-and-rules)). Body `{"periods": [{"id", "expectedEffectiveRevision"?}]}`, 1 to 500, no duplicates; answers the validated periods in request order. | 200, 400, 404, 409, 500 |
| `POST /api/work-periods/{id}/billing-status` | ui | `billed` or `unbilled`. | 200, 400, 404, 409, 500 |

#### Questions, sources, and coverage

| Method and path | Callers | Purpose | Responses declared |
| --- | --- | --- | --- |
| `GET /api/questions` | ui, chat | All questions. | 200, 500 |
| `POST /api/questions` | workflow | Ask about an unresolved period. Returns `202` pending. | 202, 400, 404, 409, 500 |
| `POST /api/questions/answer` | ui, workflow | Answer, guarded by question, session, period, and revision. | 200, 400, 404, 409, 500 |
| `GET /api/sources` | ui, chat | All canonical sources. | 200, 500 |
| `POST /api/sources` | workflow | Import evidence references ([A12](#why-a12-and-a13-were-added)): one object or an array of 1 to 500, all or nothing. Answers `{id, status}` per source (`imported` or `unchanged`), in input order, as an object or an array like the request. | 200, 400, 404, 409, 500 |
| `POST /api/sources/{instanceId}/{contentType}/{externalId}/validate` | ui | Validate one source. | 200, 400, 404, 409, 500 |
| `POST /api/sources/{instanceId}/{contentType}/{externalId}/availability` | workflow | `available` or `unavailable`. | 200, 400, 404, 409, 500 |
| `GET /api/coverage-gaps` | ui, chat | Missing recording coverage. | 200, 500 |

#### Billing

Billing extensions are in scope by decision 1 (agreed 2026-10-17). [Requirements](REQUIREMENTS.md) are not yet updated for them.

| Method and path | Callers | Purpose |
| --- | --- | --- |
| `GET /api/billing/state` | ui | Billing data for React calculations. |
| `POST /api/billing/expenses` | ui | Add an expense or disbursement. |
| `DELETE /api/billing/expenses/{id}` | ui | Remove an expense. |
| `POST /api/invoices` | ui | Issue an invoice from a React-calculated snapshot; lines are frozen. |
| `GET /api/invoices/{id}/csv` | ui | Invoice export, returned as `{"csv": "..."}`. |
| `POST /api/client-rules`, `DELETE /api/client-rules/{id}` | ui | Client billing rules. |

#### Clients, cases, and settings

Canonical reads ([A13](#why-a12-and-a13-were-added)). String IDs, camelCase fields. These are the lists to build on; the demo `GET /api/state` and `GET /api/cases/search` return mockup records.

| Method and path | Callers | Purpose | Responses declared |
| --- | --- | --- | --- |
| `GET /api/clients` | ui, workflow, chat | All clients, ordered by name. Fields: `id`, `name`, `code`, `type`, `mode`, `hourlyRateCents` (`null` = no own rate), `vatApplicable`, `active`. | 200, 500 |
| `GET /api/cases` | ui, workflow, chat | All cases, ordered by reference; optional filters `clientId` and `status` (`active` or `archived`; any other value is `400`). Fields: `id`, `clientId`, `clientName`, `reference`, `title`, `category`, `caseNumber`, `opposingParty`, `status`, `mode`, `hourlyRateCents` (`null` = client or global rate applies), `flatFeeCents`, `budgetCents`, `openedOn`. This is the candidate list for assignment and JEV: the workflow calls `GET /api/cases?status=active`. `clientName` was added (2026-10-17) because the JEV watcher on `feat/screenpipe-start-session` uses it for case matching, so that branch needs no route of its own. | 200, 400, 500 |
| `GET /api/settings` | ui, workflow, chat | `globalHourlyRateCents`, `currency`, `workspaceId`, `vatRate`, `confidenceThreshold`. `404` when settings are not configured yet. | 200, 404, 500 |

#### Configuration and recognition (mockup routes)

| Method and path | Callers | Purpose |
| --- | --- | --- |
| `POST /api/clients`, `PATCH /api/client/{id}` | ui | Create and edit clients. |
| `POST /api/matters`, `PATCH /api/matter/{id}` | ui | Create and edit cases. The server generates the `YYYY-NNN-CODE` reference. |
| `POST /api/tasks`, `PATCH /api/task/{id}` | ui | Task types. |
| `PATCH /api/firm/{id}`, `PATCH /api/setting/{id}` | ui | Firm details and settings. |
| `POST /api/markers`, `DELETE /api/markers/{id}` | ui | Recognition markers. |
| `GET /api/blocks/{id}/recognition` | ui | Ranked case candidates for a block. |
| `GET /api/cases/search?query=` | ui | Search clients and cases by name, title, reference, category, or opposing party. Returns demo records with integer IDs; it is not the canonical case list ([A13](#why-a12-and-a13-were-added)). Added on `mvp` at `2747b4b`. |
| `POST /api/cases/{id}/source-pack` | ui | Export a source pack for an invoice, case, period, or chosen periods. Added on `mvp` at `2747b4b`. |

#### Demo routes

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | Whole demo state in one response. |
| `POST /api/demo/reset` | Reset the demo database. |
| `PATCH /api/time-entries/{id}` | Edit a demo time entry. |
| `POST /api/time-entries/manual` | Add a manual demo entry. |
| `POST /api/time-entries/{id}/discard` | Exclude an entry. |
| `POST /api/blocks/{id}/recover` | Restore an excluded block. |
| `POST /api/blocks/{id}/close` | Close a block. |
| `POST /api/day/approve`, `POST /api/matters/{id}/approve` | Approve a day or a case. |
| `GET /api/sources/{id}`, `POST /api/sources/{id}/export` | Demo source detail and source pack export. |
| `POST /api/pauses`, `PATCH /api/pauses/{id}` | Pauses. Not in the requirements. |

## Errors found

Each entry gives the location, what goes wrong, why it matters, and a suggested fix. Severity: **High** gives users or callers a wrong result; **Medium** breaks the contract or a project rule; **Low** is a consistency or maintenance risk.

### E1. Undecided rules are returned as successful `202 pending`

- **Severity:** High.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `src/backend/application/service.ts` lines 140, 201, 257, 265, 312, 320, 364 throw `AppError('pending', ...)` for cases such as "billed-period edit policy is open", "global hourly rate is not configured", and "case and effective duration are required before time validation". `core-routes.ts:29` maps `pending` to `202`.
- **What goes wrong:** `202` is a success status. `openapi-fetch` puts 2xx bodies in `data`, so the interface treats a refused action as accepted. Nothing was changed and nothing will be applied later.
- **Why it matters:** [AGENTS.md](../AGENTS.md) requires the API to distinguish pending receipt from completed application and never to claim success that did not happen. `pending` should only mean "stored and will be applied", as for commands waiting for a prerequisite.
- **Fix:** follow [D4](#d4-error-codes-replacing-pending-for-refusals). Keep `202 pending` for commands and questions only.

### E2. The contract's error schema rejects the `message` field

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `components.schemas.Error` in `src/contracts/openapi.yaml` has only `error` and `additionalProperties: false`. The core routes send `{error, message}`.
- **What goes wrong:** every core error response violates the contract, and the generated `Error` type has no `message`.
- **Suggested fix:** add `message` (string) to `Error`, and restrict `error` to the list of codes.

### E3. Two error handlers with different status mappings

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `app.ts:34-37` and `core-routes.ts:27-32`.
- **What goes wrong:** the same error code gets a different status depending on the route: `no-active-session` is 404 or 400, `pending` is 202 or 400, and unexpected errors are 500 or 400 (see [Errors in use](#errors-in-use)).
- **Suggested fix:** one error handler for the whole app, shared by both route groups.

### E4. Mockup routes expose raw exception messages and report server faults as `400`

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `app.ts:37` returns `{error: error.message}` with `400` for any non-`AppError`.
- **What goes wrong:** internal messages (SQLite errors, stack-derived text) reach the client, and server bugs look like client mistakes. The `error` field holds free text instead of a code.
- **Why it matters:** [AGENTS.md](../AGENTS.md) asks to keep captured client information out of logs and examples; raw storage errors can include stored values.
- **Suggested fix:** map unknown errors to `500 {"error":"internal"}` and log the detail on the server only.

### E5. Invalid JSON returns `500` on core routes

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `core-routes.ts:21`. `c.req.json()` throws a `SyntaxError` on a malformed body, which the handler at `core-routes.ts:32` reports as `500 internal`.
- **Suggested fix:** catch the parse failure and return `400 invalid-request`.

### E6. Routes served but missing from the contract

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`. The four routes are in the contract with fixtures in `tests/integration/contract.test.ts`; `GET /api/work-periods/{id}` now also returns `clientId`.
- **Where:** `core-routes.ts:36`, `38`, `39`, `65`.
- **Routes:** `GET /api/sessions/{id}`, `GET /api/work-periods/{id}`, `GET /api/work-periods/{id}/sources`, `POST /api/work-periods`.
- **What goes wrong:** generated types and contract tests do not cover them, so the frontend and MCP cannot call them in a typed way.
- **Suggested fix:** add them to `openapi.yaml`, or remove them if they are not meant to be public.

### E7. Possible responses are not declared in the contract

- **Severity:** Medium.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `openapi.yaml`.
- **What goes wrong:** core read endpoints declare only `200` although they can return `404` or `500`. Core write endpoints do not declare `404`, although missing periods, cases, and sessions return it; commands can return `404 no-active-session`. `POST /api/work-periods/{id}/billing-status` and others can also return `500`.
- **Suggested fix:** declare `404` and `500` with the `Error` schema wherever they can occur.

### E8. Every SQLite error is reported as a conflict

- **Severity:** Low.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `core-routes.ts:30-31` maps any `ERR_SQLITE_ERROR` to `409 storage constraint conflict`.
- **What goes wrong:** a locked database, a disk error, or a schema problem is reported as a client-side conflict, so callers may retry or show the wrong message.
- **Suggested fix:** map only constraint violations to `409`; report other storage errors as `500 internal`. Prefer detecting the rule in the service so the message is meaningful.

### E9. Two routes for expenses

- **Severity:** Low.
- **Status:** Fixed on `mprifti42tech/api`. The interface only called `/api/billing/expenses`, so the demo `/api/expenses` routes were removed, with their now-unused demo service methods (`addExpense`, `removeExpense`) and port helpers. Expenses added through the billing route are not written to the demo `expense` table or the audit log; the interface already used that route.
- **Where:** `app.ts:53-54` (`/api/expenses`, through the demo service) and `core-routes.ts:44-50` (`/api/billing/expenses`, through the invoice service).
- **What goes wrong:** two write paths for the same data can diverge in validation and behavior.
- **Suggested fix:** keep one route and one service, and point the interface at it.

### E10. A second server with its own routes

- **Severity:** Low.
- **Where:** `src/backend/api/core-server.ts` (118 lines), a separate `node:http` server with different paths (`/health`, `/sessions/{id}/periods`, `/periods/{id}`, `/cases/{id}/rate`). It is used only by `tests/integration/core-api.test.ts`.
- **What goes wrong:** those integration tests do not exercise the routes the application actually serves, so a broken Hono route can pass them.
- **Suggested fix:** test through the Hono app (`createApp(db).request(...)`) and remove `core-server.ts`.
- **Status:** Fixed on `mprifti42tech/api`. `core-server.ts` and `tests/integration/core-api.test.ts` are removed. Its tests now run on the real API: session commands in `tests/integration/commands-api.test.ts`; client and case creation, the global rate, duplicate and missing-client errors, and the CORS preflight in `tests/integration/catalog-writes.test.ts` ([A5](#missing-endpoints-and-rules)).

### E11. Hand-written contract types duplicate generated ones

- **Severity:** Low.
- **Status:** Fixed on `mprifti42tech/api`. `src/contracts/index.ts` keeps its exports, so no import changed, but every type is now derived from `generated.ts`: `ApiError` and `ErrorCode` from `Error`, `StartCommand`, `EndCommand`, and `QuestionAnswer` from their route request bodies, `CommandOutcome` from its schema, and `PeriodView` from `WorkPeriod` without `clientId`. To keep the precision the hand-written types had, the contract now gives `WorkPeriod.billingStatus` the values `unbilled` and `billed`, and describes `CommandOutcome` as exactly two shapes: `applied` (`sessionId`, `startedAt`, `endedAt`) or `pending` (`commandId`). The JSON on the wire is unchanged.
- **Where:** `src/contracts/index.ts` defines `ErrorCode`, `ApiError`, `StartCommand`, `PeriodView`, and others next to `generated.ts`.
- **What goes wrong:** the two sets can drift. `ApiError` already includes `message`, while the generated `Error` type does not ([E2](#e2-the-contracts-error-schema-rejects-the-message-field)).
- **Suggested fix:** derive shared types from `generated.ts`, or generate them from the same schema.

### E12. The origin check uses a different error shape

- **Severity:** Low.
- **Status:** Fixed on `mprifti42tech/api`.
- **Where:** `app.ts:31` returns `{"error":"Origin not allowed"}`.
- **Suggested fix:** use the common shape, for example `{"error":"forbidden-origin","message":"origin not allowed"}`.

## Missing endpoints and rules

API work still to do, owned by the API branch. **Proposed** unless marked otherwise.

| ID | Item | Notes |
| --- | --- | --- |
| A1 | `GET /api/health` returning `{"status":"ok"}`. | **Done.** Lets the launcher and Tauri detect API readiness. When D8 synchronization is built, it must finish before this route answers. |
| A2 | Revision guard on `validate-time` and `duration-override`: an `expectedEffectiveRevision` field, with `409` on mismatch. | **Done.** Prevents validating or overriding a period that changed after the lawyer saw it. The field is **optional** so the current interface, which sends `{}`, keeps working; the guard only protects calls that send it. **For the interface:** send the `effectiveRevision` of the period on screen in `PreInvoices.tsx`, `Cases.tsx`, and `MyDay.tsx`. |
| A3 | Bulk validation: `POST /api/work-periods/validate-time` with a list of `{id, expectedEffectiveRevision}`, all or nothing. | **Done.** Canonical replacement for the demo "approve day" and "approve case" routes. If one period cannot be validated, none is, and that period's error is returned. **For the interface:** `MyDay.tsx` currently validates one request per period and accepts partial success ("x of y validated"); switching to this route makes the result all or nothing. |
| A4 | Filters on list endpoints. | **Done.** All optional query parameters; dates are `YYYY-MM-DD` and compare the start day. `GET /api/work-periods`: `date`, `from`, `to`, `clientId`, `caseId`, `sessionId`. `GET /api/sources`: `periodId`. `GET /api/coverage-gaps`: `date`, `from`, `to`, `sessionId`. `GET /api/questions`: `date`, `status` (`pending`, `answered`, `superseded`; other values are `400`), `sessionId`. The `date` filters and the first five work-period filters came from `mvp` (`2747b4b`). |
| A5 | Writes for clients, cases, and settings. | **Decided (2026-10-17): use the existing routes**; no new write endpoints. Create and edit through `POST /api/clients`, `PATCH /api/client/{id}`, `POST /api/matters`, `PATCH /api/matter/{id}`, `PATCH /api/firm/{id}` (global hourly rate as `base_rate_cents`), and `PATCH /api/setting/{id}`. These go through application services and keep the canonical records that `GET /api/clients`, `/api/cases`, and `/api/settings` return in sync. **Why:** only the lawyer creates clients and cases, through the interface that already uses these routes; the workflow and JEV must never create a case ([requirements](REQUIREMENTS.md#sessions-and-desktop-lifecycle)); and a second set of write routes would duplicate behavior, as [E9](#e9-two-routes-for-expenses) did for expenses. Covered by `tests/integration/catalog-writes.test.ts` and `catalog-sync.test.ts`. Plural and English path names remain later cleanups ([C1, C2](#possible-later-cleanups)). |
| A6 | Reconstruction conflict endpoints: list and resolve. | **Deferred (2026-10-18): decided at the end, once the team agrees on the minimal version below.** **Open, reduced by [D9](#d9-only-past-days-can-be-validated).** Conflicts are stored, but the lawyer's resolution action is undefined ([design review](DESIGN_REVIEW.md)). With D9, today's periods are never validated, so conflicts remain only for periods the lawyer **corrected** during the day, or for rare very late evidence. Two gaps if it is built: the stored conflict does not record the proposed case (only the time), and nothing marks a conflict `resolved`. Proposed minimal version: store the proposed case, `GET /api/reconstruction-conflicts`, and `POST /api/reconstruction-conflicts/{id}/dismiss`; splitting stays out until billed-period editing (README decision 8) is agreed. |
| A7 | Read-only chat tools use existing read endpoints. | **Decided**, see [D3](#d3-read-only-chat-uses-existing-read-endpoints). Needs the A4 filters. |
| A8 | No local access control for the hackathon. | **Decided**, see [D1](#d1-no-local-access-token-for-the-hackathon). |
| A9 | Command delivery while TimeKeeper is closed. | **Done on the TimeKeeper side**, see [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder) "8. Status", including catching up missed recordings and the failed-command routes ([A14](#a14-failed-inbox-commands)). Still missing: the pipe's fallback write (Rajavik-git) and the failed-command screen (interface). |
| A10 | Undo time and source validation with `{"validated": false}`. | **Done**, as decided in [D2](#d2-undo-a-validation-through-the-same-endpoint). |
| A11 | Replace `pending` refusals with `rule-not-decided` and `conflict`. | **Decided**, see [D4](#d4-error-codes-replacing-pending-for-refusals). Fixes [E1](#e1-undecided-rules-are-returned-as-successful-202-pending). |
| A12 | `POST /api/sources`: import evidence references from Screenpipe. | **Done.** See [Why A12 and A13 were added](#why-a12-and-a13-were-added). |
| A13 | Canonical reads: `GET /api/clients`, `GET /api/cases` (filters `clientId`, `status`), `GET /api/settings`. | **Done.** See [Why A12 and A13 were added](#why-a12-and-a13-were-added) and [Clients, cases, and settings](#clients-cases-and-settings). Complements the writes in A5. |
| A14 | Show the lawyer the inbox commands that could not be applied. | **API done; interface proposed.** See [A14. Failed inbox commands](#a14-failed-inbox-commands). |

### A14. Failed inbox commands

**Problem.** When TimeKeeper reopens, it applies the start and end commands left in the inbox ([D8](#d8-synchronization-at-startup-through-a-local-inbox-folder)). A command that is refused (for example an end for an unknown session, or an end whose time is before its start) moves to `inbox/failed/` with its error. Today nobody sees it: the lawyer believes the session ended, while TimeKeeper still shows it as active, and the day's time is wrong.

**API (built on `mprifti42tech/api`, 2026-10-17; in the contract as `FailedInboxCommand`).** The interface can call these now:

- `GET /api/inbox/failed` returns one entry per failed file, newest first:

  ```json
  [{
    "file": "end-2026-10-17-1800-a1b2.json",
    "kind": "end",
    "sessionId": "session-2026-10-17",
    "occurredAt": "2026-10-17T18:00:00.000Z",
    "error": "conflict",
    "message": "end before start"
  }]
  ```

  `kind`, `sessionId`, and `occurredAt` are `null` when the file was not valid JSON.
- `POST /api/inbox/failed/{file}/dismiss` moves the file to `inbox/dismissed/` once the lawyer has dealt with it, so it stops showing. Idempotent; `404` for an unknown file.
- Callers: `ui` only. Files hold only IDs and times, never client information.
- As built: `{file}` must be a single `<name>.json` (letters, digits, `.`, `_`, `-`); anything else, including paths with `..` and the `.error.json` files, is `400`. An entry whose error file is missing reports `error: "internal"`. Order is by the time the file moved to `failed/`, newest first. Code: `src/backend/application/inbox.ts`, `src/backend/adapters/inbox/folder.ts`; tests: `tests/integration/inbox-failed-api.test.ts`.

**Interface proposal (for the interface owner):**

- On startup, and when the session indicator is shown, call `GET /api/inbox/failed`. If it returns entries, show a notice on the Desk and in the pill, for example: "An End pressed on 17 Oct at 18:00 could not be applied: end before start."
- Offer two actions per entry:
  - **Fix**: open the session in My day so the lawyer can end it or correct the period, then dismiss the entry.
  - **Dismiss**: call the dismiss route when nothing needs fixing.
- Show nothing when the list is empty. The notice must not block other work.

### Why A12 and A13 were added

Both were found by walking through the [requirements acceptance journey](REQUIREMENTS.md#first-complete-journey) (start, case A, unknown folder, case B, delayed answer, close, end, reopen, correct, validate, total) and checking that every step has an endpoint. These two steps had none.

**A12. `POST /api/sources` (caller: `workflow`)**

- **Gap:** `importSource` exists in `service.ts:330-346`, but no route calls it. Without it the Screenpipe workflow cannot attach evidence (screenshot, audio, or text references) to work periods, so the lawyer has nothing to review on the Source screen and source validation (D2) has nothing to validate.
- **Body:** `{ id, periodId | null, instanceId, contentType, externalId, recordedAt }`. `periodId` is `null` for evidence not yet tied to a period. Only references are stored; content stays in Screenpipe ([requirements](REQUIREMENTS.md#evidence-duration-and-rounding)).
- **Behavior already in the service:**
  - Idempotent on the provider identity `instanceId` + `contentType` + `externalId`: sending the same evidence again changes nothing (`200`).
  - The same identity with a different period or time returns `409 conflict`.
  - Evidence recorded outside its session or period returns `409 conflict`; an unknown period returns `404 not-found`.
- **Batch:** a workflow sends many references at once during recovery after reopening. Accept either one object or an array, applied all or nothing, so a partial import cannot leave a period half documented.
- **As built:** at most 500 sources per request; an empty array or more than 500 is `400`. Every field is required, with `periodId` explicitly `null` when unknown. The response is `{id, status}` per source, where `status` is `imported` or `unchanged` and `id` is the ID stored the first time, so a retry with a new `id` still points to the original record.

**A13. `GET /api/clients`, `GET /api/cases`, `GET /api/settings` (callers: `ui`, `workflow`, `chat`)**

- **Gap:** clients, cases, and settings can only be read through the demo route `GET /api/state`, which returns the whole demo database and which [C10](#possible-later-cleanups) plans to remove.
- **Who needs them:**
  - The workflow needs the list of existing cases so JEV chooses among real case IDs and never invents one ([architecture](ARCHITECTURE.md), [AGENTS.md](../AGENTS.md) rule 7).
  - Chat needs them to answer "which cases do I have?" ([D3](#d3-read-only-chat-uses-existing-read-endpoints)).
  - The interface needs them to stop depending on `GET /api/state`.
- **Responses:** canonical fields only, with string IDs; see [Clients, cases, and settings](#clients-cases-and-settings) for the exact fields.
- **Service:** read-only `listClients`, `listCases`, and `settings` methods on the repository port. No business rule changes.
- **Privacy:** cases include `opposingParty` and `caseNumber`, which are client information. The workflow decides what reaches hosted JEV through its own allow-list (`JEV_ALLOWED_FIELDS` in the JEV pipe); this API does not send anything to JEV.

## Possible later cleanups

These are naming and style changes, not defects. They can wait until the demo routes are retired. **Proposed.**

**Deferred (2026-10-18):** decided once the interface stops using the demo routes. Renaming earlier would break the screens that still call the current paths.

| ID | Current | Possible change | Reason |
| --- | --- | --- | --- |
| C1 | `/api/matters`, `/api/matter/{id}` | `/api/cases`, `/api/cases/{id}` | Requirements say "case". |
| C2 | `/api/client/{id}`, `/api/task/{id}`, `/api/firm/{id}`, `/api/setting/{id}` | Plural collections: `/api/clients/{id}`, `/api/task-types/{id}`, and one `GET`/`PATCH /api/settings`. | One naming rule for all routes. |
| C3 | `/api/time-entries/...`, `/api/blocks/...` | Canonical `/api/work-periods/...` routes. | Requirements say "work period". Remove when the interface no longer needs the demo routes. |
| C4 | `POST /api/sources/{instanceId}/{contentType}/{externalId}/validate` and `/availability` | `POST /api/sources/validate` and `/availability` with the identity in the body. | Provider IDs in URL paths need escaping. |
| C5 | `PATCH /api/work-periods/{id}/details` | `PATCH /api/work-periods/{id}` | Plain field edits on the resource itself. |
| C6 | `POST /api/questions/answer` | `POST /api/questions/{questionId}/answer` | The target question appears in the path like other actions. |
| C7 | `GET /api/invoices/{id}/csv` returning JSON `{csv}` | Return `text/csv` with a download file name. | Browsers and tools can save it directly. |
| C8 | `/api/billing/expenses` | `/api/expenses`, now that [E9](#e9-two-routes-for-expenses) left one route. | Shorter, matches other collections. |
| C9 | Integer IDs for mockup records | Opaque string IDs everywhere. Invoice numbers stay separate from IDs. | One ID convention. |
| C10 | `GET /api/state` | Remove once screens use resource reads. | One large response couples every screen to every table. |

## API decisions

Decided by the API owner (mprifti42tech) on 2026-10-17, kept simple for the hackathon. Implement them as written; change this section first if one needs to change.

### D1. No local access token for the hackathon

- **Decision:** the API has no token or login. Protection relies on what exists: the server listens on `127.0.0.1` only, and browsers are limited by the CORS allow-list.
- **Accepted risk:** any program running on the lawyer's computer can call the API, including routes that claim `origin: "lawyer"`. This is acceptable for a local single-user demo. Screenpipe itself takes the opposite default and requires a token on its local API ([D5](#d5-calling-screenpipes-api-with-its-token)), which confirms this is a shortcut for the hackathon, not a design to keep.
- **How a token would be added later:** without changing any endpoint. The MCP server and React would send `Authorization: Bearer <token>` to this API, and Screenpipe would send a token to the MCP server through the optional headers of its HTTP MCP connection ([integration research](SCREENPIPE_INTEGRATION.md)). Because only those two callers reach the API ([D6](#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server)), the change stays small.
- **Revisit:** before any real use with client data, add a local token shared with the MCP server and workflows.
- **Scope:** D1 covers calls **into** TimeKeeper's API only. Calls **from** TimeKeeper to Screenpipe's API do need a token; see [D5](#d5-calling-screenpipes-api-with-its-token).

### D2. Undo a validation through the same endpoint

- **Decision:** the lawyer can undo a mistaken validation. No new endpoints:
  - `POST /api/work-periods/{id}/validate-time` accepts an optional body `{"validated": false}` to remove time validation.
  - `POST /api/sources/{instanceId}/{contentType}/{externalId}/validate` accepts the same optional body to remove source validation.
  - No body, or `{"validated": true}`, validates as today, so existing callers keep working.
- **Rules:** undoing is idempotent (undoing twice changes nothing more). Undoing time validation on a `billed` period is refused with `409 conflict`; mark it `unbilled` first. Undoing does not change the case, duration, or billing status.
- **As built:** `validate-time` accepts `{"validated": false, "expectedEffectiveRevision": n}`, with both fields optional; the source `validate` route accepts `{"validated": false}`. Any `validated` value other than `true` or `false` is `400`. Undoing an unvalidated period or source returns it unchanged without a new revision.
- **Why:** otherwise a validation clicked by mistake can only be undone by changing the time, which is not what the lawyer wants.

### D3. Read-only chat uses existing read endpoints

- **Decision:** the read-only MCP chat tools call only these general read endpoints, which the interface also uses. No chat-specific endpoints are added. All exist today except the client and case reads from [A13](#why-a12-and-a13-were-added).

  | Chat question | Endpoint |
  | --- | --- |
  | Is a session running? | `GET /api/sessions/active` |
  | Which sessions exist? | `GET /api/sessions`, `GET /api/sessions/{id}` |
  | Which clients and cases do I have? | `GET /api/clients`, `GET /api/cases` (added by [A13](#why-a12-and-a13-were-added)) |
  | What did I work on (by date or case)? | `GET /api/work-periods` with the [A4](#missing-endpoints-and-rules) filters `from`, `to`, `caseId` |
  | What evidence supports a period? | `GET /api/work-periods/{id}/sources` |
  | Which questions are waiting for me? | `GET /api/questions` with filter `status=pending` |
  | Where is recording missing? | `GET /api/coverage-gaps` |

- **Rules:** chat never writes and never calculates totals (chat-calculated summaries are deferred in the [requirements](REQUIREMENTS.md)). When the API is not running, the chat tool reports that TimeKeeper is unavailable and returns no data.

### D4. Error codes replacing `pending` for refusals

- **Decision:** `202 pending` means only "received, stored, and applied later". When the service refuses an action, it returns an error:

  | Situation | Code | HTTP |
  | --- | --- | --- |
  | The rule needed for the action is still undecided. | `rule-not-decided` | 409 |
  | Something must be set first (rate, case, duration). | `conflict` | 409 |

- **Mapping of the current `AppError('pending', ...)` calls** in `service.ts`:

  | Line | Message | New code |
  | --- | --- | --- |
  | 140 | global hourly rate is not configured | `conflict` |
  | 201, 257, 265 | billed-period edit policy is open | `rule-not-decided` |
  | 312 | case and effective duration are required before time validation | `conflict` |
  | 320 | issued invoice reversal is not defined | `rule-not-decided` |
  | 364 | automatic reconstruction rule is open | `rule-not-decided` |

- **Contract:** add `rule-not-decided` to the list of error codes in `openapi.yaml` and in the shared error type, and declare `409` on the affected endpoints.
- **Why:** one success code must never mean "refused". When a rule such as [decision 8](../README.md#decisions-to-make) is agreed, its `rule-not-decided` cases become ordinary `conflict` or success responses.

### D5. Calling Screenpipe's API with its token

This is about the **outgoing** calls TimeKeeper makes to Screenpipe (the Screenpipe adapter in `src/backend/adapters/screenpipe/`), not about TimeKeeper's own API. The adapter does not call Screenpipe yet; this records the rules to follow when it does.

- **Source evidence:** Screenpipe documentation read on 2026-10-17 ([getting started](https://docs.screenpipe.com/getting-started), [API recipes](https://docs.screenpipe.com/api-recipes), [pipe permissions](https://docs.screenpipe.com/pipe-permissions)). It has not been tested against an installed release. [Integration research](SCREENPIPE_INTEGRATION.md) owns provider evidence and already requires using "the installed instance's authentication".
- **What Screenpipe documents:**
  - The local API listens on `http://localhost:3030` by default.
  - API authentication is enabled by default in current versions (app setting **Require API Authentication**, under **Settings → Privacy → API security**). Protected routes such as `/search` need `Authorization: Bearer <token>`. `/health` needs no token.
  - The token is obtained with `npx -y screenpipe@latest auth token`; the documented environment variable is `SCREENPIPE_API_KEY`. Scripts calling the API directly also send `X-Screenpipe-Client: api`.
  - `401` or `403` usually means the token belongs to a different Screenpipe instance or data directory, or was rotated.
  - Restricted pipes receive their own temporary `sp_pipe_*` token from Screenpipe for their session. That token is for the pipe's calls to Screenpipe, not to TimeKeeper.
- **Decision (hackathon):**
  - The backend reads the base URL from `SCREENPIPE_URL` (default `http://localhost:3030`) and the token from `SCREENPIPE_API_KEY` at startup. The lawyer or the launcher sets them; TimeKeeper does not run the `auth token` command itself.
  - Every call except `/health` sends `Authorization: Bearer <token>` and `X-Screenpipe-Client: api`.
  - The token never leaves the backend: not in SQLite, settings, API responses, the OpenAPI contract, the frontend, logs, or error messages ([AGENTS.md](../AGENTS.md) rule 8 and working practices).
  - A missing token, or a `401`/`403` from Screenpipe, is reported as "Screenpipe authentication failed" and is not retried automatically, because retrying with the same token cannot succeed. Evidence already imported stays as it is.
  - Readiness: `GET /health` on Screenpipe confirms it is running; it does not prove the token works. Check the token with one small authenticated read before reporting Screenpipe as connected.
- **Revisit:** a settings screen to enter the token, and reading it from the operating system's credential store instead of an environment variable.
- **Status (2026-10-17): adapter built, not yet used, not tested against a real Screenpipe.**
  - `src/backend/adapters/screenpipe/http.ts` implements the `ScreenpipeMemory` port. `read(startAt, endAt)` calls `GET /search` for `accessibility` (returned as type `UI`), `ocr`, and `audio`, with `include_cloud=false`, reading every page (100 per page, at most 50 pages per kind), then removes duplicates and sorts by time.
  - Each result becomes a reference only: `instanceId` (from `SCREENPIPE_INSTANCE_ID`, default `local`), `contentType` (`accessibility`, `ocr`, `audio`), `externalId` (the UI `id`, OCR `frame_id`, or audio `chunk_id`), `recordedAt` normalized to UTC milliseconds, and `appName`, `windowName`, `url` when present. Screen text and transcriptions are not kept. Items without an ID or a valid time are skipped.
  - `health()` calls `GET /health` without the token; `verifyAccess()` makes one small authenticated search.
  - Errors: `ScreenpipeAuthError` for `401`/`403` ("Screenpipe authentication failed", never the token, no retry); `ScreenpipeUnavailableError` for timeouts (10 seconds), network failures, and other error statuses.
  - Tests: `tests/unit/screenpipe-http.test.ts` against a stand-in shaped like Screenpipe's documented response ([search reference](https://docs.screenpipe.com/api-reference/search/search-screen-and-audio-content)).
  - Used by the recording catch-up ([D8](#d8-synchronization-at-startup-through-a-local-inbox-folder) step 4). Checked end to end with the real API and a stand-in Screenpipe HTTP server (right and wrong token). Checking it against an installed Screenpipe is still required.

### D6. Screenpipe reaches the API through the TimeKeeper MCP server

- **Decision:** the HTTP API has two direct callers, both owned by TimeKeeper: the React interface and the TimeKeeper MCP server (`src/mcp/`). Screenpipe never calls the HTTP API itself:
  - Screenpipe pipes (the workflow) use the MCP server's scoped command tools: session commands, case transitions, evidence import ([A12](#why-a12-and-a13-were-added)), questions, and assignments.
  - Screenpipe chat uses the MCP server's read-only tools ([D3](#d3-read-only-chat-uses-existing-read-endpoints)).
  - The MCP server translates each tool call into one API request and returns the API result unchanged, including errors and `202 pending`.
- **Why:** this is the flow already agreed in the [architecture](ARCHITECTURE.md#case-assignment-and-evidence-flow) and the [integration research](SCREENPIPE_INTEGRATION.md). It keeps one place (the MCP server) that decides which tools are read-only and which may write, so the API endpoints themselves do not need to know who is calling. It also keeps the API address and any future token ([D1](#d1-no-local-access-token-for-the-hackathon)) out of Screenpipe pipe instructions.
- **Not verified:** Screenpipe documents custom HTTP MCP connections for chat. Whether a scheduled pipe can use the same MCP tools has not been tested, and the [pipe permissions](https://docs.screenpipe.com/pipe-permissions) page only describes rules for Screenpipe's own endpoints. Test this with the installed release before relying on it.
- **Fallback, if pipes cannot use MCP tools:** the pipe calls the same API endpoints over HTTP at `http://127.0.0.1:8787` (or `TIMEKEEPER_PORT`). Screenpipe documents that its pipe restrictions do not sandbox shell commands such as `curl`, and D1 means no token is needed. The rules stay the same: same endpoints, same idempotency, and the pipe must treat a refused connection as "TimeKeeper not running", never as success ([A9](#missing-endpoints-and-rules)).

### D7. The lawyer starts and ends a session with a button in Screenpipe

Since 2026-10-18 the session also follows Screenpipe's recording session; the heading and anchor are kept for existing links.

- **Decision (updated 2026-10-18):** the session follows Screenpipe's recording session, and the lawyer can still press a button in Screenpipe to start a session and another to end it ([requirements](REQUIREMENTS.md#sessions-and-desktop-lifecycle)). Closing or opening TimeKeeper still never starts or ends a session. The team may move the buttons into TimeKeeper later; the API stays the same either way, because all paths call the same endpoints.
- **Flow:** button → Screenpipe pipe run manually → TimeKeeper MCP tools `start_session` / `end_session` ([D6](#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server)) → `POST /api/commands/start` / `POST /api/commands/end`.
- **Screenpipe session link:** [`src/mcp/screenpipe-link.ts`](../src/mcp/screenpipe-link.ts) runs inside the TimeKeeper MCP HTTP server when it is started with `--screenpipe-link` (`bun src/mcp/server.ts --http 3032 --screenpipe-link`). Every 10 seconds it reads Screenpipe's `GET /health`, which needs no key. Screenpipe counts as running while it answers and `capture_status.status` is not `stopped`, so pauses do not end the session.
  - A new Screenpipe run (`startup.engine_started_at`) runs the `start_session` logic once, with `producerId` `screenpipe-session-link`. It does nothing when a session is active and starts tab detection. After the End button, the link does not start another session until Screenpipe's next run.
  - Screenpipe unreachable for `TIMEKEEPER_LINK_GRACE_SECONDS` (default 60) runs the `end_session` logic at the last time Screenpipe was seen running, never before the session or open period started. A session that started after that time (for example from the Start button) is kept.
  - The link keeps its last observation in `data/screenpipe-link.json`. After a reboot or any stop it did not see, the next Screenpipe run first ends the old session at its last running time, then starts a new one. Commands that TimeKeeper cannot receive are retried every 10 seconds with the same boundary.
  - Limits: the link only acts while its process runs, and nothing starts that process at login yet. Unit tests cover the transitions with a fake API; the value `stopped` and a real stop from the Screenpipe app have not been observed yet.
- **Command fields:** each press creates a new `commandId` and records `occurredAt` at the moment of the press. `producerId` identifies the pipe. The end command carries the start's `commandId` as `prerequisiteCommandId`, so an end that arrives first waits as `pending`.
- **What exists:** both endpoints, with idempotency, one active session, preserved end boundary, and prerequisite ordering, covered by tests.
- **Start and End buttons (implemented, run from installed Screenpipe pipes on Windows):**
  - MCP server [`src/mcp/server.ts`](../src/mcp/server.ts), dependency-free, over stdio or loopback HTTP (`--http`, default port 3032, path `/mcp`). Tools: `timekeeper_status` and `list_cases` (read-only), `start_session`, `end_session`, and `record_case_transition` ([D10](#d10-jev-confirmed-tab-changes-become-work-period-transitions)). For testing and questions from the Screenpipe chat: `list_work_periods`, `list_questions`, `tab_detection_status`, and `screenpipe_link_status` (read-only), and `answer_question`, the lawyer's answer to an unknown-folder question through `POST /api/questions/answer`. The [skill](../integrations/screenpipe/timekeeper/SKILL.md) describes them; installed as `~/.screenpipe/skills/timekeeper/SKILL.md`, Screenpipe copies it into each new chat and pipe run.
  - `start_session` checks `GET /api/health`, then `GET /api/sessions/active`. If a session is active it does nothing and returns `already_active`. Otherwise it sends `POST /api/commands/start` with a new `commandId` and `sessionId`, `producerId` `screenpipe-start-button`, and `occurredAt` set to the press time. A start that another caller won returns that session as `already_active`. This is up to three API requests, not one as D6 describes; each is an existing endpoint. Whenever a session is then running, it also starts tab detection ([architecture](ARCHITECTURE.md#start-and-end-buttons-and-tab-detection)).
  - `end_session` reads `GET /api/sessions/active` and sends `POST /api/commands/end` for that session, with `producerId` `screenpipe-end-button` and `occurredAt` set to the press time. The target session is already applied, so it sends no `prerequisiteCommandId`. No active session returns `no_active_session` and sends nothing. Tab detection stops by itself within 10 seconds.
  - If the API does not answer, both return `timekeeper_not_running` without changing anything. With `TIMEKEEPER_LAUNCH_COMMAND` set, start first runs that command and waits up to 60 seconds for `GET /api/health`; the press time remains the start boundary. A command whose answer is lost returns `unconfirmed`, never success.
  - Button pipes [`start-timekeeper`](../integrations/screenpipe/pipes/start-timekeeper/pipe.md) and [`end-timekeeper`](../integrations/screenpipe/pipes/end-timekeeper/pipe.md) (`schedule: manual`) and skill [`timekeeper`](../integrations/screenpipe/timekeeper/SKILL.md). If a pipe cannot reach MCP tools, it runs the same logic through [`src/mcp/start-session.ts`](../src/mcp/start-session.ts) or [`src/mcp/end-session.ts`](../src/mcp/end-session.ts), configured as `TIMEKEEPER_START_COMMAND` / `TIMEKEEPER_END_COMMAND` in the pipe's `.env` (D6 fallback).
  - Verified: unit tests, `tests/integration/mcp-workflow.test.ts` against the real application services, one full Windows loop with the Node API, Screenpipe, and JEV (see D9), and the installed pipes below. Not verified: macOS, and `TIMEKEEPER_LAUNCH_COMMAND` with the packaged app.
- **Installed in Screenpipe 2.7.109 on Windows (2026-10-17):** both pipes appear in the pipe list and run through the `.env` fallback (no TimeKeeper MCP connection registered). Verified from Screenpipe at 23:26–23:31: Start with a session active returned `already_active`; End ended it and the watcher stopped 10 seconds later; Start then started a new session and a watcher that kept running after the pipe run ended. Findings:
  - The pipe agent improvises how it reads `.env`. One run sourced it with bash and succeeded; another extracted the value with `cut`, kept the quotes, and failed. Each `pipe.md` therefore prescribes the exact line `. ./.env && eval "$TIMEKEEPER_START_COMMAND"` (or `_END_`), and the value is one single-quoted string with forward slashes (see each `.env.example`).
  - A pipe run kills its whole process tree when it ends, which killed the background tab-detection watcher. On Windows, `start_session` starts the watcher through `Win32_Process.Create`, outside that tree, and passes the API address as `--api`.
  - Pipes require a local workaround for a Screenpipe agent bug ([design review](DESIGN_REVIEW.md)).
  - Two runs, each the first after its `pipe.md` was replaced, timed out at 120 seconds with no output; the next runs succeeded. The cause is unknown.
- **TimeKeeper MCP connection in Screenpipe (Windows, 2026-10-18):** Screenpipe only connects to MCP servers over HTTP, so the server runs as `bun src/mcp/server.ts --http 3032`. It is registered as a custom MCP server, either from Connections → Custom MCP Server in the app, or with `PUT http://localhost:3030/mcp-servers/timekeeper` and body `{"name":"TimeKeeper","url":"http://127.0.0.1:3032/mcp","enabled":true}` (Screenpipe API key as Bearer token). The Start pipe then called `start_session` through `sp_mcp_call` instead of the `.env` fallback, and the watcher it started kept running. Nothing starts the HTTP server at login yet. While it is stopped, `pipe.md` directs the agent to the `.env` fallback; that case has not been run.
- **What is missing:**
  1. A Screenpipe release whose pipe agent works without the local workaround, and a way to start the TimeKeeper MCP HTTP server with TimeKeeper (or at login).
  2. A launch command for the packaged app (`integrations/screenpipe/launcher/`); today it is a configurable shell command. Opening the installed app also starts the API (Tauri sidecar), so the launcher only needs to open the app.
  3. Pressing end while TimeKeeper is closed: the TimeKeeper side of [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder) is built (the inbox is applied at startup and every 30 seconds), but `end_session` does not write the inbox file yet. Until it does, it reports `timekeeper_not_running` and the session stays active.

### D8. Synchronization at startup through a local inbox folder

Solves "end while TimeKeeper is closed" (README decision 4, [design review](DESIGN_REVIEW.md) critical item). It follows the option proposed in the [README](../README.md#decisions-to-make).

**Problem:** the lawyer presses start at 09:00, closes TimeKeeper at 12:00 (the session stays active), and presses end at 18:00. TimeKeeper's API is not running at 18:00, so the command cannot be received. It must not be lost, and the pipe must not report it as applied.

**Decision:** commands that cannot be delivered are kept in a local inbox folder. When TimeKeeper starts, it synchronizes: it applies those commands in order with their original times, then catches up on the recordings it missed.

**1. Location**

- An `inbox` folder in TimeKeeper's app data folder, next to the database: `%APPDATA%\com.timekeeper.desktop\inbox\` on Windows, `~/Library/Application Support/com.timekeeper.desktop/inbox/` on macOS. The folder name comes from the Tauri identifier `com.timekeeper.desktop` (`src-tauri/tauri.conf.json`); if the identifier changes, this path changes with it.
- The pipe reads the path from `TIMEKEEPER_INBOX` in its configuration.

**2. File format**

One JSON file per command, named `<commandId>.json`, with the same fields as the command endpoints plus `kind`:

```json
{
  "kind": "end",
  "producerId": "screenpipe-pipe",
  "commandId": "end-2026-10-17-1800-a1b2",
  "sessionId": "session-2026-10-17",
  "occurredAt": "2026-10-17T18:00:00.000Z",
  "prerequisiteCommandId": "start-2026-10-17-0900-c3d4"
}
```

Files contain only IDs and timestamps, never screen content or client information.

**3. Writing (pipe)**

- The pipe always tries the API first (through MCP, [D6](#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server)). It writes to the inbox only when TimeKeeper does not answer.
- It writes `<commandId>.json.tmp`, then renames it to `<commandId>.json`, so TimeKeeper never reads a half-written file.
- It reports "saved, waiting for TimeKeeper", never "applied".
- **No code on the Screenpipe side.** Screenpipe has no built-in mechanism that sends a JSON file to another application; its API only answers requests. Pipes are AI agents written as plain markdown instructions, and Screenpipe documents that they can write files and call HTTP APIs ([scheduled tasks](https://docs.screenpipe.com/scheduled-tasks.md)). The fallback write is therefore an instruction in the pipe's `pipe.md`, not a program. Only TimeKeeper's reading side (section 7) is code.
- Do not read Screenpipe's own pipe logs (`~/.screenpipe/pipes/<name>/logs/`) instead of the inbox: they are Screenpipe's internal format, can change without notice, and do not carry our command IDs.

**4. Synchronization at startup (TimeKeeper)**

Before the API reports ready on `GET /api/health`:

1. List `inbox/*.json` (ignore `.tmp`), parse each file, and sort by `occurredAt`, then `commandId`.
2. Apply each command through the same application service as `POST /api/commands/start` and `/end`. All existing rules apply unchanged: a repeated `commandId` has no further effect, a reused `commandId` with a different payload is refused, and an end waits for its start.
3. Move each file according to the result:
   - applied → `inbox/done/` (kept as a trace);
   - `pending` (waiting for its prerequisite) → left in `inbox/` and retried at the next synchronization;
   - refused, or the file is not valid → `inbox/failed/`, with a sibling `<commandId>.error.json` holding `{error, message}`. The interface shows a notice so the lawyer can act.
4. Catch up on recordings: for each session whose time was not covered while TimeKeeper was closed, read the missed window from Screenpipe through the adapter ([D5](#d5-calling-screenpipes-api-with-its-token)), only within the session's start and end boundaries, deduplicating sources ([A12](#why-a12-and-a13-were-added) rules). This is the "reopen and reconcile" step of the [requirements](REQUIREMENTS.md#sessions-and-desktop-lifecycle). Manual corrections are preserved.

The same synchronization may also run on a timer while TimeKeeper is open, so a file written during a short outage is picked up without a restart.

**5. Why**

- It works while TimeKeeper is fully stopped. A queue inside TimeKeeper cannot receive anything then ([AGENTS.md](../AGENTS.md)).
- No new server, endpoint, or business rule: it reuses the tested command service.
- Crash-safe: an unprocessed file stays in the folder, and applying it twice is harmless.

**6. Limits and accepted risks**

- The pipe must be able to write files. Screenpipe documents that pipe restrictions do not sandbox shell commands; this is not yet tested on an installed release.
- If TimeKeeper is never reopened, commands wait. Nothing is applied without the application.
- Any local program can write to the folder: same accepted risk as [D1](#d1-no-local-access-token-for-the-hackathon).
- Order relies on the computer's clock (`occurredAt`), which is sufficient on one machine.

**7. What to build**

- In TimeKeeper: an inbox adapter (`src/backend/adapters/inbox/`) behind a port, and a startup worker (`src/backend/workers/`) that runs steps 1 to 4 before readiness ([AGENTS.md](../AGENTS.md) rule 4).
- In the pipe: the fallback write when the API does not answer.
- Tests: end written while closed is applied at startup with its original time; duplicate files; end before start; invalid file; crash between apply and move.

**8. Status (2026-10-17)**

Built on `mprifti42tech/api`:

- Port `CommandInbox` in `src/backend/ports/index.ts` (replaces the earlier placeholder), adapter `folderInbox` in `src/backend/adapters/inbox/folder.ts`, worker `syncInbox` in `src/backend/workers/inbox-sync.ts`.
- `src/backend/api/index.ts` runs the synchronization **before** the server listens, so `GET /api/health` answers only once the inbox is applied, then every 30 seconds while running.
- Folder: `TIMEKEEPER_INBOX` if set, otherwise `inbox` next to the database (`TIMEKEEPER_DB`): the app data folder in the installed app, `data/inbox/` in development.
- Commands are sorted by `occurredAt`, then `commandId`, and applied through the same service as `POST /api/commands/start` and `/end`. Applied → `done/`; waiting for a prerequisite → stays; refused or invalid → `failed/` with `<name>.error.json` holding `{error, message}`; an unexpected error (for example a locked database) leaves the file for the next run.
- Tests: `tests/integration/inbox-sync.test.ts` (9 tests: the closed-app end, order by time, an end waiting for its start, duplicates, a crash between apply and move, invalid and refused files, `.tmp` files ignored, the folder location, an end before its start). Also checked end to end by starting the real API with an end file waiting in its inbox: it was applied before `/api/health` answered, with the session ending at the pressed time.

Not built yet:

- **The pipe side:** `end_session` exists ([D7](#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe)) but must still write the file when the API does not answer (Rajavik-git). The format is section 2; write `.tmp`, then rename.
- **Checking against an installed Screenpipe:** step 4 below is tested only with stand-ins.

Step 4, catching up missed recordings, **built on `mprifti42tech/api` (2026-10-17):**

- Worker `catchUpRecordings` in `src/backend/workers/recording-catchup.ts`, using the Screenpipe adapter ([D5](#d5-calling-screenpipes-api-with-its-token)) and service methods `retrievalPlan`, `beginRetrieval`, `completeRetrieval`, `failRetrieval`, and `periodIdAt`. Progress is stored in the existing `retrieval_progress` table.
- **Plan:** for each session, newest first, read from the end of its last complete window, starting 5 minutes earlier for late indexing, to the session end or now, in 1-hour windows, at most 24 windows per run. A long gap is therefore caught up over several runs, and the session in progress comes first.
- **Each window:** marked `pending`, read, then each reference is attached to the work period it falls in (or left unlinked) and imported through the same service as `POST /api/sources`, with the stable ID `sp:<instance>:<contentType>:<externalId>`. A known reference is unchanged; one already attached differently (for example after a correction) is kept as it is. The window is marked `complete` only after its references are saved, which also marks earlier unfinished windows up to its end as read.
- **Failures:** a failed read (Screenpipe down, timeout, refused token) marks the window `failed` and stops the run. Failed windows are coverage gaps (`GET /api/coverage-gaps`), so the lawyer sees missing coverage instead of a silent zero. The next run starts again from the last complete window.
- **When:** after the API listens, then every 5 minutes, never twice at once, and only when `SCREENPIPE_URL` or `SCREENPIPE_API_KEY` is set. **Deviation from section 4:** it does not delay `GET /api/health`. A slow or stopped Screenpipe would otherwise hold back the start button for minutes; the inbox commands, which are local and fast, still run before readiness. The configuration condition keeps the demo, which has no Screenpipe, free of false coverage gaps.
- **Tests:** `tests/integration/recording-catchup.test.ts` (attaching to periods, an active session with overlap, a failed read becoming a gap and closing on retry, an existing reference kept, newest session first, the window limit). Also checked end to end: the real API against a stand-in Screenpipe HTTP server imported a reference into the right demo period without storing screen text, and a wrong token stopped with "Screenpipe authentication failed" and a visible gap, without the token in the log.
- **Showing failed commands to the lawyer:** the API is built (`GET /api/inbox/failed` and `POST /api/inbox/failed/{file}/dismiss`, see [A14](#a14-failed-inbox-commands)); the screen is not built yet.

### D9. Only past days can be validated

Decided by the team leader on 2026-10-17. This is a business rule: [requirements](REQUIREMENTS.md) must be updated by their author; until then this section records it.

- **Rule:** the lawyer validates the time of a day only after that day is over. Periods of today, and periods still running, cannot be validated. Undoing a validation ([D2](#d2-undo-a-validation-through-the-same-endpoint)) stays allowed.
- **Details:**
  1. "Day" is the lawyer's **local** calendar day, from the time zone of the computer running TimeKeeper, not UTC.
  2. A period belongs to the day it **starts**. A period from 23:30 to 00:30 belongs to the first day and can be validated the next morning.
  3. A period with no end yet is never validated, even if it started on a past day.
  4. Enforced by the service for every caller: `POST /api/work-periods/{id}/validate-time` and the bulk `POST /api/work-periods/validate-time` return `409 conflict` with `only past days can be validated` or `a running period cannot be validated`. A bulk request with one such period changes nothing.
- **Why:** a lawyer reviews a day once it is complete. It also prevents most reconstruction conflicts ([A6](#missing-endpoints-and-rules)): late evidence usually arrives during the day, and the startup synchronization ([D8](#d8-synchronization-at-startup-through-a-local-inbox-folder)) catches up missed recordings before the lawyer can validate the previous day.
- **Demo:** the demo data is dated 2026-10-16, which is in the past, so demo periods can still be validated.
- **For the interface:** disable or hide "validate" and "approve day" for today and for running periods, so the lawyer does not hit the `409`.
- **Tests:** `tests/integration/validation-day.test.ts` (today refused, next day accepted, a period crossing midnight, a running period, bulk, undo). `tests/integration/service.test.ts` now uses a clock on the day after its periods and ends a period before validating it.

### D10. JEV-confirmed tab changes become work-period transitions

Written on `feat/screenpipe-start-session` as D9 and renumbered D10 when merged, since D9 was already taken.


- **Decision (2026-10-17):** while a session is active, the tab-detection watcher ([`jev-check --session-bound`](../integrations/screenpipe/jev-check/README.md)) sends JEV's result to the session through the TimeKeeper MCP tool `record_case_transition`. It replaces the earlier rule that identified matches stay in Screenpipe with `applied: false`.
- **When a command is sent:** only when JEV answers `yes` to "did the user really change tab?" (confidence at least `JEV_MIN_CONFIDENCE`, default 0.7) and the analysed context is still current. Then:
  - JEV selects an existing case different from the open period's case: a transition to that case (`origin: automatic`);
  - JEV answers "no unique candidate" with enough confidence: a transition with `caseId: null` (`origin: unresolved`). The service opens an unresolved period and its question `period:<id>` for the lawyer;
  - anything else (no change, uncertain, low confidence, same case, stale context): nothing is sent and the active case is kept.
- **Command:** `record_case_transition { sessionId, transitionAt, caseId }` → `POST /api/work-periods` with `mode: current` and `startedAt` set to the capture time of the new context, never the model response time. The period ID is `auto-<sessionId>-<epoch ms>`, so a retry has no further effect. The service closes the open period at that time, checks the case, the session boundaries, and protected periods (a protected split returns `202 pending`).
- **Guards in the tool:** nothing is written for a session that is no longer active, for a time before the open period's start (a delayed result), for the open period's own case, or twice for an unresolved period. Candidates come from `GET /api/cases` and the open period from `GET /api/work-periods`; JEV never sees real IDs.
- **Not changed:** automatic periods still need the lawyer's time validation; a manual assignment is never overwritten, because a transition opens a new period instead of reassigning the open one. Folder identification as a product rule, duration derivation, and source evidence import remain open ([design review](DESIGN_REVIEW.md)).
- **Verified (Windows, 2026-10-17):** Start button → session → watcher → real Notepad tab changes recorded by Screenpipe → Screenpipe MCP → JEV (`jev-1.13.0`) → `record_case_transition` → real Node API and SQLite: a period on case `2026-009-DAWSON`, then an unresolved period with its question, then End button → session ended and watcher stopped. JEV received window titles only. One run with fictional documents; accuracy on real work is not established.

## Open questions

None for the API at the moment. Product decisions still open elsewhere (duration derivation, folder identification, reconstruction conflicts) are tracked in the [design review](DESIGN_REVIEW.md) and the [README](../README.md#decisions-to-make).
