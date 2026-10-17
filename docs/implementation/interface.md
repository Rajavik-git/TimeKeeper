# Implemented interface

The approved six-screen visual design uses a 240 px sidebar, a 48 px top bar, local Geist fonts, light and dark palettes and responsive tables. Keys 1–4 open My day, Cases, Pre-invoices and Source outside form fields. Search, Help and capture pause are visible but unavailable because provider integration is not implemented.

- **My day** displays combined precise work rounded once, React-calculated fees, an explicit coverage gap and periods needing time validation. Each row separates detected and corrected duration, time validation, per-source validation and availability, and billing status. An unresolved period shows a period-bound question and an optional marker suggestion; Answer targets the question's assignment revision. Manual off-screen time creates a source-free period with explicit duration.
- **Cases** groups canonical work periods by case for time and fee displays. The catalogue and marker editor uses the retained demo routes; edits synchronize catalogue fields to canonical tables used by invoice validation.
- **Pre-invoices** calculates a draft in React from effective period durations. The draft groups minutes per case, applies the case > client > base rate, and shows expenses, disbursements, VAT and completeness. Issuing sends frozen lines and totals; the API checks ownership, validation, revisions and billing state. Existing issued invoices cannot be ordinarily unbilled through the period control.
- **Source** lists each linked observation's availability and independent validation state. The historical demo includes a simulated cursor, recognition evidence, Jev reviews, audit and source-pack controls. Newly created canonical periods open their own source list by opaque ID.
- **Settings** edits client, case, rate, task and rule configuration. Unresolved base-rate estimates use canonical precise durations.
- **Desk and floating pill** display active session, current case and current-period duration. They no longer advance a fictional fee timer. Screenpipe owns recording and session commands; pause and close controls await integration.

The sidebar names an active session and explains that closing the interface leaves it active. These are local database states, not a claim that Screenpipe recording is connected. The [mockup gap](../MOCKUP_GAP.md) records missing native/provider acceptance.
