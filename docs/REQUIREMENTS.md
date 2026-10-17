# TimeKeeper requirements

This document is the authoritative record of agreed business rules, use cases, and open product decisions. The user's latest explicit decisions take precedence. The repository includes a fictional demo application with an initial session and work-period implementation, a TimeKeeper MCP start tool, and Screenpipe pipes with optional JEV instructions. These requirements do not establish working end-to-end integration.

See [Architecture](ARCHITECTURE.md) for component ownership and integration flows, and [Data model](DATABASE.md) for storage responsibilities and constraints. Provider capabilities and verification gaps remain in the Screenpipe research documents.

## Purpose and scope

TimeKeeper helps a lawyer review working time by client and case using Screenpipe's recorded memory. The project is part of an École 42 and Screenpipe hackathon. The planned desktop application targets macOS and Windows with Tauri, React, a local Node.js backend, and a separate SQLite database.

The MVP includes client and case configuration, work periods, source review, time correction and validation, billed/unbilled status, and interface summaries. Inactivity detection, idle-time subtraction, invoice generation, client rates, and fixed fees are outside scope. UI design is outside the current documentation session.

Reusable folder learning, chat-calculated summaries, and advanced currency behavior are deferred. Chat can retrieve application details; it does not calculate summaries for the MVP.

## Agreed business rules

### Sessions and desktop lifecycle

- The lawyer starts and ends a session through explicit commands in Screenpipe. Start is the manual **Start TimeKeeper** pipe: if a session is already active it changes nothing, otherwise it starts one. End is the manual **End TimeKeeper** pipe: it ends the active session at the press time ([API D7](API.md#d7-the-lawyer-starts-and-ends-a-session-with-a-button-in-screenpipe)).
- Screenpipe can run without TimeKeeper. Starting Screenpipe never starts a session.
- Optional JEV tab-change detection runs only while a session is active. The start command also starts it, or leaves the running one unchanged, and it stops after the session ends. It never starts or ends a session.
- When JEV confirms a real tab change on a context that is still current, the detection sends the result to the session: a different existing case opens an automatic work period at the capture time of the change; no unique existing case opens an unresolved period and asks the lawyer. No change, uncertain or low-confidence answers, and the current case keep the active case. Automatic periods still require the lawyer's time validation ([API D9](API.md#d9-jev-confirmed-tab-changes-become-work-period-transitions)).
- Start launches or activates TimeKeeper and waits for its services before creating the session. A workspace has at most one active session. A distinct start command while one is active returns that session's ID. Repeated or distinct starts must not reset its start boundary.
- Closing TimeKeeper exits the desktop application and its Node backend. The session and active work period remain open. Closing or reopening the application does not establish a work-time boundary.
- Only the explicit Screenpipe end command ends the session. It fixes an effective end timestamp and closes the active period at that boundary. Ending the session does not stop Screenpipe recording.
- End must identify its target session. Repeated end commands preserve the first applied end boundary. A missing target or an unknown session returns a visible no-active-session or not-found result and creates no session or end record.
- If an end command arrives before its known pending start, retain the end as pending until the start is applied. Do not acknowledge the session as ended while its prerequisite is pending. This ordering rule does not establish how commands survive a stopped backend.
- Apply known causal prerequisites before dependent commands during recovery. A new start after a pending end must not be collapsed into the earlier active session. If order cannot be established, report pending or conflicting state instead of guessing from arrival order.
- The end command must remain deliverable while TimeKeeper is closed. The durable delivery mechanism is an implementation decision; a stopped API or MCP service cannot receive the command.
- Reopening reconciles the same session with available recorded history. It must preserve corrections and deduplicate imported evidence.
- An ended session can receive recovered evidence recorded within its boundaries. Recovery must not move the end timestamp or append activity after it. A later session has a separate identity.

### Cases and work periods

- Opening a known case folder establishes the active case. Work stays with that case until another case-folder transition is detected. An unknown destination follows the unresolved-period rule below.
- Folder identification is deferred. Client names and references are possible inputs, not an accepted identification algorithm.
- An ordinary app or tab switch is not proof of a case change. Ambiguous ordinary content must not clear the active case. Folder changes within one application must also be considered.
- An unknown folder creates an unresolved work period and requires the lawyer's answer. Do not silently retain the previous case for that new period, invent an assignment, or create a case automatically.
- Bind each question and answer to `question_id`, `session_id`, `period_id`, and `expected_assignment_revision`. A delayed answer resolves its original period without changing a newer active case. Repeated answers have no additional effect. Period closure and evidence imports do not invalidate this guard. A newer assignment, superseded question, or replacement of the target period makes the answer stale. Report a conflict instead of overwriting that change.
- Returning to an existing case creates a new work period for that case. Each new period starts at zero; previous periods and totals remain intact.
- Each work period has its own case assignment, time correction, time validation, and billing status. Derive its client from the case. Do not store an independent conflicting client assignment.
- A case correction affects the selected period and its sources. It must preserve other periods and must not change the current active case when correcting historical work.
- Reconstruction must not automatically split, merge, or replace a corrected or validated period. Preserve that period, its sources, and its overrides, and flag the proposed reconstruction for review. A reconstruction proposal must not discard the override or copy or distribute it across replacement periods. Do not count candidate replacement time alongside the original period.
- JEV is optional and used only by the Screenpipe workflow. Installing and starting TimeKeeper must not require JEV, a TypeSafe API key, or the TypeSafe SDK. When enabled, JEV can assist ambiguous decisions among existing cases. It cannot invent IDs or validate time for the lawyer. A manual correction takes precedence over later automatic results and retries.
- When JEV is configured, the workflow asks it whether work stayed on the active case, switched cases, or is uncertain. Supply the authoritative active case, a previous observation associated with it, and the new observation. A candidate selection alone does not establish a switch. The workflow must not require a switch to be established before asking JEV to assess it.
- Missing comparison evidence or conflicting model results are uncertain, not confirmation of continued work. Ordinary uncertainty must not change the assignment. An independently established unknown-folder transition still requires an unresolved period and the lawyer's answer. With no active case, case selection is initial assignment, not switch detection.
- After a supported switch, the pipe automatically tries to identify the destination among existing cases. Return a unique supported match to Screenpipe without an MCP write or direct application API write. Identification does not save the assignment, validate time, or advance the application's authoritative active case. The persistence path for matched cases remains open.
- Send an unresolved-switch request through MCP only when a completed lookup and valid assessment cannot identify a unique destination. This includes an independently established unknown-folder switch without JEV. The application owns the unresolved period and lawyer question. Read-only MCP case queries remain allowed. Uncertain transitions, initial assignment, incomplete lookup, and operational failures do not trigger this switch handoff. Missing MCP support must remain visibly undelivered.

### Evidence, duration, and rounding

- Retrieve captured evidence through Screenpipe's API. Do not read Screenpipe database files directly or create another recorder.
- A screenshot proves an observation at its recorded timestamp. It does not, by itself, prove continuous work between screenshots. Source count is not a duration measurement. Do not multiply a period's duration by its number of sources. The rule for deriving duration from observations remains undefined.
- Consolidation uses reviewed Screenpipe memory and preserves the lawyer's time overrides. Application uptime and elapsed time while the application is closed do not establish recorded work.
- Preserve source timestamps and the precision of detected values. Store the lawyer's duration override separately so later reconciliation cannot replace it.
- Express working time in minutes. Apply any lawyer override, sum the precise effective durations, then round the combined total upward to whole minutes. Do not round individual periods before summing.
- Calculate each displayed grouped total from its underlying precise durations. Do not sum rounded subtotals. For example, two 20-second periods total 40 seconds and display as one minute. A zero total remains zero.
- Missing recordings, missing duration evidence, and missing API pages produce a visible coverage gap. Do not present an incomplete input set as a complete total. Do not treat missing evidence as zero work, inactivity, or proof of continuous work.
- Keep source availability separate from source validation. A deleted or unavailable Screenpipe recording must not delete a reviewed work period or its time correction.

### Review, billing status, and rates

- The lawyer can review sources, correct a period's case or time, and validate time. Any change to the effective case or duration requires time validation again, regardless of its origin. An unchanged replay preserves validation. A detected-duration change masked by an existing override also preserves validation because the effective duration is unchanged.
- Source validation, time validation, and billed/unbilled status are separate. Validating one must not implicitly change another.
- The lawyer can mark individual work periods as billed or unbilled. This does not generate an invoice.
- Use the case hourly rate when configured. Otherwise, use the global hourly rate. The applied rate must eventually be fixed for historical entries; the point at which this occurs remains open.
- React calculates summaries from detailed API records. SQLite and the backend store and validate details without calculating summary totals. The interface must identify incomplete input coverage.

### State transitions

| Event | Time validation | Billing status | Applied rate |
| --- | --- | --- | --- |
| Lawyer validates the current period | Becomes validated. | Unchanged. | Snapshot timing remains open. |
| Effective case or duration changes | Requires review again, including automatic changes. | Editing a billed period remains an open rule. | Repricing or snapshot changes remain open. |
| Replay leaves effective case and duration unchanged | Unchanged. | Unchanged. | Replay must not select a new rate. |
| Lawyer changes billed/unbilled status | Unchanged. | Changes only for the selected period. | Billing-triggered snapshot timing remains open. |
| Case has no configured hourly rate | Unchanged. | Unchanged. | Use the global rate until a historical snapshot applies. |
| Case has its own hourly rate | Unchanged. | Unchanged. | Use the case rate until a historical snapshot applies. |

Source validation remains separate throughout these transitions. The open billed-edit and rate rules are implementation gates, not permission to choose silent defaults.

### Screenpipe interaction

- Screenpipe owns the workflow after a trigger. Its workflow reads memory and submits authorized scoped commands through TimeKeeper MCP and the application API. For pipe switch results, only unresolved destinations use this write handoff; matched results stay in Screenpipe. The Node backend validates and persists accepted commands.
- Screenpipe chat queries application details through read-only MCP tools and the API when those services are available.
- Return resolved case associations to Screenpipe for the affected evidence. Update assignment metadata without rewriting source recordings. Track pending or failed synchronization, and confirm synchronization only after verification. A chat answer alone is not proof of stored assignment.
- Record enough identity and revision information to prevent duplicate commands, duplicate evidence, stale automatic updates, and synchronization loops.

## MVP use cases

| Use case | Expected result |
| --- | --- |
| Configure clients, cases, and rates | A case belongs to one client and uses its own hourly rate or the global fallback. |
| Start through Screenpipe | TimeKeeper launches and one session starts after readiness. |
| Work on a known case | Recorded activity supports a work period assigned to that existing case. |
| Switch applications within a case | The active case remains unchanged unless a case-folder transition is detected. An unknown destination creates an unresolved period. |
| Open an unknown folder | A period remains unresolved while the lawyer identifies the case. |
| Return to an existing case | A new work period starts without duplicating the case or resetting earlier time. |
| Close and reopen TimeKeeper | The session survives, and recorded history is reconciled without duplicate periods or lost corrections. |
| End through Screenpipe while closed | The explicit end timestamp survives until reconciliation and bounds the recovered activity. |
| Review recorded sources | The lawyer can inspect available evidence and validate sources separately from time. |
| Correct a period's time or case | The correction survives replay, and time requires validation again. |
| Review totals and billing status | React calculates summaries and shows each period's billed/unbilled status. |
| Query through Screenpipe chat | Read-only tools retrieve application details through MCP and the API when available. |

## Acceptance examples

These examples define required behavior. No acceptance checks have run.

### First complete journey

1. Start through Screenpipe at 09:00 and work on case A. Preserve one session and its start boundary.
2. Open an unknown folder at 10:00. Start an unresolved period and ask the lawyer with the question's session, period, and assignment-revision references.
3. Open known case B at 10:15. Start a period for B and preserve the unresolved earlier period.
4. At 10:20, answer that the earlier folder belongs to existing case A. Resolve that original period to A without changing the current case B. Do not create a new case.
5. Close TimeKeeper at 11:00. Its services stop while the session remains active. Send the explicit end command for this session through Screenpipe at 12:00.
6. Reopen at 14:00. Recover the same session and its 12:00 end boundary through the selected durable delivery mechanism. Review available evidence before that boundary. Do not infer three hours of work from the session span. Do not derive work duration from application downtime alone.
7. Correct the resolved earlier A period's time to 12 minutes, then validate it. A replay must preserve the correction and validation if its effective case and duration are unchanged.
8. Calculate the selected summary from precise effective durations, including the 12-minute override. Sum first and round the combined total upward. Show missing coverage and omit unaccepted replacement candidates from counted time. Source validation and billing status remain separate.

The folder-identification, matched-case persistence, duration-derivation, and closed-app delivery mechanisms must be defined before this journey can pass.

### Failure and recovery examples

1. Deliver the same start twice, then a distinct start while that session is active. Return the active session ID each time without changing its start boundary. Importing a recorded source twice must not add time.
2. End a session at 12:00, then deliver another end with 12:05. Preserve 12:00. An end without a target or for an unknown session produces a visible error and no phantom state.
3. Deliver an end before its known pending start. Retain it as pending without claiming completion. After the start applies, process the end for that session. This example does not verify delivery while the backend is closed.
4. Answer an unknown-folder question twice. The second delivery has no effect. Closing the period or importing evidence does not invalidate the answer. If a newer assignment already resolved the target period or the question was superseded, reject the stale answer without overwriting it or changing the current active case.
5. Switch applications within case A. Keep A. A detected unknown-folder transition starts an unresolved period. Ordinary ambiguous content does not clear A.
6. The lawyer assigns a period to B and overrides its duration to 12 minutes. A delayed inference cannot undo the correction. A changed detected duration hidden by the override preserves time validation. An accepted change to its effective case or duration invalidates time validation.
7. Recovery finds a missed case transition inside a corrected or validated period. Preserve the original period and override. Flag a reconstruction candidate for review, and do not add its duration alongside the original in summaries.
8. Validate a source, then validate time. Neither action marks the period as billed. Changing billing status does not validate time or sources.
9. A reviewed recording becomes unavailable. Preserve the source reference, period, and correction. Show unavailable evidence and incomplete coverage.
10. End at 12:00. Reconcile delayed evidence recorded at 11:45 without extending the session. Exclude evidence recorded at 12:15 from that session.
11. Two observations 30 seconds apart do not prove 30 seconds of continuous work. Two established 20-second effective periods total 40 seconds and display as one minute, not two separately rounded minutes.
12. Use the global hourly rate for a case without its own rate. Use an explicit case rate when present. Preserve the historical applied rate once the agreed snapshot boundary is reached.
13. Validate a detected 12-minute period without an override. Reconciliation changes its effective duration to 15 minutes. Require time validation again. Replaying the same 15-minute result after validation must preserve that validation.
14. Two evidence records map to one provider tag target. Reconcile one agreed case assignment for that target. Conflicting assignments block synchronization instead of writing competing tags. Target mapping must be verified before this example can pass.
15. During recovery, a new start depends on an earlier session's pending end. Apply that end first, then create the new session. Do not return the earlier session as if this were a repeated start.
16. Screenpipe chat queries a stored period while TimeKeeper is available. Return the same case ID and validation state shown in the interface.

### JEV continuity assessment

These examples define the optional model workflow's intended behavior. They do not establish model accuracy. The development pipe returns identified matches to Screenpipe and specifies an MCP handoff only for unresolved switches. The application tools required for that handoff are not implemented.

1. Work on case A in a document editor, then research A in a browser. If the evidence supports continuity, report `same_case` and propose no new period.
2. Move from work on A to work on B inside the same application. If the evidence supports the transition and a unique existing B match, report `case_switch` with B identified and `applied: false`. Send no MCP write or direct API write. Do not advance the authoritative baseline to B from this result.
3. A sidebar or quoted document mentions B while the lawyer still works on A. The mention alone must not produce a B switch proposal.
4. Previous evidence is missing, or the observations cannot distinguish A from B. Report `uncertain`. Do not label uncertainty as `same_case` or invent a switch.
5. An unknown-folder transition with no identified destination is independently established after a completed case lookup. Request application handling through the scoped MCP handoff, even if JEV is disabled or previous comparison evidence is missing. The application must create the unresolved period and guarded lawyer question before claiming completion. A model guess cannot override this rule.
6. JEV proposes a switch but its destination selection is A, the active case. Treat the conflicting results as uncertain and send no switch command. A supported switch with no unique destination after a completed lookup follows the MCP handoff for the lawyer's answer, not an assignment to A.
7. The authoritative state has no active case and the new evidence supports B. Return an initial assignment proposal with comparison not evaluated. Do not label it a switch.
8. A result based on revision 7 arrives after a manual correction creates revision 8. Retain revision 7 in the result and reject any stale application attempt. Do not replace the baseline or undo the correction.
9. The candidate lookup fails or has missing pages, or the provider returns an invalid result. Report the failure without sending an unresolved-switch command. Missing data is not evidence that no case matches.
10. An unresolved switch is ready, but no compatible MCP tool is registered. Report the handoff as blocked and not sent. If a dispatched call times out, report unconfirmed delivery instead. Receipt or pending processing must not be described as a created period or question.
11. An initial assignment has no unique match. Report initial assignment as unresolved without using the switch handoff. Same-case and uncertain results also send no switch command.

## Decisions still required

| Decision | Required before |
| --- | --- |
| Folder identification, matching metadata, and case-reference uniqueness | Automatic case resolution. |
| Persisting matched cases when the pipe sends only unresolved switches through MCP | Saved known-case transitions and advancement of the authoritative active-case baseline. |
| Duration derivation, gaps, overlapping observations, and manual entries without evidence | Automatic duration calculation. |
| When the applied rate becomes fixed and how later corrections affect it | Historical monetary totals. |
| Which reviewed or validated periods contribute to each summary | Summary calculation acceptance. |
| Lawyer resolution of a protected-period reconstruction conflict | Applying proposed period splits. |
| Editing a billed period and any resulting billing-status transition | Billing-status controls. |
| Durable end-command delivery while closed, command schemas, and crash recovery | Session lifecycle implementation. |
| Trigger producer, bridge, and assignment acknowledgement on both platforms | Automatic workflow and Screenpipe synchronization. |
| JEV workflow integration and deployment-approved fields, local access, retention, and deletion | Live model requests and persisted data handling. The [pipe workflow](ARCHITECTURE.md#jev-pipe-workflow) does not resolve these deployment decisions. |

Technical versions, packaging, database location, migrations, and backup behavior are also pending. These choices must preserve the agreed rules above.
