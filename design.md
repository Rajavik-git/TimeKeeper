# TimeKeeper design

Visual standards and current screen interactions. [Requirements](docs/REQUIREMENTS.md) own business behavior; [architecture](docs/ARCHITECTURE.md#frontend-ownership) owns component responsibilities.

## Direction

Keep the workspace quiet and readable. Give work periods, case identity, and review actions priority over decorative summaries. Use tables for comparable records, a timeline for chronology, and dialogs for focused edits. Keep actions near the records they affect.

The main navigation contains My day, Cases, Billing, Activity, and Settings. The floating pill provides compact session context and quick access to the main window.

## Screen behavior

| View     | Main tasks and current limits                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My day   | Calendar, coverage, questions, period review, filters, and CSV. Manual entry remains disabled.                                                                  |
| Cases    | Client and case editors, figures, markers, and budgets. Balances, counts, attention figures, billing bars, and the recorded-time comparison are workspace-wide. |
| Billing  | Draft invoices, expenses, VAT, validation blockers, and issued snapshots. Payments and invoice delivery are unavailable.                                        |
| Activity | Stored timeline, keyboard-readable period list, sources, audit, review, and source packs. No live media retrieval or recording control.                         |
| Settings | Clients, rates, work categories, rules, invoices, and pill preferences. Capture exclusions and retention controls remain disabled.                              |

My day retains date, month, filters, and sort across navigation. Cases retains client, case, and tab. Source review restores its originating screen and period-action focus. Settings drafts survive section switches only, not leaving Settings or reloading.

New case uses the initiating client from client detail; overview creation requires explicit selection. The shared client form includes type, name, optional code, billing mode and rate, address, VAT, and active status. Blank rates inherit; explicit zero stays zero. Question controls reset for a new period and retain tentative answers on same-period retries.

## Colour and themes

Use semantic variables from [tokens.css](src/frontend/shared/design-system/tokens.css). Support Light, Dark, and Auto; avoid feature-specific copies of theme colours.

| Role           | Token       | Light     | Dark      |
| -------------- | ----------- | --------- | --------- |
| Workspace      | `--bg`      | `#ececee` | `#0c0c0d` |
| Surface        | `--surface` | `#f7f7f8` | `#141416` |
| Primary text   | `--ink`     | `#18181b` | `#fafafa` |
| Primary action | `--act`     | `#2b3a4f` | `#93a5bf` |
| Positive state | `--ok`      | `#3f6b50` | `#7fa98d` |
| Warning        | `--warn`    | `#7a6230` | `#c9ae7a` |
| Error          | `--bad`     | `#8e3b3b` | `#c77474` |

Use borders and spacing to separate content. Reserve status colours for their meaning and pair them with text. Time validation, source review, availability, and billing status need distinct labels.

## Typography and geometry

Use local Geist for interface text and Geist Mono for references and code. Numeric comparisons use aligned, tabular figures. Invoice document styling may use the existing serif document font.

| Element                           | Shared size         |
| --------------------------------- | ------------------- |
| Body / secondary text             | 15 / 13.5 px        |
| Page / section heading            | 30 / 19 px          |
| Summary value                     | 32 px               |
| Standard / compact control        | 38 / 32 px high     |
| Control / card radius             | 6 / 8 px            |
| Table header / minimum row height | 40 / 50 px          |
| Spacing scale                     | 4, 8, 12, 16, 24 px |

Reuse shared control and card styles. Let labels wrap and rows grow. Do not shrink text, controls, or the document to fit a viewport.

Cards use 16 px body padding and 12 × 16 px headers. Summary strips use 16 px padding and a 124 px minimum height. Source-pack dialogs are at most 560 px wide. Navigation becomes icon-only below 1100 px; retain accessible names.

## Layout and interaction

- Use `PageHeader` for the title, description, and screen actions. Keep summary strips separate from detailed records.
- Reflow panels on narrow screens. Allow internal table scrolling when columns need their width. Preserve readable labels and keyboard access when navigation becomes icon-only.
- Keep case, client, date range, and comparison scope visible. Carry context into editors and restore the originating screen after source review.
- Preserve failed drafts. Show persistent errors beside the form, block repeated pending submissions, and require explicit discard for dirty dialogs. Transient notices supplement local feedback.
- Show loading, empty, failed, stale, and incomplete data as different states. Unknown duration or pricing must not appear as zero. Explain unavailable comparisons once per view.
- Preserve visible keyboard focus: a 2 px outline with 2 px offset. Label icon actions, contain dialog focus, restore the opener, and respect reduced-motion preferences.
- Keep unsupported capture and recording controls disabled with an explanation.

Period-review drafts survive Sources and Back, including history loading. Dirty or failed corrections block validation and marking billed. Polling changes require explicit reload; reconstruction proposals are read-only and add no time. Included non-billable work needing time validation still counts; excluded work does not.

Application errors in HTTP 202 responses remain errors. A failed refresh after a committed write must not imply that the write failed. My day distinguishes loading, empty data, retryable initial failure, and retained snapshots after refresh failure.

Issued invoices open saved lines, totals, currency, and status. Creation and refresh outcomes are reported separately. Day, draft, and issued-invoice CSV use shared formula-safe cell formatting; numeric signs remain unchanged. Dates use the desktop timezone. Missing pricing and incompatible currencies stay incomplete, with no invented conversion.

## Interface vocabulary

Generated states map to labels in `src/frontend/shared/presentation/`; preserve wire values when changing copy.

| Concept           | Labels and distinctions                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| Clients and cases | Individual or Company; Active or Archived. Archived does not mean legally closed. |
| Time review       | Time validated or Time to validate                                                |
| Source review     | Source validated or Source not validated, independently of time                   |
| Availability      | Available, Unavailable in Screenpipe, or Availability not checked                 |
| Billing           | Billed or Unbilled; invoice membership is separate                                |
| No charge         | Label for `offered`; not unbilled, excluded, pro bono, or written off             |
| Exclusion         | Exclude period or Include in totals, independently of billability                 |
| Fees and costs    | Estimated fees, Expense, Disbursement, VAT                                        |

## Pill

The native document and Settings' Desk preview share `WorkPill` and `pillView`, with a 50 px bar and expanded panel. Display choices are Estimated fees, Time, and Case. Themes synchronize between documents; the native background remains transparent. Case changes use canonical assignment or guarded question-answer commands. Pause and Close period remain disabled.

Open My day focuses the main window and emits `timekeeper:open-my-day`; its listener selects My day without reloading and cleans up on unmount. Native execution remains unverified. Notice suppression matches period-label words and does not prove call detection. The pill reads the TimeKeeper API; the setup-only Screenpipe origin does not configure it. [Setup](docs/SETUP.md#prepare-desktop-development) covers window lifecycle and packaging.

## Implementation

[styles.css](src/frontend/shared/styles.css) owns stylesheet imports and cascade order. Shared [design-system styles](src/frontend/shared/design-system/) own reusable geometry and states; feature styles own screen layouts.

Reuse components under `shared/components/` and feature `components/` folders. Keep presentation separate from API commands and calculations. Extend a shared pattern before adding a competing one.

Check changed screens in both themes, with keyboard navigation, long labels, empty data, failed requests, and narrow layouts. Use the [browser acceptance procedure](tests/acceptance/README.md); native pill behavior needs separate desktop acceptance.
