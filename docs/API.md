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
| Server | Hono with `@hono/node-server`, started by `src/backend/api/index.ts`. |
| Address | `127.0.0.1` only, port `8787`, overridable with `TIMEKEEPER_PORT`. |
| Routes | Demo and mockup routes in `src/backend/api/app.ts`. Canonical session, period, question, source, and billing routes in `src/backend/api/core-routes.ts`, mounted under `/api`. |
| Browser origins | CORS allow-list in `app.ts`: Tauri origins and the Vite dev server (`127.0.0.1:5173`, `localhost:5173`). `UI_PORT` adds the dev server on another port (`127.0.0.1` and `localhost`), and `TIMEKEEPER_ALLOWED_ORIGINS` adds a comma-separated list, for example a shared preview (both from `mvp` at `d7ce0e0`). Other origins get `403 forbidden-origin`. Requests without an `Origin` header are allowed. |
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
| `GET /api/cases` | ui, workflow, chat | All cases, ordered by reference; optional filters `clientId` and `status` (`active` or `archived`; any other value is `400`). Fields: `id`, `clientId`, `reference`, `title`, `category`, `caseNumber`, `opposingParty`, `status`, `mode`, `hourlyRateCents` (`null` = client or global rate applies), `flatFeeCents`, `budgetCents`, `openedOn`. This is the candidate list for assignment and JEV. | 200, 400, 500 |
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
- **Status:** Partly fixed: `ErrorCode` in `src/contracts/index.ts` now lists the current codes; the duplicated types remain. The rest is **postponed**: it is tidiness rather than a defect, and it touches the service and the ports for little hackathon value.
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
| A6 | Reconstruction conflict endpoints: list and resolve. | **Open.** Conflicts are stored, but the lawyer's resolution action is undefined ([design review](DESIGN_REVIEW.md)). |
| A7 | Read-only chat tools use existing read endpoints. | **Decided**, see [D3](#d3-read-only-chat-uses-existing-read-endpoints). Needs the A4 filters. |
| A8 | No local access control for the hackathon. | **Decided**, see [D1](#d1-no-local-access-token-for-the-hackathon). |
| A9 | Command delivery while TimeKeeper is closed. | **Decided**, see [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder). Not built yet. |
| A10 | Undo time and source validation with `{"validated": false}`. | **Done**, as decided in [D2](#d2-undo-a-validation-through-the-same-endpoint). |
| A11 | Replace `pending` refusals with `rule-not-decided` and `conflict`. | **Decided**, see [D4](#d4-error-codes-replacing-pending-for-refusals). Fixes [E1](#e1-undecided-rules-are-returned-as-successful-202-pending). |
| A12 | `POST /api/sources`: import evidence references from Screenpipe. | **Done.** See [Why A12 and A13 were added](#why-a12-and-a13-were-added). |
| A13 | Canonical reads: `GET /api/clients`, `GET /api/cases` (filters `clientId`, `status`), `GET /api/settings`. | **Done.** See [Why A12 and A13 were added](#why-a12-and-a13-were-added) and [Clients, cases, and settings](#clients-cases-and-settings). Complements the writes in A5. |

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

### D6. Screenpipe reaches the API through the TimeKeeper MCP server

- **Decision:** the HTTP API has two direct callers, both owned by TimeKeeper: the React interface and the TimeKeeper MCP server (`src/mcp/`). Screenpipe never calls the HTTP API itself:
  - Screenpipe pipes (the workflow) use the MCP server's scoped command tools: session commands, case transitions, evidence import ([A12](#why-a12-and-a13-were-added)), questions, and assignments.
  - Screenpipe chat uses the MCP server's read-only tools ([D3](#d3-read-only-chat-uses-existing-read-endpoints)).
  - The MCP server translates each tool call into one API request and returns the API result unchanged, including errors and `202 pending`.
- **Why:** this is the flow already agreed in the [architecture](ARCHITECTURE.md#case-assignment-and-evidence-flow) and the [integration research](SCREENPIPE_INTEGRATION.md). It keeps one place (the MCP server) that decides which tools are read-only and which may write, so the API endpoints themselves do not need to know who is calling. It also keeps the API address and any future token ([D1](#d1-no-local-access-token-for-the-hackathon)) out of Screenpipe pipe instructions.
- **Not verified:** Screenpipe documents custom HTTP MCP connections for chat. Whether a scheduled pipe can use the same MCP tools has not been tested, and the [pipe permissions](https://docs.screenpipe.com/pipe-permissions) page only describes rules for Screenpipe's own endpoints. Test this with the installed release before relying on it.
- **Fallback, if pipes cannot use MCP tools:** the pipe calls the same API endpoints over HTTP at `http://127.0.0.1:8787` (or `TIMEKEEPER_PORT`). Screenpipe documents that its pipe restrictions do not sandbox shell commands such as `curl`, and D1 means no token is needed. The rules stay the same: same endpoints, same idempotency, and the pipe must treat a refused connection as "TimeKeeper not running", never as success ([A9](#missing-endpoints-and-rules)).

### D7. The lawyer starts and ends a session with a button in Screenpipe

- **Decision:** the lawyer presses a button in Screenpipe to start a session and another to end it. A session does not start or end when Screenpipe or TimeKeeper starts or stops; it is always this explicit action ([requirements](REQUIREMENTS.md#sessions-and-desktop-lifecycle)). The team may move the button into TimeKeeper later; the API stays the same either way, because both call the same endpoints.
- **Flow:** button → Screenpipe pipe run manually → TimeKeeper MCP tools `start_session` / `end_session` ([D6](#d6-screenpipe-reaches-the-api-through-the-timekeeper-mcp-server)) → `POST /api/commands/start` / `POST /api/commands/end`.
- **Command fields:** each press creates a new `commandId` and records `occurredAt` at the moment of the press. `producerId` identifies the pipe. The end command carries the start's `commandId` as `prerequisiteCommandId`, so an end that arrives first waits as `pending`.
- **What exists:** both endpoints, with idempotency, one active session, preserved end boundary, and prerequisite ordering, covered by tests.
- **What is missing:**
  1. The MCP tools `start_session` and `end_session` (`src/mcp/` is empty).
  2. The Screenpipe pipe the lawyer runs as the button. Screenpipe documents manual runs for pipes (`schedule: manual`, run from the app, `pipe run <name>`, or `POST /pipes/<name>/run`; [scheduled tasks](https://docs.screenpipe.com/scheduled-tasks.md)), and Michel's JEV pipe (`feat/jev-implementation`) already runs manually. How the manual run appears to the lawyer must still be checked on an installed Screenpipe.
  3. The launcher (`integrations/screenpipe/launcher/`): on start, open TimeKeeper if it is closed and wait for `GET /api/health` ([A1](#missing-endpoints-and-rules)) before sending the command.
  4. Pressing end while TimeKeeper is closed: handled by [D8](#d8-synchronization-at-startup-through-a-local-inbox-folder).

### D8. Synchronization at startup through a local inbox folder

Solves "end while TimeKeeper is closed" (README decision 4, [design review](DESIGN_REVIEW.md) critical item). It follows the option proposed in the [README](../README.md#decisions-to-make).

**Problem:** the lawyer presses start at 09:00, closes TimeKeeper at 12:00 (the session stays active), and presses end at 18:00. TimeKeeper's API is not running at 18:00, so the command cannot be received. It must not be lost, and the pipe must not report it as applied.

**Decision:** commands that cannot be delivered are kept in a local inbox folder. When TimeKeeper starts, it synchronizes: it applies those commands in order with their original times, then catches up on the recordings it missed.

**1. Location**

- A folder in TimeKeeper's local data directory: `%APPDATA%\TimeKeeper\inbox\` on Windows, `~/Library/Application Support/TimeKeeper/inbox/` on macOS.
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

## Open questions

None for the API at the moment. Product decisions still open elsewhere (duration derivation, folder identification, reconstruction conflicts) are tracked in the [design review](DESIGN_REVIEW.md) and the [README](../README.md#decisions-to-make).
