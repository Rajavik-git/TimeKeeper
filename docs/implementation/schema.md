# Implemented database and fictional seed

The authoritative logical model is [the database design](../DATABASE.md). `src/backend/adapters/sqlite/migrate.ts` creates its session, work-period, evidence and recovery tables in migration 1, adds retained mockup fields and billing tables in migrations 2–3, and adds an explicit demo block-to-period link in migration 4. SQLite stores UTC timestamps, integer milliseconds for detected and overridden duration, and integer cents for hourly rates. `work_periods` do not store calculated amounts or totals. Invoices alone store the React-supplied frozen monetary snapshot and lines after application validation.

| Canonical table | Implemented role |
| --- | --- |
| `clients`, `cases`, `settings` | Client ownership, case > client > base rate cascade, case pricing mode, catalogue and invoice numbering |
| `sessions`, `processed_commands` | Explicit start/end, idempotence, prerequisite ordering and first end boundary |
| `work_periods` | One period per imported block, plus manual periods; assignment and effective revisions, precise durations, time validation, billing, exclusion and task details |
| `sources`, `tag_targets`, `assignment_deliveries` | Observation identity, review, availability and proposed verified tag delivery |
| `pending_questions`, `reconstruction_conflicts`, `retrieval_progress` | Guarded unknown-case questions, protected reconstruction proposals and explicit retrieval gaps |
| `task_types`, `markers`, `client_rules` | Retained fictional demo configuration and recognition cues |
| `expenses`, `invoices`, `invoice_lines` | Expenses and disbursements; frozen issued snapshots and referenced period IDs |
| `audit_events`, `source_exports`, `jev_reviews` | Retained audit, export and review records |

The imported 18-table mockup schema still exists for catalogue editing, deterministic recognition and some historical evidence displays. `seedCanonicalDemo` maps it into the canonical model once and preserves case and source identities. `demo_block_periods` keeps each imported block linked to its period across discard and recovery; a manual period may have the same numeric ID as an unrelated block. Migration 4 backfills this link in databases created by earlier migrations. Catalogue, period, block and expense edits synchronize corresponding canonical records within the same transaction. Canonical assignment, validation, exclusion and billed status project to the retained demo tables. Historical routes are translated by the demo application service; assigning through the compatibility entry route requires an expected assignment revision. Unissued legacy `time_entry.amount_cents` values are zeroed and are not used by the aligned interface. New invoice IDs and frozen line details are authoritative only in the canonical billing tables; historical issued invoice values stay frozen.

## Demo reference figures

The fictional 16 October 2026 session begins at 08:40. The day contains **4:27** of combined effective work and **€912.50** in estimated fees before VAT. The JAF period contributes 12 minutes at the €30 base rate; Dupont v Martin contributes 134 grouped minutes and €670; Bernard contributes 51 minutes and €212.50; Lumen is a flat-fee case. Period 14 retains its detected **2:32** and a lawyer override of **1:48**. A failed retrieval interval from **11:24–12:05** is shown as incomplete coverage without invented work time. Dupont v Martin has **212 billable minutes** and **€1,060** in fees available for a draft invoice; unvalidated periods still block issuance. Expenses, VAT and disbursements are separate from that fee figure.

The seed retains eight clients, twelve cases, fictional markers, rules, expenses, source references, audit entries, Jev reviews, and issued invoice `F-2026-0041`; the next number is `F-2026-0042`. Run `npm run db:reset` to recreate the demo. No live Screenpipe capture or interval inference is involved.

For the historical French-to-English field mapping of the imported mockup, see [the original database reference](../reference/ORIGINAL_DATABASE.md). For the canonical constraints and proposed behavior, see [the database design](../DATABASE.md).
