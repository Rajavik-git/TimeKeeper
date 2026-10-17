# Remaining design decisions

This document tracks unresolved decisions and implementation gates. [Requirements](REQUIREMENTS.md) define agreed behavior. [Architecture](ARCHITECTURE.md) and [database design](DATABASE.md) define its intended implementation. The repository has a demo API with canonical sessions, a TimeKeeper MCP start tool, a disabled JEV pipe, and a read-only JEV tab-change check. End-to-end Screenpipe integration does not exist.

## Decisions needed before dependent implementation

| Priority | Gap | Decision or evidence needed |
| --- | --- | --- |
| Critical | Session commands and assignments can arrive while Tauri, Node, and MCP are stopped. | Choose and verify durable command storage outside the app or a controlled relaunch mechanism against the [session lifecycle rules](REQUIREMENTS.md#sessions-and-desktop-lifecycle). |
| High | Screenshots establish observations, not continuous duration. | Define interval boundaries, gaps, overlaps, and incomplete coverage within the [evidence and duration rules](REQUIREMENTS.md#evidence-duration-and-rounding). |
| High | Folder identification remains unverified. | The [JEV pipe workflow](ARCHITECTURE.md#jev-pipe-workflow) now requests a continuity or switch assessment. Define evidence requirements, candidate matching, and effective timestamps before treating its proposals as established transitions. Apply the [case and work-period rules](REQUIREMENTS.md#cases-and-work-periods). |
| High | Matched cases remain in Screenpipe because the pipe sends only unresolved switches through MCP. | Define how an identified match becomes a saved application assignment. Until then, keep `applied: false` and the authoritative active case unchanged; repeated detection of the same switch remains possible. Do not add an implicit write path. |
| High | The read-only TimeKeeper tools the pipe needs do not exist: active case, candidate cases, target period, assignment revision, and the previous observation tied to that revision. | Define and implement these read contracts. Until then every pipe run stops at `blocked` before JEV, so the JEV assessment cannot be exercised end-to-end. |
| High | The unresolved-switch MCP tool does not exist. | Define the scoped command and acknowledgement, target and revision checks, effective boundary, unresolved period, and guarded lawyer question. Distinguish missing-tool, unconfirmed-delivery, pending, conflict, and completed outcomes. |
| High | Event transport evidence does not establish a working capture-to-skill trigger. | Pin the Screenpipe release and pass the producer, bridge, and memory-read checks in the [event research](SCREENPIPE_EVENTS.md). |
| High | Source-tag APIs have not been tested with TimeKeeper. | Verify evidence-to-target mapping, updates, removal, readback, and native display against the [synchronization contract](ARCHITECTURE.md#screenpipe-assignment-synchronization). Distinguish unsupported behavior from retryable failure. |
| High | Late evidence can propose different period boundaries. | Define the lawyer's conflict-resolution action before implementing splits under the [protected-period rule](REQUIREMENTS.md#cases-and-work-periods). |
| Medium | Applied hourly rate timing remains open. | Choose when rate and currency become historical values. Define changes to a billed period and later changes to configured rates. |
| Medium | Source and time review are separate, but some transitions remain open. | Decide whether time validation requires validated sources and what rejecting or losing a source changes. Manual creation without evidence is not yet a confirmed use case. |
| Medium | Summary selection rules remain incomplete. | Define which validation states contribute to each total, date-range clipping, and cross-midnight display. Apply the existing [rounding rules](REQUIREMENTS.md#evidence-duration-and-rounding). |
| Medium | Packaging, persistence locations, and recovery are not implemented. | Select versions, bundle Node, define migration and backup strategy, and verify startup, shutdown, and restart on both platforms. |
| High | Title-only JEV field selections produced false continuity. A synthetic test on 2026-10-17 used fictional cases, `jev-1.13.0`, and the pipe's request and response rules. With screen text and titles, all eight scenarios matched expectations. With window titles and case references and titles only, an unknown-folder switch and an ambiguous inbox both returned `same_case` (confidence 0.69 and 0.77, against 0.94–0.98 with text). | Decide whether approved selections must include `*.text`, or whether low-confidence `same_case` results become `uncertain`, and at what threshold. Calibrate with representative captures; synthetic scenarios do not establish accuracy on real screens. |
| Medium | Hosted JEV may receive recorded context. | Define permitted fields before setting `JEV_ALLOWED_FIELDS` and enabling JEV. Previous observation fields require explicit selection. The [pipe data boundary](ARCHITECTURE.md#jev-configuration-and-data-boundary) depends on agent instructions. Verify environment loading, actual request fields, credentials, and failure handling in the selected runtime. |

## Implementation checkpoints

1. Resolve the stopped-app command contract and duration reconstruction rule.
2. Verify the Screenpipe trigger, memory, MCP, and source-tag integration contracts.
3. Finalize database fields, integrity constraints, and API payloads against the requirements.
4. Implement and verify the [complete journey](REQUIREMENTS.md#first-complete-journey) and [failure and recovery examples](REQUIREMENTS.md#failure-and-recovery-examples).
5. Run native desktop acceptance on macOS and Windows.

The pipe has no executable helper; prompt review does not establish its enforcement or runtime behavior. The read-only [JEV tab-change check](../integrations/screenpipe/jev-check/README.md) has unit tests (`bun test tests/unit/jev-check`) and one live Windows run through Screenpipe MCP and JEV. It applies `JEV_MIN_CONFIDENCE` (default 0.7) as an interim guard, which turns low-confidence answers into `uncertain`; this does not settle the field-selection decision above. Real tab switches, `--watch`, and macOS remain untested. No live pipe, product, or native-platform acceptance checks have run. Provider evidence and its verification limits remain in [integration research](SCREENPIPE_INTEGRATION.md) and [event research](SCREENPIPE_EVENTS.md).
