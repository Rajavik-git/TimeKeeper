# SQLite data model

TimeKeeper has a local SQLite database, separate from Screenpipe storage. This document distinguishes the agreed logical design from the implemented MVP core schema. An initial migration now exists at `src/backend/adapters/sqlite/migrate.ts`; integration-dependent behavior remains proposed. The [requirements](REQUIREMENTS.md) define business behavior; the [architecture](ARCHITECTURE.md) defines component ownership.

The agreed logical model replaces the original task/subtask hierarchy with work periods. English entity names below identify the current design. The [original schema](reference/ORIGINAL_DATABASE.md) preserves the supplied identifiers and earlier review notes.

## Agreed structure

```mermaid
erDiagram
    clients ||--o{ cases : contains
    sessions ||--o{ work_periods : contains
    cases o|--o{ work_periods : assigned_to
    work_periods o|--o{ sources : supported_by
    sessions ||--o{ retrieval_progress : reconciles
    work_periods o|--o{ tag_targets : owns
    tag_targets o|--o{ sources : represented_by
    tag_targets ||--o{ assignment_deliveries : synchronizes
```

A case belongs to one client. A work period belongs to one session and has zero or one assigned case. An unknown folder creates an unresolved period while the lawyer decides. The client is derived from the assigned case; work periods do not store a second client assignment. Returning to an existing case creates another period for that case.

Assignment, time correction, time validation, and billed/unbilled status belong to the work period. Each source belongs to at most one period in the MVP; unmatched evidence can remain unlinked. Different source records can identify the same provider tag target. That target has one authoritative owner, and all its source aliases must agree with that ownership. Source validation and source availability are separate from time validation and billing.

## Proposed fields and constraints

The fields below make the agreed model concrete for implementation review. The initial SQL migration creates the listed tables, foreign keys, uniqueness rules, nonnegative duration and rate checks, session and period bounds, and restricted deletion. The service layer owns revision transitions and question-answer guards. Source-tag delivery, stopped-app command receipt, provider-dependent mapping, and unresolved product transitions remain proposals. Use stable opaque IDs, explicit foreign keys, and a consistent timestamp representation with UTC meaning and unrounded precision. Store event time separately from ingestion time. Integer milliseconds are proposed for duration storage; the interface expresses working time in minutes.

### `clients`

| Field | Purpose or constraint |
| --- | --- |
| `id` | Primary key. |
| `name` | Required display name; not an identity key. |
| `active` | Boolean catalogue status. |
| `created_at`, `updated_at` | Record timestamps. |

### `cases`

| Field | Purpose or constraint |
| --- | --- |
| `id` | Primary key. |
| `client_id` | Required foreign key to `clients`. |
| `reference`, `title` | Case catalogue information; folder-matching rules remain undefined. |
| `hourly_rate` | Optional nonnegative case rate; `NULL` uses the global rate. |
| `status` | Case catalogue status; allowed values to define. |
| `created_at`, `updated_at` | Record timestamps. |

Case reference uniqueness and folder aliases remain undecided. Do not use a client name, case title, or file path as the case primary key. Client rates and fixed fees are outside scope.

### `sessions`

| Field | Purpose or constraint |
| --- | --- |
| `id` | Stable session identity carried by workflow commands. |
| `started_at` | Explicit Screenpipe start boundary. |
| `ended_at` | Nullable explicit Screenpipe end boundary; cannot precede `started_at`. |
| `revision` | Monotonic version for stale-command checks. |
| `created_at`, `updated_at` | Local persistence timestamps, distinct from boundaries. |

Allow at most one session with no end boundary per local workspace. Enforce this in storage and application services. After known causal prerequisites are applied, a start received while a session is active returns that session; it does not reset its start or create another one. A new start that depends on a pending end waits for that end instead of being collapsed into the earlier session. Application exit does not set `ended_at`. Reopening resumes the active session.

The first applied end fixes the boundary. Repeated ends return the existing outcome without moving it. Reconciliation can still import observations recorded within the session without reopening or extending it. Keep the end boundary independent of retrieval completeness. An end delivered before its known prerequisite start remains pending until that start is applied; record the effective end time without claiming the end has succeeded.

### `work_periods`

| Field | Purpose or constraint |
| --- | --- |
| `id`, `session_id` | Primary key and required session foreign key. |
| `case_id` | Nullable case foreign key; `NULL` represents an unresolved assignment. |
| `initial_case_id`, `initial_origin` | Implemented immutable opening intent used to deduplicate a replay after later assignment corrections. |
| `started_at`, `ended_at` | Recorded boundaries, with nullable end while a period is open. |
| `detected_duration_ms` | Nullable unrounded derived duration; derivation is not defined yet. |
| `duration_override_ms` | Nullable lawyer correction, converted from minutes; zero differs from no correction. |
| `assignment_origin` | Distinguish automatic assignment from lawyer assignment. |
| `time_validation_status` | Review state, independent of source validation and billing. |
| `effective_revision` | Version of the effective case and duration; increments only when either effective value changes. |
| `validated_effective_revision` | Nullable version explicitly validated by the lawyer. |
| `time_validated_at` | Optional timestamp of the current validation. |
| `billing_status`, `billed_at` | Period-level billed/unbilled status and associated timestamp. |
| `applied_hourly_rate`, `applied_currency` | Nullable rate snapshot; capture timing and currency policy remain open. |
| `revision`, `assignment_revision` | Versions protecting record edits and period assignments; provider delivery also has its own target revision. |
| `created_at`, `updated_at` | Record timestamps. |

Require nonnegative durations. Known boundaries must fall within the session. An end boundary cannot precede its start. Do not replace missing duration with zero. A newly opened period has no accumulated time; lack of evidence later must remain distinguishable from a confirmed zero duration.

Preserve recorded boundaries and detected duration when the lawyer enters a duration override. Reprocessing evidence must preserve the override and manual assignment. The effective duration is the override when present, otherwise the detected duration. An actual change to the effective case or duration increments `effective_revision` and requires time validation again, whether the change is manual or automatic. Validation applies only when `validated_effective_revision` equals the current `effective_revision`.

Identical replay does not increment `effective_revision` or invalidate time. A detected-duration change hidden by an unchanged override also preserves validation. A zero override is an effective value, not a missing value. Source review states remain separate. Effects of edits to already billed periods remain a decision before implementation.

Do not automatically split, merge, or replace a lawyer-corrected or validated period during reconstruction. Preserve it and store the proposed conflicting boundaries in a separate `reconstruction_conflicts` record. A conflict proposal is not a work period and contributes no time. Resolving it must atomically preserve or replace the affected counted records so both versions cannot appear in totals.

Reassigning one period must not move other periods or their sources. A historical correction must not change the current active case. Do not store computed client totals, case totals, or monetary totals here.

### `sources`

| Field | Purpose or constraint |
| --- | --- |
| `id` | Local primary key. |
| `work_period_id` | Nullable period foreign key for evidence awaiting assignment. |
| `screenpipe_instance_id` | Stable identity of the source recording store, not a hostname alone. |
| `content_type`, `external_id` | Provider record type and identity, such as a frame reference. |
| `tag_target_id` | Nullable foreign key to the canonical provider target, once its mapping is verified. |
| `recorded_at`, `ingested_at` | Observation time and local import time. |
| `app_name`, `window_name`, `url` | Optional observed context, stored separately. |
| `validation_status`, `validated_at` | Lawyer source-review state and timestamp. |
| `availability_status`, `availability_checked_at` | Retrieval availability and last check. |

Use a unique key on `(screenpipe_instance_id, content_type, external_id)` to prevent duplicate imports. IDs from separate Screenpipe stores must not collide. The instance identity format remains part of the adapter contract. Source references are external identifiers, not foreign keys into Screenpipe's database.

The source record key is not necessarily the provider's tag-operation key. Resolve that mapping before a tag write. Several records, including different content types, can refer to one target. When `tag_target_id` is present, source ownership must agree with the target's authoritative `work_period_id`; a source cannot independently select a different period or case. An unresolved mapping must remain visibly unsynchronized.

Fetch recordings through the Screenpipe API. An unavailable or deleted recording does not delete reviewed time or erase the source's review history. Keep the reference and availability state. Do not assume every failed fetch proves deletion. Multiple screenshots attached to one period must not multiply its duration.

### `tag_targets`

This small proposed table separates imported record identity from the actual provider object that receives tags.

| Field | Purpose or constraint |
| --- | --- |
| `id` | Local primary key. |
| `screenpipe_instance_id`, `target_type`, `target_id` | Unique canonical identity used by the provider tag API. |
| `work_period_id` | Nullable authoritative owner; derive the desired case through this period. |
| `target_revision` | Monotonic version of target ownership and desired TimeKeeper tags. |

All aliases of a target must agree with its owner. Changing the owner or its desired case increments `target_revision`. Do not compare revisions from two different periods as if they were one sequence. A move supersedes previous delivery intents and reconciles this single target to the new desired tags. The exact provider target mapping remains an adapter verification requirement.

### `settings`

| Field | Purpose or constraint |
| --- | --- |
| `id` | Single local settings record; constrain to a fixed identity. |
| `global_hourly_rate` | Nonnegative fallback rate. |
| `currency` | Currency configuration; change policy remains open. |
| `workspace_id` | Stable local identity used in TimeKeeper-owned Screenpipe tags. |
| `updated_at` | Record timestamp. |

Implemented storage proposal: `hourly_rate_cents`, `global_hourly_rate_cents`, and `applied_hourly_rate_cents` are nonnegative SQLite `INTEGER` values in minor currency units. This avoids floating-point rate storage; currency policy and monetary rounding remain open decisions. A case rate of zero is valid and must not trigger the fallback. The corresponding implemented columns are `cases.hourly_rate_cents`, `settings.global_hourly_rate_cents`, and `work_periods.applied_hourly_rate_cents`. The retained demo freezes the applied rate when a period becomes billed; this implementation does not settle the full billed-period edit policy.

### Implemented demo extensions

Migrations 2 and 3 add the mockup features separately agreed on 2026-10-17: client code and hourly rate; case category, court number, opposing party, hourly or flat-fee mode, flat fee and budget; weighted markers and client rules; task types, per-period billability and exclusion; expenses, invoices and frozen invoice lines; audit events, source exports and Jev reviews. Migration 4 adds `demo_block_periods`, the compatibility link from an imported block to its work period, so recovery does not infer identity from colliding numeric IDs. `work_periods` keeps precise duration and revisions without a calculated amount. `invoices` stores the supplied issued snapshot and totals, and `invoice_lines` stores billed minutes, the applied rate, amount and selected period IDs. The imported mockup tables remain for demo catalogue and recognition compatibility; [schema implementation](implementation/schema.md) distinguishes those records from the canonical model. This extension records implementation and does not redefine the agreed core rules or decide the open provider behavior.

## Technical persistence

Keep these small records in the same local database. They support recovery and do not imply a separate service or general queue framework.

| Record | Minimum proposed contents | Integrity requirement |
| --- | --- | --- |
| `processed_commands` | Producer identity, command ID, payload fingerprint, session ID, command kind, status, prerequisite ID, terminal result, timestamps. | Unique producer/command pair. Distinguish pending from applied or rejected. Only terminal outcomes are final replay results. A changed payload under the same ID is rejected. |
| `pending_questions` | `question_id`, `session_id`, `work_period_id`, `expected_assignment_revision`, status, response command ID and result. | Unique question ID and session/period/assignment-revision tuple. An answer targets this period and revision only. Duplicate answers reuse the result; stale answers produce a visible conflict. |
| `reconstruction_conflicts` | Conflict ID, protected period ID, expected revision, proposed boundaries and source references, status. | Store a proposal separately from counted periods; never include it in totals before explicit resolution. |
| `retrieval_progress` | Session ID, Screenpipe instance, requested interval, pagination cursor/checkpoint, last completed range, retrieval status. | Advance progress with committed detail records. A partial or failed read must not claim complete coverage. |
| `assignment_deliveries` | Canonical tag target ID, target revision, intended TimeKeeper tags, status, attempts, next retry, acknowledgement. | Unique target/revision delivery. Deduplicate and serialize by the canonical target, not a source alias or period ID. |

Commands, domain changes, and delivery intent must commit atomically where they form one local operation. Pending commands wait for known prerequisites and are reconsidered when those prerequisites arrive. Pending status is not a successful transition and must not be cached as an applied result. Unknown or conflicting session references must not create or reopen a session implicitly.

A pending question retains its original session, period, and expected assignment revision. A delayed answer cannot target the currently active period by default. Apply a valid answer to its original period only. Period closure and evidence imports can change the record revision without changing this assignment guard. A new assignment, superseded question, or replacement of the period invalidates the answer. Record a conflict and request a fresh decision without overwriting newer work. Deduplicate question creation and response commands so retries do not repeat prompts or writes.

Before each tag mutation, verify current target ownership, revision, and desired tags. Serialize ownership changes and provider operations per canonical target, including every source alias. Prevent an old owner from completing writes after a committed move; defer the move until any prior target operation is resolved, then reconcile the new revision. Remove only obsolete TimeKeeper-owned tags. Verify the same target and revision before acknowledging synchronization; a stale acknowledgement cannot mark the new owner synchronized.

These records cannot receive commands while the Node backend is stopped. The mechanism that preserves an explicit Screenpipe end command during that interval remains unresolved. Do not imply that a local command table alone solves delivery outside the running application.

## Duration, rounding, and consolidation

A screenshot proves an observation at a time. It does not prove continuous work until the next screenshot. Source count and application uptime are not duration measurements. The method for deriving work intervals from reviewed Screenpipe memory remains undefined. Do not silently count gaps, subtract inactivity, or invent a sampling interval.

The lawyer can correct time. An override takes precedence over a detected duration. Preserve unrounded observation times, boundaries, and any detected duration. The interface calculates effective minutes and summaries from the complete detail set, using reviewed memory and retained corrections. SQLite and the backend do not calculate aggregate summaries.

Round upward only after combining the relevant effective durations. For the proposed millisecond representation, the interface uses `ceil(sum(effective_duration_ms) / 60000)`. An exact whole-minute total stays unchanged. A positive remainder rounds the total up. Do not round individual periods or persist rounded totals in place of precise detail records.

Two periods of 20 seconds total 40 seconds and display as 1 minute, not 2. Compute case, client, and overall totals independently from their underlying periods; do not add already-rounded subtotals. Unknown duration remains unknown, and an incomplete input set must not appear as a complete total. The effect of rounded minutes on monetary calculations remains to be defined.

## Integrity and recovery examples

1. Start a session, close TimeKeeper, and reopen it: retain the same active session and existing corrections.
2. End at 12:00 while the backend is stopped: after command recovery, accept later imports recorded before 12:00 within the session; reject attempts to extend its end.
3. Start while a session is active: return the active session. Retry its end after it has ended: retain the original end boundary. A known end that arrives before its start stays pending and is applied only after that start.
4. Open an unknown folder: preserve an unresolved period, ask the lawyer, and assign only after resolution.
5. Leave and return to a case: create two periods that reference the same case.
6. Correct the effective case or duration: invalidate its former time validation. Validate the correction, then replay identical evidence or update a detected duration hidden by the override: preserve that validation.
7. Lose access to a source: keep the period and its validation history while showing source unavailability.
8. Change the case rate: preserve any captured rate snapshots; the snapshot capture rule must be resolved first.
9. Receive reconstruction that would split a corrected or validated period: preserve it and create a conflict proposal that adds no time to totals.
10. Answer an old unknown-folder question after moving to another period: update only the original target if its question is current and expected assignment revision still matches. Ordinary closure or new evidence must not reject this answer. Otherwise report a conflict. Repeating the answer must not write again.
11. Import two source records that share a provider tag target: store their distinct source identities, but keep one authoritative owner and one target delivery sequence. An old owner's retry or acknowledgement cannot supersede the new owner.

## Decisions still required for dependent behavior

- Folder identification, case-reference uniqueness, and unmatched-evidence association.
- Duration derivation and overlap handling.
- Time/source review states, validation prerequisites, manual entries without sources, and the treatment of edits to billed periods.
- Rate snapshot timing, monetary rounding, and which states contribute to each displayed total. Exact integer-cent rate storage is implemented as a proposal. Advanced currency behavior is deferred.
- Off-app command durability, command contracts, and concrete retrieval checkpoints.
- Final SQL constraints, supported deletion/archive behavior, audit-history requirements, and indexes.

Do not cascade-delete sessions, periods, or evidence when a client or case is removed. Prefer archival for referenced catalogue records; finalize deletion and retention rules before implementation. Validate revisions and relationships in application services as well as database constraints.

Return to the [requirements](REQUIREMENTS.md), [architecture](ARCHITECTURE.md), or [README](../README.md).
