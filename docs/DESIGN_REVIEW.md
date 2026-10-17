# Remaining design decisions

This document tracks unresolved decisions and implementation gates. [Requirements](REQUIREMENTS.md) define agreed behavior. [Architecture](ARCHITECTURE.md) and [database design](DATABASE.md) define its intended implementation. No runtime integration or SQL migration exists.

## Decisions needed before dependent implementation

| Priority | Gap | Decision or evidence needed |
| --- | --- | --- |
| Critical | Session commands and assignments can arrive while Tauri, Node, and MCP are stopped. | Choose and verify durable command storage outside the app or a controlled relaunch mechanism against the [session lifecycle rules](REQUIREMENTS.md#sessions-and-desktop-lifecycle). |
| High | Screenshots establish observations, not continuous duration. | Define interval boundaries, gaps, overlaps, and incomplete coverage within the [evidence and duration rules](REQUIREMENTS.md#evidence-duration-and-rounding). |
| High | Folder identification is intentionally deferred. | Define detection, candidate matching, and effective timestamps within the [case and work-period rules](REQUIREMENTS.md#cases-and-work-periods). |
| High | Event transport evidence does not establish a working capture-to-skill trigger. | Pin the Screenpipe release and pass the producer, bridge, and memory-read checks in the [event research](SCREENPIPE_EVENTS.md). |
| High | Source-tag APIs have not been tested with TimeKeeper. | Verify evidence-to-target mapping, updates, removal, readback, and native display against the [synchronization contract](ARCHITECTURE.md#screenpipe-assignment-synchronization). Distinguish unsupported behavior from retryable failure. |
| High | Late evidence can propose different period boundaries. | Define the lawyer's conflict-resolution action before implementing splits under the [protected-period rule](REQUIREMENTS.md#cases-and-work-periods). |
| Medium | Applied hourly rate timing remains open. | Choose when rate and currency become historical values. Define changes to a billed period and later changes to configured rates. |
| Medium | Source and time review are separate, but some transitions remain open. | Decide whether time validation requires validated sources and what rejecting or losing a source changes. Manual creation without evidence is not yet a confirmed use case. |
| Medium | Summary selection rules remain incomplete. | Define which validation states contribute to each total, date-range clipping, and cross-midnight display. Apply the existing [rounding rules](REQUIREMENTS.md#evidence-duration-and-rounding). |
| Medium | Packaging, persistence locations, and recovery are not implemented. | Select versions, bundle Node, define migration and backup strategy, and verify startup, shutdown, and restart on both platforms. |
| Medium | Hosted JEV may receive recorded context. | Define permitted fields and deployment choice before sending source data. |

## Implementation checkpoints

1. Resolve the stopped-app command contract and duration reconstruction rule.
2. Verify the Screenpipe trigger, memory, MCP, and source-tag integration contracts.
3. Finalize database fields, integrity constraints, and API payloads against the requirements.
4. Implement and verify the [complete journey](REQUIREMENTS.md#first-complete-journey) and [failure and recovery examples](REQUIREMENTS.md#failure-and-recovery-examples).
5. Run native desktop acceptance on macOS and Windows.

No acceptance checks have run. Provider evidence and its verification limits remain in [integration research](SCREENPIPE_INTEGRATION.md) and [event research](SCREENPIPE_EVENTS.md).
