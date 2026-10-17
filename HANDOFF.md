# Review fixes and remaining acceptance

The user authorized the architecture, code, database, and dependency review fixes on 2026-10-17. Implementation and independent API, frontend, and persistence review are complete. Preserve all pre-existing working-tree changes. Nothing was committed and the working database was not reset.

## Decisions and changes

- Canonical SQLite records own business writes. Compatibility projections preserve existing UI routes, opaque identities, and stable legacy entry aliases. Migrations 5–8 cover preferences, entry identities, source relocation, invoice currency, and immutable references.
- Recovery protects manual corrections and validated periods. Safe splits relocate evidence consistently. Unsafe aliases or committed deliveries produce conflicts. Exports use canonical records and redact all payload strings, including audit text.
- Production Hono routes and generated OpenAPI request validation replace the duplicate HTTP implementation. Ajv and `ajv-formats` validate requests at runtime.
- The user chose shared fetch hooks, not TanStack Query. Hooks handle cancellation, stale responses, slow polling, and refresh failures after successful writes. Native dialogs replace custom modal behavior. Totals, completeness, fees, currency, and canonical Activity/source-pack selection are corrected.
- SQLite remains on `node:sqlite`. The user subsequently selected Drizzle despite the native driver's release-candidate requirement; `drizzle-orm` is pinned to `1.0.0-rc.4`. Existing SQL migrations remain authoritative. Provider workflows, interval reconstruction, closed-app command delivery, conflict resolution, and native packaging remain documented product/integration gaps.

## Initial review verification

Use Node 24.22.0 from `.nvmrc`; the shell default was Node 25 during this run.

- Full suite: 156 passed, 9 existing skips. Type checking, ESLint, formatting, and diff whitespace checks passed.
- Independent memory-only persistence checks covered opaque IDs, export audit inclusion, alias collisions, recovery, immutable references, and foreign keys. Upgrade tests cover v4 to v8, repeated migration, preference preservation, and currency recovery.
- The database reset script passed against a disposable database in `/private/tmp/timekeeper-review-db.wTyZHD`.
- A clean offline install of the lockfile passed in a temporary directory. Direct `npm ci` could not remove old working `node_modules` directories due to EPERM; clean packages were copied back without deleting those directories. Dependencies are restored.
- Backend compilation passed. Frontend production build passed in `/private/tmp/timekeeper-build.aprZ4z`. Default `npm run build` could not clean the existing `dist/frontend/assets` directory due to EPERM.

## Remaining acceptance

Browser acceptance did not run. Playwright MCP could not open a tab because its profile was in use. The isolated API could not bind localhost due to EPERM, including after escalation. No user browser was closed. Run `tests/acceptance/smoke.mcp.js` using the isolated setup in `tests/acceptance/README.md` when the host permits localhost and the MCP browser is available. Native macOS/Windows and Screenpipe acceptance remain separate.

## Startup fix, 2026-10-17

The user reported that the app does not start. The Vite proxy excluded only `client.ts`, so the new frontend `actions.ts`, `queries.ts`, and `resource.ts` modules were sent to the backend instead of Vite. `src/frontend/vite.config.ts` now excludes TypeScript modules directly under `/api/`, including hot-update queries. Nested backend routes and search values that end in `.ts` remain proxied. `tests/unit/vite-proxy.test.ts` reproduced the failure before the change and passes afterward. Independent review found no actionable issue.

With Node 24.22.0, 158 tests passed and 9 were skipped. Type checking, formatting, and lint for the changed code passed. Full lint now encounters an unrelated `document` reference in `graphify-out/browser-check.js`. Backend compilation passed. The default frontend build still cannot clean `dist/frontend/assets` due to EPERM; a build into `/private/tmp/timekeeper-startup-build.KLBp5r` passed.

Live startup remains unverified. `npm run dev` fails here with watcher EMFILE; separate API and UI launches fail with localhost EPERM even after escalation. Playwright MCP still reports its browser profile in use. No development server remains running. The next action is to run `nvm use` and `npm run dev` in a host terminal, then run the isolated MCP browser workflow when available. This fix did not reset the working database or change the application lifecycle.

## Demo removal, 2026-10-17

Normal startup now creates an empty workspace with neutral preferences and work categories. It preserves saved data and never imports sample tables. The demo reset route and control are removed. SQL samples and the canonical fixture importer moved to `tests/fixtures/`; regression tests use that explicit helper. The browser fixture command requires a new isolated path. The current local date replaces the fixed demo date. The Desk document is blank. Manual entry is disabled because the former UI fabricated timestamps; its product rules remain open.

The working database was compared against the fixture before cleanup. Only known sample validation/discard changes differed. A SQLite backup is at `data/backups/demo-removal-20261017/timekeeper.db`; the removed fictional document files are archived beside it as `documents.zip`. Business tables are empty. Empty legacy directories could not all be removed because the host returned EPERM; they contain no files.

Empty-start/reopen API checks and the existing suite passed, 159 tests with 9 existing skips, and TypeScript passed. Browser acceptance is blocked by the occupied MCP browser profile and localhost EPERM. The default frontend output directory still has EPERM. Backend compilation and frontend production output passed at `/private/tmp/timekeeper-empty-build.s3pJO1`. Existing generated `.archify` files fail full formatting and `graphify-out/browser-check.js` fails lint. Focused source, script, and test formatting/lint checks passed. Reopening the working database confirmed zero clients, cases, periods, sources, and invoices with valid foreign keys. Independent review also resolved first-client selection in Settings rules and Cases creation. No recording workflows, commits, or publishing ran.

## Drizzle and frontend fixes, 2026-10-17

Implementation and independent review are complete. The user installed Drizzle and the React component-test dependencies after this session could not reach the npm registry. The package manifest and lockfile contain the installed versions.

- Typed Drizzle table mappings and repository queries share the existing `DatabaseSync` connection. Raw savepoints still cover ORM writes. Versioned SQL migrations, complex reconciliation SQL, existing identities, and saved data remain intact; there is no schema push or new database location.
- Wrapped SQLite constraint errors retain sanitized API responses. Taskless periods remain nullable through the compatibility API. Client creation accepts an explicit zero rate and rejects negative rates.
- Mounted frontend queries refresh every five seconds while visible and on resume. Slow requests are preserved. Case navigation survives refreshed arrays. Dates update at local midnight and after resume. Optional rate and budget overrides can clear to inherited values; explicit zero stays valid.
- Partial validation failures refresh successful writes. Billing includes expense-only and disbursement-only cases. Shared source export and validation logic, calendar, case editor, billing overview, and invoice row calculations have separate modules.
- Architecture, database, and interface documentation describe the current implementation. All pre-existing edits are preserved. This migration did not reset the working database.

Latest verification under Node 24.22.0:

- Full suite: **181 passed, 9 skipped across 28 passing test files**. Tests cover migration/reopen, nested rollback, nullable tasks, API constraints, midnight/resume, polling, navigation, overrides, partial validation, and billing visibility.
- Type checking, full formatting, source/script/test ESLint, and diff whitespace checks passed. Full ESLint still fails on the unrelated `document` reference in `graphify-out/browser-check.js`.
- Backend compilation passed. Frontend production output passed at `/private/tmp/timekeeper-drizzle-build.yNKapb/frontend`. Default `npm run build` still cannot clean `dist/frontend/assets` due to EPERM.
- A clean offline `npm ci --ignore-scripts` passed in a temporary directory. The reset script passed against `/private/tmp/timekeeper-drizzle-reset.C2OI7m/timekeeper.db` only.
- Browser acceptance remains blocked: the Playwright MCP browser profile is occupied. No user browser was closed. Component and API tests do not establish browser, native desktop, or Screenpipe acceptance.

The remaining acceptance action is to run the isolated workflow in `tests/acceptance/README.md` when the MCP browser and localhost are available, followed by the separate platform/provider checks. No source implementation is waiting on npm access.

## Internal code review and fixes, 2026-10-17 — latest status

The user requested fixes and a deeper review of source quality. Code and architecture reviewers inspected responsibilities, state coupling, typing, failure paths, and tests. The selected fixes and refactors are complete:

- Client rate PATCH accepts null, restores global inheritance, retains explicit zero, and rejects negative values. The existing pill `case` display option is accepted by the request contract. Both generated contracts are current.
- Invoice rows allocate cumulative rounded shares of the combined fee. Short final periods cannot receive negative cents; totals and CSV remain consistent.
- Settings has six section components with local drafts/errors and generated PATCH types. Switching sections closes forms and prevents client/task draft leakage. Failed saves preserve the active draft. Settings itself owns navigation and save notifications.
- `CaseSearch` owns debounce, cancellation, stale-result guards, error status, and keyboard/pointer selection. `useRecentCases` centralizes storage and equivalent numeric/string ID deduplication. Cases retains navigation.
- `dayView` owns pure grouping, filtering, duration ordering, gap placement, and CSV order. MyDay retains loading, mutations, totals, and focus handling.
- The source-pack builder receives a typed snapshot and precomputed compatibility IDs. The service retains transaction, hash, receipt, and audit writes. Export no longer rereads the full entry table per period. Final review also caught SQL null being converted to opaque ID `"null"`; the fix preserves null and excludes unattached evidence, with an API regression.
- Implementation architecture and interface documents describe these boundaries. ESLint configuration formatting was normalized without changing its existing exclusions. No dependencies, migrations, working database records, commits, or provider workflows changed.

Final independent reviews found no remaining actionable defect in the changed scope. Remaining code debt is the generic `DemoPort`/`DemoRow` compatibility boundary and MyDay's combined editor/mutation/focus handling. Narrow those by use case when the related workflow changes; a wholesale storage or screen rewrite is not needed for this pass.

Final checks under Node 24.22.0: **212 tests passed, 9 skipped, 32 passing test files**. Full ESLint, TypeScript, Prettier, and diff whitespace checks passed. Backend compilation and frontend production output passed in `/private/tmp/timekeeper-quality-build.aehxwU`. Default `npm run build` still cannot clean `dist/frontend/assets` due to EPERM.

Browser MCP can now open a tab. Browser acceptance is still blocked because the isolated API and Vite cannot bind localhost, including an escalated API attempt. The disposable fixture is `/private/tmp/timekeeper-quality-browser.0pNB0U/timekeeper.db`; the working database was not used. No test server remains running. Run the isolated MCP acceptance workflow when host localhost access is available. Native desktop and Screenpipe acceptance remain separate.

## Database, naming, and data-format fixes, 2026-10-17

The user authorized the latest review fixes and requested an explanation of the manipulated data. Implementation and final independent code review are complete. No working database records were read, reset, or migrated during this pass. All migration and API checks used isolated databases. Changes remain uncommitted.

- Runtime `DemoService`, ports, and adapter are now `LegacyUiService` and matching files. Misleading method names now describe their behavior. Fixture-only recognition refresh lives under `tests/fixtures`.
- The fabricated legacy manual-entry endpoint returns 501 without writes. The explicit canonical manual API remains; the interface stays unavailable pending its product rules. Pauses record annotations without fixture IDs or recorder-control claims. Assignment no longer learns markers.
- Invoice CSV uses neutral amount headers and frozen currency. Unknown historical currency exports as blank. The CSV header is now `number;date;client;case;label;minutes;hourly_rate;amount;currency;sales_tax`.
- Explicit catalog projections replace historical-table introspection. TypeScript checks that their fields match the generated response contract. Required `time_entry.work_period_id` joins numeric compatibility entry aliases to canonical string period IDs. Activity and historical billing calculations use that identity.
- Frontend components and props use case and period terminology, `catalogState`, and `workspaceState`. Source-pack date-range and selected-period names translate to the existing wire values at the API boundary. Fixture ID 14 no longer controls default selection.
- SQL and interface timestamp ordering use chronological values. Regression coverage includes mixed fractional-second precision and recovered period boundaries.
- Migration 9 adds extension validation guards and foreign-key indexes without rewriting historical rows. Inserts validate all guarded fields; updates validate changed values independently, allowing old invalid settings to be repaired through the interface. Storage guard failures return sanitized 400 responses.
- `docs/DATABASE.md#data-formats-in-the-application` explains SQLite, JSON, field mappings, IDs, units, currency, null values, and remaining compatibility metadata. Context7 supplied SQLite trigger documentation; existing Drizzle and React documentation was retained from the review.

Final checks on Node 24.22.0: **228 passed, 9 skipped, 35 passing test files**. Full TypeScript, ESLint, Prettier, and diff whitespace checks passed. Backend compilation passed. Frontend production output passed at `/private/tmp/timekeeper-format-build.7cfbbt/frontend`. The normal build remains blocked when Vite tries to clean `dist/frontend/assets` with EPERM.

Browser acceptance remains blocked: the isolated API cannot bind `127.0.0.1:8788` due to EPERM. No server remains running. Use the isolated MCP acceptance workflow when localhost access is available. Native desktop and Screenpipe checks remain unverified. Historical tables, numeric aliases, and explicitly named demo metadata still exist for compatibility; this pass does not claim their wholesale removal or a working provider integration.

## Canonical UI and date library fixes, 2026-10-17 — latest status

The user authorized comprehensive fixes and selected date-fns after comparing it with Luxon and Day.js through Context7. The user installed `date-fns` 4.1.0 and `@date-fns/tz` 1.4.1. Their versions are pinned and verified. Luxon and its types were removed from the manifest and lockfile; unused files may remain in the existing dependency directory because the host refused directory removal. A clean offline lockfile install passed in a disposable directory.

- `src/shared/dates.ts` now owns strict calendar-date validation, month-end clamping, timezone conversion, clock labels, calendar navigation, and DST-aware day bounds. Dates without times keep their calendar meaning. Explicit instants and exact duration milliseconds retain their meaning.
- Frontend and backend filters use the same calendar helpers. The UI sends its system timezone with date-filtered requests, new invoice snapshots, and source packs. Whole periods belong to their start day for these views; no splitting, clipping, or inferred duration was introduced. Historical invoice and export snapshots are preserved.
- Current screens use typed canonical catalogue, period, source, audit, and billing data. `CatalogService`, its typed port, and its Drizzle repository do not use historical projections. Client and case identities stay strings, nullable rates preserve inheritance, and unknown opening dates stay null and render as Unknown.
- Activity uses period/source identities and canonical audit links. It no longer depends on numeric block or entry aliases. The timeline uses elapsed time from local midnight, with actual local clock labels across DST and overnight spans. Previews show linked stored text and do not fabricate waveforms.
- `SourceExportService` owns version 2 canonical JSON exports and the live invoice CSV read. Source packs retain exact IDs and durations, hash the exact payload, and commit receipt and audit atomically. Redaction targets descriptive text while preserving structural values. UI labels describe stored text and known application metadata, with no media-blur claim.
- Older API contracts are isolated in `api/compatibility-routes.ts` and marked deprecated in OpenAPI. `CompatibilityApiService` replaces the former LegacyUi name. Current screens and canonical exports do not consume these contracts. Existing historical tables and aliases remain for older callers and upgrade support.
- The final independent review found no remaining actionable defect after resolving nullable opening-date rendering and redaction that could previously change IDs. Documentation describes the current contracts and calendar policy.

Final checks on Node 24.22.0: **279 tests passed, 9 skipped, 40 passing test files**. TypeScript, full ESLint, full Prettier, generated contracts, diff whitespace checks, and a clean offline `npm ci --ignore-scripts` passed. Vitest used `--fsModuleCachePath /private/tmp/timekeeper-date-final-verification` because the default existing `node_modules/.vitest-cache` directory cannot be removed in this environment.

Backend compilation passed. Frontend production output passed at `/private/tmp/timekeeper-canonical-build.TMWfkm/frontend`. The normal output cleanup still fails at `dist/frontend/assets` with EPERM. Browser acceptance remains blocked because the isolated API cannot bind localhost, also with EPERM. No server remains running. Native desktop and Screenpipe verification remain separate.

No working database was read, reset, or migrated in this pass. All data checks used isolated databases. Changes remain uncommitted. The remaining acceptance action is the isolated MCP browser workflow when localhost and output-directory permissions permit it.

## Requested sample data, 2026-10-17

The user explicitly requested dummy data. Added 3 labelled sample clients, 5 cases, 3 ended sessions, 13 work periods, 13 fictional text sources, and 3 expenses to `data/timekeeper.db` for October 15–17 in Europe/Paris. The existing client, task types, settings, and invoice numbering are unchanged. No invoices or real recordings were created. All fictional sources are marked unavailable.

The pre-import SQLite backup is `data/backups/sample-data-2026-10-17T20-58-04-665Z/timekeeper.db`. Sample identities use `sample-b4118d46-498a-4ef6-8b30-f965745bb784`. A one-off temporary script applied the import in one transaction after an isolated dry run and independent safety review; no automatic runtime seeding was added. API reads, database reopening, preservation comparisons against the backup, foreign-key checks, and SQLite integrity checks passed. The database now has 4 clients, 5 cases, 13 periods, and no active session.
