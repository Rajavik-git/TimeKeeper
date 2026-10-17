# Remaining design decisions

This review tracks implementation gaps after the accepted architecture review. [Requirements](REQUIREMENTS.md) define agreed behavior. [Architecture](ARCHITECTURE.md) and [database design](DATABASE.md) distinguish the implemented local core from planned integrations. Versioned SQLite migrations and local application tests exist. Screenpipe and native desktop integration remain unverified.

## Decisions needed before dependent implementation

| Priority | Gap                                                                                 | Decision or evidence needed                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Session commands and assignments can arrive while Tauri, Node, and MCP are stopped. | Choose durable command storage outside the app or a controlled relaunch mechanism. Preserve command identity, causal order, effective time, and targeted lawyer answers. A queue inside the stopped app cannot receive them. Pending receipt is not successful application. |
| High     | Screenshots establish observations, not continuous duration.                        | Define interval boundaries, gaps, overlaps, and incomplete coverage. Do not use screenshot count, app uptime, or inactivity subtraction.                                                                                                                                    |
| High     | Folder identification is intentionally deferred.                                    | Define detection and candidate matching. Answers already target a question and unresolved period with an assignment-revision check that tolerates closure and evidence imports. Define detection timestamps without allowing a delayed answer to replace the current case.  |
| High     | Event transport evidence does not establish a working capture-to-skill trigger.     | Pin the Screenpipe release and pass the producer, bridge, and memory-read checks in the event research.                                                                                                                                                                     |
| High     | Source-tag APIs have not been tested with TimeKeeper.                               | Verify evidence-to-target mapping, updates, removal, readback, and native display. Aliases must share one canonical target and assignment. Distinguish unsupported behavior from retryable failure.                                                                         |
| High     | Late evidence can propose different period boundaries.                              | Preserve corrected or validated periods and record a reconstruction conflict. Define the lawyer's conflict-resolution action before implementing splits. Candidate periods must not add time to existing totals.                                                            |
| Medium   | Applied hourly rate timing remains open.                                            | Choose when rate and currency become historical values. Define changes to a billed period and later changes to configured rates.                                                                                                                                            |
| Medium   | Source and time review are separate, but some transitions remain open.              | Decide whether time validation requires validated sources and what rejecting or losing a source changes. Manual creation without evidence is not yet a confirmed use case.                                                                                                  |
| Medium   | Summary selection rules remain incomplete.                                          | Define which validation states contribute to each total, date-range clipping, and cross-midnight display. Upward rounding of the combined total is already decided.                                                                                                         |
| Medium   | Chat cannot use a stopped application API.                                          | Return an unavailable result without fabricated details. Chat-calculated summaries are deferred; no background service is implied.                                                                                                                                          |
| Medium   | Native packaging, final persistence locations, and backup recovery remain open.     | Bundle Node, choose the installed database location and backup strategy, and verify migrations, startup, shutdown, and restart on both platforms. Local schema migrations already exist.                                                                                    |
| Medium   | Hosted JEV may receive recorded context.                                            | Define permitted fields and deployment choice before sending source data.                                                                                                                                                                                                   |

## Resolved in the accepted review

The model now uses sessions and independently assigned work periods. The task/subtask hierarchy is a historical reference. A period derives its client from its case. Unknown folders leave unresolved periods. Returning to an existing case creates another period.

Lawyer corrections override detected duration and survive replay. Validation refers to the effective case and duration. Changes from any origin invalidate it; identical replay and changes masked by an unchanged override preserve it. Billing status belongs to each period. Source validation remains independent. The [requirements transition table](REQUIREMENTS.md#state-transitions) separates agreed transitions from open billed-edit and rate-snapshot rules.

Closing the desktop application does not end a session. Explicit end commands fix the boundary, while later reconciliation may fill records inside it. Rounded totals use precise underlying durations and apply ceiling only after summing the selected group.

Only one session is active per workspace. Additional starts return it without changing its start. Repeated ends preserve the original applied end. End commands waiting for a known start remain pending. Commands with no valid target cannot create a phantom session.

Unknown-folder answers identify their question and target period. A delayed answer resolves that period without replacing a newer active case. Stale answers report a conflict. Reusable folder learning is deferred.

Canonical provider tag targets have one owning period and assignment across all evidence aliases. Synchronization deduplicates and serializes by that target. A separate queue service is not part of the MVP. Chat-calculated summaries and advanced currency behavior are deferred.

## Implementation checkpoints

1. Resolve the stopped-app command contract and duration reconstruction rule.
2. Verify the Screenpipe trigger, memory, MCP, and source-tag integration contracts.
3. Finalize database fields, integrity constraints, and API payloads against the requirements.
4. Implement the requirements journey: start, case A, unknown folder, case B, delayed answer, close, end through Screenpipe, reopen, correct, validate, and calculate the total.
5. Verify reordered commands, delayed answers, validation changes during replay, protected-period conflicts, target aliases, and missing sources.
6. Verify grouping and combined-total rounding with precise durations.
7. Run native desktop acceptance on macOS and Windows.

The acceptance examples are maintained in [REQUIREMENTS.md](REQUIREMENTS.md). Provider evidence remains in [integration research](SCREENPIPE_INTEGRATION.md) and [event research](SCREENPIPE_EVENTS.md).
