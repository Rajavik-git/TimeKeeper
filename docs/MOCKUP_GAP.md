# Mockup and requirements gap

The aligned demo retains the approved visual design and the billing scope agreed on 2026-10-17. [Requirements](REQUIREMENTS.md), [architecture](ARCHITECTURE.md), and [database design](DATABASE.md) remain the authorities for the MVP. The requirements record the agreed billing extensions. This page records their implementation status.

## Five resolved rule decisions

| Conflict              | Aligned behavior                                                                                                  | Current implementation                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration and rounding | Precise effective milliseconds; unknown stays unknown; round only a combined group up to minutes                  | Canonical `work_periods`, React `summary.ts` and `billing.ts`; imported demo durations are explicit, not inferred from screenshots                             |
| Monetary calculations | React prepares summaries and invoice drafts; the API validates references and stores the supplied issued snapshot | React owns active amounts, VAT and totals; the API stores frozen invoice lines and totals. Legacy pre-invoice calculations were removed from `/api/state`      |
| Review states         | Time validation, source validation and availability, and billing status are independent                           | Separate canonical fields, services, API routes, and screens                                                                                                   |
| Write path            | All writes must enter application services and ports                                                              | All API mutations enter application services; compatibility routes project canonical business records                                                          |
| Data model            | Clients, cases, sessions, work periods, sources and recovery tables, with approved mockup extensions              | Canonical schema migrations and demo conversion exist. Legacy tables remain as migration inputs and fictional capture metadata; business records are canonical |

## Retained mockup features

Numbered invoices, client rates, flat fees, budgets, expenses, disbursements, VAT, client rules, marker suggestions, task types, source packs, audit and Jev review remain in the demo. Their canonical extensions are listed in [schema implementation](implementation/schema.md). Recognition and case-reference behavior are still demo choices, not approved Screenpipe matching rules. Manual off-screen periods have an explicit duration override and no source; excluded personal periods can be restored. Source-pack export retains its route, selects canonical periods, sources and invoices, and applies other-client redaction throughout the exported payload.

**Proposed monetary rounding:** a case's billed minutes on one invoice equal `ceil(sum of selected effective milliseconds / 60000)`; work amount equals `round(billed minutes × hourly rate cents / 60)`. The frontend implements this for the demo. The applied rate is frozen when a period is marked billed; an issued invoice cannot be ordinarily unbilled. Editing billed periods and invoice reversal remain open decisions.

## Still unbuilt or unverified

- Screenpipe command delivery while the app is closed, provider event transport, live capture, canonical source-tag targets and verified tag writeback.
- An agreed rule for deriving duration or gaps from observations. The demo displays one explicit failed retrieval interval; screenshots alone do not create work time.
- Reconstruction-conflict resolution UI and provider-backed command/evidence workflows.
- Read-only MCP tools and a packaged Node backend in the native installer. macOS and Windows native behavior need separate acceptance tests.
- Precise rules for folder identification, client-rule policy beyond the two retained demo checks at invoice issuance, and edits or reversals after an invoice is issued.

The [design review](DESIGN_REVIEW.md) tracks implementation gates. The [README decision table](../README.md#decisions-to-make) records proposed options without treating them as agreed behavior.
