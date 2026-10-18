# History proposal activation

Updated 2026-10-18. Branch: `merge/post-ui-review-mcp-api`. This branch includes the MCP/API integration, application review changes and history proposals. Integration activation remains pending as described below. Git records the commit and push status.

## Implemented

- Activity → History proposals selects a session and range, requests generation, polls persisted progress, and reviews editable drafts. Worked duration starts blank and must be entered explicitly.
- HistoryService stores jobs and draft snapshots separately from work periods. Acceptance is atomic, idempotent, additive, unvalidated and unbilled. It refuses existing-period overlaps and stale evidence, preserves corrections, and never closes the active period.
- Migration 13 adds history job/proposal storage. OpenAPI and generated request/response contracts include all eight endpoints.
- A Screenpipe-triggered MCP command classifies every distinct permitted context in JEV batches. It preserves A → B → A, unresolved conflicts and source provenance. It creates no accepted periods. Context and batch limits produce actionable failures.
- The backend runner checks for the MCP history tool before dispatching the fixed manual Screenpipe pipe. No model inference runs in the backend.
- The installer now stages the manual history pipe and updated TimeKeeper skill with backups. A check found only these two pending destinations:
  - `~/.screenpipe/pipes/generate-work-periods/pipe.md`
  - `~/.screenpipe/skills/timekeeper/SKILL.md`

## Verification

- Full suite: 99 test files passed, 897 tests passed and 11 skipped.
- Full type checks, lint, formatting and diff checks passed. API bundle passed.
- Normal frontend build still fails when clearing existing `dist/frontend/assets` with EPERM. A fresh build passed at `/private/tmp/timekeeper-history-build`.
- In-process workflow/API test covers draft-only generation, explicit duration acceptance, source linking and replay without ending the session.
- Independent review found no remaining actionable defects.
- Browser verified the new Activity view and an actionable no-evidence error. Real JEV generation and native behavior were not accepted. No real proposal was accepted during verification.
- The development UI stopped listening on port 5173 before the final preview screenshot. Reload showed connection refused. No replacement server was started and no screenshot of an offline page was presented as feature evidence.

## Activation blocked on explicit approval

Automatic approval review rejected the attempted installer command because home-directory integration installation needs explicit user approval under AGENTS.md. Do not bypass this rejection through another tool or indirect execution. No installed Screenpipe integration files changed.

After explicit approval, run the reviewed installer with the pinned Node runtime. It does not start recording or inference. Then verify the two destinations are current.

The last listener check found no TimeKeeper MCP HTTP server on port 3032. To run generation, its updated server and Screenpipe connection must be running. The MCP server environment must include TypeSafe credentials and the explicitly approved field allowlist; history does not read the separate live watcher's environment file. Do not read denied `.env` files or print credentials. Follow docs/SETUP.md, section Generate work periods from recorded history.

Next action: obtain explicit installation approval, install the two reviewed files, verify MCP readiness, and run a bounded generation. Draft acceptance remains the lawyer's explicit review action.
