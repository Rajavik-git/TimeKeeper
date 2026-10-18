# TimeKeeper requirements

This document owns business rules, use cases, and open product decisions. The user's latest explicit decisions take precedence. The local session, work-period, review, and billing core is implemented. MCP/JEV workflows and recovery consumers are implemented in source. Native release and selected-provider acceptance remain incomplete.

Normal startup creates an empty workspace. Fictional records require explicit test fixtures or authorized, opt-in comparison previews. The [setup guide](SETUP.md) covers environment checks and sample tooling.

See [Architecture](ARCHITECTURE.md) for component ownership, [Data model](DATABASE.md) for storage, and [Screenpipe research](SCREENPIPE_INTEGRATION.md) for provider evidence and verification gaps.

## Purpose and scope

TimeKeeper helps lawyers review working time by client and case using Screenpipe's recorded memory. The desktop application targets macOS and Windows with Tauri, React, a local Node.js backend, and a separate SQLite database.

The MVP includes client and case configuration, work periods, source review, time correction and validation, billed/unbilled status, and interface summaries. Inactivity detection and idle-time subtraction are excluded.

The 2026-10-17 team decision retains pre-invoices, numbered deposit and final invoices with frozen lines, expenses, disbursements, VAT, client rates, flat fees, budgets with an 85% alert, and client rules. These extensions do not define capture, duration reconstruction, or additional billing rules. Monetary rounding and historical-rate snapshots remain proposals where identified below.

Reusable folder learning, chat-calculated summaries, and advanced currency behavior are deferred. Chat retrieves application details only.

Current source also connects an opt-in history-proposal workflow. Generation creates drafts from imported evidence; explicit lawyer acceptance supplies worked duration and creates an unvalidated period. [API D14](API.md#d14-history-proposals-and-explicit-acceptance) records this source extension and its verification limits. It does not settle automatic duration derivation or the separate protected-period reconstruction policy.

## Agreed business rules

### Sessions and desktop lifecycle

- Screenpipe recording boundaries and explicit Start and End commands start and end TimeKeeper sessions through the same application commands. [API D7](API.md#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe) defines the recording-link behavior and verification limits.
- Start launches or activates TimeKeeper and waits for service readiness. Only one session may be active per workspace. Repeated or distinct starts return its ID without resetting its start boundary.
- Closing the main window hides the shell and leaves the API running. Tray Quit stops the desktop application and its owned release API. Both preserve the session and active period. Closing, quitting, or reopening establishes no work-time boundary.
- An explicit End command or recording-link End closes the target session and active period at the effective timestamp. Explicit End does not stop Screenpipe recording.
- End identifies its target session. Repeated ends preserve the first applied boundary. A missing or unknown target returns a visible no-active-session or not-found result without creating records.
- If end arrives before its known pending start, retain it as pending until start applies. Do not acknowledge completion before applying the prerequisite.
- During recovery, apply known causal prerequisites first. A new start after a pending end creates a separate session. If order is unknown, report pending or conflicting state instead of guessing from arrival order.
- End must remain deliverable while TimeKeeper is closed. Durable delivery remains undefined. A stopped API or MCP service cannot receive commands.
- Reopening reconciles the same session from available history, preserves corrections, and deduplicates evidence.
- Ended sessions accept recovered evidence only within their recorded boundaries. Recovery cannot extend or reopen them. Later sessions have separate identities.

### Cases and work periods

- Opening a known case folder establishes the active case until another folder transition. Folder identification remains undefined. Client names and references are possible inputs only.
- Ordinary app or tab switches do not prove a case change. Ambiguous ordinary content preserves the active case. Detection must also consider folder changes within one application.
- An unknown folder creates an unresolved period and requires the lawyer's answer. Do not retain the previous case for that period, invent an assignment, or create a case automatically.
- Bind each question and answer to `question_id`, `session_id`, `period_id`, and `expected_assignment_revision`. A delayed answer resolves its original period without changing a newer active case. Repeated answers have no additional effect. Period closure and evidence imports do not invalidate this guard. A newer assignment, superseded question, or replacement of the target period makes the answer stale. Report a conflict instead of overwriting that change.
- Returning to an existing case creates a new period starting at zero. Preserve earlier periods and totals.
- Each period owns its case assignment, time correction, time validation, and billing status. Derive its client from the case.
- A case correction affects only the selected period and its sources. Historical corrections preserve the current active case.
- Recovery must not automatically split corrected or validated periods. Preserve the original and its overrides. Flag the proposed reconstruction for review without counting replacement time alongside the original.
- JEV can assist ambiguous decisions among existing cases. It cannot invent IDs or validate time for the lawyer. A manual correction takes precedence over later automatic results and retries.

Time validation requires a finished period whose start belongs to a past local calendar day. A period starting yesterday and ending today belongs to yesterday. Running periods cannot be validated. Removing validation remains permitted with its revision guard. Direct and atomic bulk API operations enforce the same rule.

JEV is the sole active automatic transition producer. Native recognition remains in an inactive source backup. A JEV result must carry the active-period and assignment-revision snapshot captured before inference. A newer lawyer assignment rejects it; a proposed split of a duration-corrected or validated period creates a reconstruction proposal without changing counted time.

### Evidence, duration, and rounding

- Retrieve captured evidence through Screenpipe's API. Do not read Screenpipe database files directly or create another recorder.
- A screenshot proves an observation at its recorded timestamp, not continuous work. Duration derivation remains undefined.
- Consolidation uses reviewed Screenpipe memory and preserves time overrides. Application uptime and downtime do not establish work.
- Preserve source timestamps and detected precision. Store duration overrides separately so reconciliation cannot replace them.
- Express working time in minutes. Apply any lawyer override, sum the precise effective durations, then round the combined total upward to whole minutes. Do not round individual periods before summing.
- Calculate each displayed grouped total from its underlying precise durations. Do not sum rounded subtotals. For example, two 20-second periods total 40 seconds and display as one minute.
- Missing recordings produce a visible coverage gap. Do not treat missing evidence as zero work, inactivity, or proof of continuous work.
- Keep source availability separate from source validation. A deleted or unavailable Screenpipe recording must not delete a reviewed work period or its time correction.

### Review, billing status, and rates

- The lawyer can review sources, correct case or time, and validate time. Any effective case or duration change requires time validation again. Identical replay and detected changes masked by an unchanged override preserve validation.
- Source validation, time validation, and billed/unbilled status are separate. Validating one must not implicitly change another.
- The lawyer can mark individual work periods as billed or unbilled. Marking billed requires an assigned case and validated time. This does not generate an invoice. Invoice-linked periods cannot be unbilled because invoice reversal remains undefined.
- The non-billable reason **No charge** means work the lawyer chooses not to charge. Its retained storage and API value is `offered`. It does not imply pro bono work, a written-off invoice, or payment. Unbilled work may still be charged later; excluding a period does not select this reason.
- Use the case hourly rate, then client rate, then global rate. An explicit zero is valid. Historical entries require a fixed applied rate, but the snapshot boundary remains open. The retained implementation captures the effective rate and configured currency when marking a period billed.
- Unknown duration or unresolved case pricing keeps fee estimates incomplete. Show the known subtotal separately. Never substitute elapsed application time for work duration.
- React calculates summaries from detailed API records. SQLite and the backend store and validate details without calculating summary totals. The interface must identify incomplete input coverage.

### State transitions

| Event                                    | Time validation | Billing status                        | Applied rate                    |
| ---------------------------------------- | --------------- | ------------------------------------- | ------------------------------- |
| Lawyer validates time                    | Validated       | Unchanged                             | Snapshot boundary remains open. |
| Effective case or duration changes       | Requires review | Billed-edit rule remains open.        | Repricing remains open.         |
| Replay leaves effective values unchanged | Unchanged       | Unchanged                             | Preserve the rate.              |
| Lawyer changes billed/unbilled status    | Unchanged       | Changes for the selected period only. | Snapshot boundary remains open. |

Source validation remains separate. Future billed-edit and repricing rules remain open. Current safeguards require independently billed periods to be unbilled before correction and lock periods linked to issued invoices.

### Comparisons and budget indicators

Show current balances, case counts, and client comparison bars. Historical percentages require baselines with matching eligibility rules. Historical billing balances and case-count snapshots are unavailable. Explain this once per view in the accessible About these figures disclosure.

Monthly recorded time compares assigned, included work across two explicit local calendar ranges. Clamp the previous cutoff to that month's last valid day. Both ranges use current corrected records, not historical snapshots. Calculate change from precise summed durations and round displayed combined totals only. Unknown duration or incomplete source coverage makes the percentage unavailable. A complete empty range is zero. A zero baseline has no percentage. Higher time alone is not a favorable result.

The recorded-time comparison covers all clients. The Cases summary shows the current total, its scope and date range, and the percentage change when both ranges are complete. There is no client selector for this comparison.

Hourly budget consumption combines frozen invoiced work fees with billable work not linked to an invoice. Include manually billed work at its stored rate and currency. Price unbilled work with the rate cascade. Count each invoice or period once. Exclude VAT, expenses, disbursements, excluded periods, and non-billable work. Cases and Billing use the same calculation and evaluate the 85% warning before rounding.

Budget completeness is separate from source availability. Known effective time keeps its value when sources become unavailable. Unknown duration, missing historical pricing or frozen fees, and incompatible historical currency prevent an exact ratio. Do not substitute current rates or invent conversion. Show known amounts as partial information.

For flat-fee cases, compare billable time valued at the current client or base rate with the agreed flat fee. Label this Estimated hourly value / Agreed flat fee. It does not measure invoicing or payment and does not change rate or invoice snapshots.

Issued invoices and CSV exports use read-only saved lines, totals, and currency without repricing. Missing currency remains explicit and does not inherit the current workspace currency.

### Screenpipe interaction

- Screenpipe owns the workflow after a trigger. Its workflow reads memory and submits scoped commands through TimeKeeper MCP and the application API. The Node backend validates and persists those commands.
- Screenpipe chat queries application details through read-only MCP tools and the API when those services are available.
- Return resolved case associations to Screenpipe for the affected evidence. Track pending or failed synchronization, and confirm synchronization only after verification. A chat answer alone is not proof of stored assignment.
- Record enough identity and revision information to prevent duplicate commands, duplicate evidence, stale automatic updates, and synchronization loops.
- Settings provides a Screenpipe connection test, a manual source-import action, and synchronization status. The connection test verifies authenticated read access without importing evidence or starting a session. Manual and automatic imports use the same bounded, serialized importer.
- Show missing configuration, authentication failure, partial import, and absence of sessions separately. Report the most recent batch counts and last successful batch since backend startup. A successful batch does not prove that all provider history is complete. Connection settings remain backend-owned; the interface does not store credentials.
- Activity displays all source references saved in TimeKeeper, including references without a work period. Users can filter and page through the complete saved list without running JEV. Source references do not create worked time, change case assignments, or enter billing totals by being displayed.
- Source imports retain a literal excerpt of up to 1,000 characters and observed app and window names of up to 300 characters each when available. These fields describe source evidence, not completed work. They remain local to TimeKeeper and do not replace the lawyer's work-period description. Existing nonblank content remains unchanged during replay.
- A source with no period can attach later to one existing period that contains its timestamp in the same unambiguous session. Overlapping matches remain unlinked. A transition timestamp belongs to the next period; the final session-end timestamp can belong to its final period. Existing attachments and corrections remain unchanged. Linking evidence changes no period revision, case, duration, validation, billing status, or pending question.

### Work-period proposals from history

- The lawyer can request proposals for a selected session and a range of up to one hour. Generation uses imported Screenpipe evidence and requires successful retrieval coverage for that range. It creates drafts only, including when the session has no periods.
- Screenpipe runs the requested workflow. JEV judges existing cases using the configured permitted fields. Every distinct permitted context is considered; repeated context can reuse its judgment. Conflicting observations at the same timestamp remain unresolved. App switches alone do not establish a case transition.
- Proposals show observation boundaries, editable descriptions, source references, and uncertainty. Descriptions initially use observed window or app names. Missing evidence remains explicit. A gap above one minute separates proposal windows and flags the gap; it does not establish inactivity or subtract worked time.
- The lawyer must enter a positive worked duration before accepting a proposal. Do not prefill elapsed observation time. Acceptance stores that duration as a lawyer override, leaves detected duration unknown, and creates a finished, unvalidated, unbilled period. An unresolved case creates a revision-bound question.
- Acceptance requires a current proposal revision, unchanged evidence and case catalogue, valid session bounds, and no overlap with any existing period in that session. It never splits or replaces an existing period or changes the active period. Previously accepted siblings from the same unchanged generation remain compatible.
- Sources attach only when previously unlinked and inside the accepted period. Source validation remains unchanged. Identical acceptance replay returns its original result without creating another period; changed reuse conflicts.
- Missing configuration, failed dispatch, uncertain delivery, stale evidence, expired execution, and oversized input remain visible. A workflow-start acknowledgement does not mean proposals are ready. Drafts never enter worked-time or billing totals.

## MVP use cases

| Use case                            | Expected result                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Configure clients, cases, and rates | A case belongs to one client and uses the case, client, then global hourly rate cascade.                                            |
| Start through Screenpipe            | TimeKeeper launches and one session starts after readiness.                                                                         |
| Work on a known case                | Recorded activity supports a work period assigned to that existing case.                                                            |
| Switch applications within a case   | The active case remains unchanged unless a case-folder transition is detected. An unknown destination creates an unresolved period. |
| Open an unknown folder              | A period remains unresolved while the lawyer identifies the case.                                                                   |
| Return to an existing case          | A new work period starts without duplicating the case or resetting earlier time.                                                    |
| Close and reopen TimeKeeper         | The session survives, and recorded history is reconciled without duplicate periods or lost corrections.                             |
| End through Screenpipe while closed | The explicit end timestamp survives until reconciliation and bounds the recovered activity.                                         |
| Review recorded sources             | The lawyer can inspect available evidence and validate sources separately from time.                                                |
| Correct a period's time or case     | The correction survives replay, and time requires validation again.                                                                 |
| Review totals and billing status    | React calculates summaries and shows each period's billed/unbilled status.                                                          |
| Query through Screenpipe chat       | Read-only tools retrieve application details through MCP and the API when available.                                                |

## Acceptance examples

Local tests cover parts of these examples. Screenpipe and native acceptance remain pending.

### First complete journey

1. Start through Screenpipe at 09:00 on case A. Preserve one session and its start boundary.
2. Open an unknown folder at 10:00. Create an unresolved period and a question bound to its session, period, and assignment revision.
3. Open known case B at 10:15. Preserve the unresolved period and start B's period.
4. At 10:20, identify the earlier folder as existing case A. Resolve only that period, preserve current case B, and create no case.
5. Quit TimeKeeper from the tray at 11:00. Its owned services stop but the session stays active. End that session through Screenpipe at 12:00.
6. Reopen at 14:00. Recover the same session and its 12:00 boundary through durable delivery. Review evidence within the boundary without inferring work from session duration or downtime.
7. On the next local calendar day, correct the earlier A period to 12 minutes and validate it. Replay preserves the correction and validation when effective values are unchanged.
8. Sum precise effective durations, including the override, and round the total upward. Show coverage gaps and exclude unaccepted replacement time. Preserve separate source validation and billing status.

The folder-identification, duration-derivation, and closed-app delivery mechanisms must be defined before this journey can pass.

### Failure and recovery examples

1. Repeat a start, then send a distinct start while active. Return the same session ID and start boundary. Duplicate source imports add no time.
2. End at 12:00, then repeat end with 12:05. Preserve 12:00. Missing or unknown targets produce visible errors without phantom records.
3. Deliver end before its known pending start. Keep end pending until start applies, then end that session. Pending receipt is not completion or proof of closed-backend delivery.
4. Answer an unknown-folder question twice. The duplicate has no effect. Closure and evidence imports preserve the guard. A newer assignment or superseded question rejects the answer without overwriting the period or changing the active case.
5. App switches and ordinary ambiguous content preserve case A. A detected unknown-folder transition instead starts an unresolved period.
6. Assign B and override duration to 12 minutes. Delayed inference cannot undo the correction. Detected changes masked by the override preserve validation. Effective case or duration changes invalidate it.
7. Recovery finds a transition inside a corrected or validated period. Preserve the original and override. Flag reconstruction for review without counting candidate time alongside it.
8. Source validation, time validation, and billing changes do not change one another.
9. A reviewed recording becomes unavailable. Preserve its reference, period, and correction. Show unavailable evidence and incomplete coverage.
10. End at 12:00. Reconcile delayed 11:45 evidence within the session. Exclude 12:15 evidence without extending the boundary.
11. Observations 30 seconds apart do not prove continuous work. Two established 20-second periods total 40 seconds and display as one minute.
12. Apply the case, client, then global rate. Preserve explicit zero and the historical rate and currency after the agreed snapshot boundary.
13. Validate a detected 12-minute period without an override. Reconciliation to 15 minutes invalidates time validation. After revalidation, identical replay preserves it.
14. Two evidence aliases map to one provider tag target. Synchronize one agreed assignment. Conflicts block synchronization. Target mapping requires provider verification.
15. Recovery receives a new start dependent on an earlier pending end. Apply end first and create a new session instead of returning the earlier one.
16. An unsaved case or duration correction blocks validation and marking billed until saved or explicitly discarded. Failed saves preserve the draft and block. Never validate or bill a different saved value silently.
17. Opening evidence from a historical review in Cases or Billing preserves the correction draft and originating view. Returning restores that review. Closing or reloading unsaved corrections requires explicit discard.

## Decisions still required

| Decision                                                                                 | Required before                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Folder identification, matching metadata, and case-reference uniqueness                  | Automatic case resolution.                         |
| Duration derivation, gaps, overlapping observations, and manual entries without evidence | Automatic duration calculation.                    |
| When the applied rate becomes fixed and how later corrections affect it                  | Historical monetary totals.                        |
| Source-validation prerequisites and effects of rejected or lost sources                  | Review transition acceptance.                      |
| Whether excluded periods can be time-validated; current UI and API restrictions differ   | Consistent exclusion and validation controls.      |
| Contributing summary states, date-range clipping, and cross-midnight behavior            | Summary calculation acceptance.                    |
| Lawyer resolution of a protected-period reconstruction conflict                          | Applying proposed period splits.                   |
| Editing a billed period and any resulting billing-status transition                      | Billing-status controls.                           |
| Durable end-command delivery while closed, command schemas, and crash recovery           | Session lifecycle implementation.                  |
| Trigger producer, bridge, and assignment acknowledgement on both platforms               | Automatic workflow and Screenpipe synchronization. |
| JEV execution contract and allowed data, local access, retention, and deletion           | Model integration and persisted data handling.     |

Manifests and `src/backend/adapters/sqlite/migrate.ts` record dependency versions and local migrations. Screenpipe release selection, native lifecycle and installed-path acceptance on both platforms, platform migration acceptance, and application-wide backup recovery remain open. The Windows host already defines its sidecar lifecycle and per-user database path. Sample-import backups do not define application-wide recovery.
