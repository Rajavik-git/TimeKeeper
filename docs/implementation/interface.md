# Interface

The visual direction is based on the approved local HTML mockup. The app shell has a 240 px sidebar, a 48 px top bar, and content up to 1280 px wide. Light and dark palettes, typography, spacing, table treatment and responsive layouts are defined in `src/frontend/shared/theme.css`. Geist and Geist Mono are bundled locally through Fontsource; no external font request is needed.

The sidebar contains the four daily work screens, Workspace settings and Desk pill, a capture status panel, Light / Dark / Auto controls and the lawyer profile from the state API. Keys 1–4 open the four daily work screens. Search, Help and Pause capture are visible but disabled until an API exists. Reset demo remains in the page footer.

My day shows API-backed totals, All / To review / Approved / Left out filters, recognition suggestions and row actions. Cases has a client-filtered case list, case facts, budget use, time entries and marker weights and hit counts. Pre-invoices places the work list beside a sticky summary; issue remains disabled while billable entries need approval. Source includes a timeline with a second-by-second hover cursor, recognition, Jev reviews, source-pack history and an audit trail. Settings retains editable clients, cases, rates, tasks, rules and capture/invoice preferences. Desk pill keeps its existing simulation and controls.

The desktop layout becomes one column below 980 px. Tables can scroll horizontally on narrow screens. The UI continues to use the existing OpenAPI contract and Hono endpoints for data and mutations.
