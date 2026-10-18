# Feature backlog and integration validation

Updated: 2026-10-18. This file tracks features to add or complete and existing integrations to validate. [Requirements](REQUIREMENTS.md) owns business rules and unresolved decisions. [Architecture](ARCHITECTURE.md) owns implementation boundaries.

## Implemented integrations awaiting validation

MCP, JEV, and Screenpipe skills are implemented. Their installed workflow and end-to-end behavior have not been validated. Implementation status does not establish release readiness.

| Integration                        | Implementation evidence                                                                              | Status and next action                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TimeKeeper MCP                     | `src/mcp/` in this checkout.                                                                         | Implemented; validation pending. Verify the Screenpipe connection, authentication, tool outcomes, and recording-session link.                         |
| JEV assessment                     | `integrations/screenpipe/jev-check/` on the existing local branch `merge/post-ui-review-mcp-api`.    | Implemented; validation pending. Confirm the intended revision and integrate the existing implementation with this branch's contracts before testing. |
| Screenpipe skills and manual pipes | `integrations/screenpipe/timekeeper/SKILL.md` and `integrations/screenpipe/pipes/` in this checkout. | Implemented; validation pending. Verify installation, tool discovery, skill use, and manual Start/End execution in the selected Screenpipe release.   |

This source tree includes MCP and skills. JEV source integration is pending; reuse the existing implementation identified above. Do not mark any integration validated solely because its source exists or isolated tests pass.

### Validation checklist

- [ ] Record the Screenpipe release, operating system, TimeKeeper revision, and integration configuration without credentials.
- [ ] Verify HTTP MCP authentication and the read tools against a running TimeKeeper API.
- [ ] Verify explicit Start/End commands, repeated commands, unavailable-service outcomes, and the optional recording-session link separately.
- [ ] Verify skill discovery and manual pipes through Screenpipe. Check that pending or unconfirmed outcomes remain visible.
- [ ] Confirm JEV's permitted hosted input fields and existing output contract before inference. Verify case selection, unresolved results, and failures without invented case IDs.
- [ ] Verify that a delayed JEV result preserves a newer manual correction. A delayed lawyer answer must affect only its original period.
- [ ] Check app, window, tab, and same-window case changes, including ambiguous context and missing evidence.
- [ ] Run the relevant [acceptance examples](REQUIREMENTS.md#acceptance-examples) on macOS and Windows. Record results and unresolved failures separately for each platform.

Use isolated data for validation. Follow the credential and hosted-data constraints in [contributor instructions](../AGENTS.md#working-and-verification-practices).

## Features to add or complete

These items come from the existing requirements and implementation gaps. Their order is a planning suggestion, not a change to agreed scope.

| ID  | Feature                                                | Decision or dependency                                                                                                     | Acceptance target                                                                                                                                    |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Reliable case-folder identification.                   | Agree matching metadata, case-reference scope, and transition boundaries. Validate the existing JEV integration.           | Ordinary app switches preserve the case; an unknown folder creates an unresolved period and a guarded question.                                      |
| F02 | Recorded-evidence ingestion and recovery.              | Reconcile existing implementation across branches and define source identity, pagination, overlap, and committed progress. | Restart and delayed indexing recover evidence without duplicate sources or lost corrections. Activity previews remain separate from stored evidence. |
| F03 | Duration derivation from recorded evidence.            | Define duration, gaps, overlap, cross-midnight behavior, and manual entries without evidence.                              | Missing evidence remains visible; precise durations and manual overrides survive replay without inventing continuous work.                           |
| F04 | Durable command delivery while TimeKeeper is stopped.  | Choose the external receipt or relaunch mechanism and causal ordering contract.                                            | A stopped API is never reported as having applied a command. Recovery preserves effective boundaries and prerequisite order.                         |
| F05 | Lawyer resolution of reconstruction conflicts.         | Define approval, rejection, and treatment of corrected or validated periods.                                               | A proposal adds no counted time until accepted. Resolution preserves overrides and prevents duplicate time.                                          |
| F06 | Screenpipe case-tag synchronization.                   | Verify provider target mapping, alias agreement, revision guards, and tag read-back.                                       | Preserve unrelated tags, serialize canonical-target writes, reject stale delivery, and acknowledge only verified results.                            |
| F07 | macOS desktop packaging and native release completion. | Add the missing macOS sidecar build path and verify lifecycle, storage, and migrations on both platforms.                  | Install, reopen, quit, and recover without losing session state or leaving an owned API process orphaned.                                            |
| F08 | Application-wide backup and recovery.                  | Agree backup scope, retention, restoration, and migration compatibility.                                                   | Restore a workspace with its assignments, corrections, invoices, and evidence references intact.                                                     |

Open billing, pricing, source-review, and summary decisions remain in [requirements](REQUIREMENTS.md#decisions-still-required). Resolve them before dependent changes. This file does not define new duration or billing rules.

## Completion evidence

For each completed feature or validation item, record the revision, platform, scenario, observed result, and remaining limitations. Link to the relevant acceptance evidence. Keep source review, automated tests, browser checks, native checks, and real Screenpipe/JEV validation distinct.
