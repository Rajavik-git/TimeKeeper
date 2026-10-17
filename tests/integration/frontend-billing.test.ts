import { frontendFixture } from "../unit/frontend-fixture";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import type { ScreenProps } from "../../src/frontend/api/client";
import { draftInvoice } from "../../src/frontend/calculations/billing";
import { invoiceRows, sortRows } from "../../src/frontend/features/billing-status/invoiceRows";

// Server rendering exercises the component without browser effects or an active API.
vi.stubGlobal("window", {});
const { PreInvoices } = await import("../../src/frontend/features/billing-status/PreInvoices");
afterAll(() => vi.unstubAllGlobals());

it.each(["expense", "disbursement"] as const)(
  "renders a case whose only outstanding work is an %s",
  async (type) => {
    const { state, core } = frontendFixture();
    const item = state.cases.find((matter) => matter.mode === "hourly")!;
    state.cases = [item];
    core.periods = [];
    core.billing.expenses = [
      {
        id: 1,
        caseId: String(item.id),
        date: "2026-10-17",
        label: "Court cost",
        type,
        amountCents: 1200,
        invoiceId: null,
      },
    ];
    const props: ScreenProps = {
      catalogState: state,
      workspaceState: core,
      action: vi.fn(),
      refresh: vi.fn(),
      openPeriodActivity: vi.fn(),
      navigate: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(PreInvoices, props));
    expect(html).toContain(item.title);
    expect(html).not.toContain("Nothing to invoice");
    core.billing.expenses[0].invoiceId = 1;
    expect(renderToStaticMarkup(createElement(PreInvoices, props))).toContain("Nothing to invoice");
  },
);

it.each([
  { durations: [20000, 20000, 20000, 1], rate: 10050, fees: 335 },
  { durations: [1, 30001, 9999, 20000], rate: 10050, fees: 335 },
  { durations: [1, 1, 1, 1], rate: 10050, fees: 168 },
  { durations: [20000, 0, null, 20000], rate: 10050, fees: 168 },
  { durations: [20000, 20000], rate: 0, fees: 0 },
])(
  "allocates $fees cents across periods with durations $durations",
  ({ durations, rate, fees }) => {
    const { state, core } = frontendFixture();
    const item = state.cases[0];
    item.hourlyRateCents = rate;
    const sample = core.periods[0];
    core.periods = durations.map((duration, index) => ({
      ...sample,
      id: String(index),
      detectedDurationMs: duration,
      durationOverrideMs: null,
    }));
    const preview = draftInvoice(state, core, item.id, "final");
    expect(preview.feesCents).toBe(fees);
    const rows = invoiceRows(item, core.periods, [], preview, "2026-10-17");
    expect(rows.reduce((total, row) => total + (row.amountCents ?? 0), 0)).toBe(fees);
    for (const [index, row] of rows.entries()) {
      if (durations[index] === null) expect(row.amountCents).toBeNull();
      else expect(row.amountCents).toBeGreaterThanOrEqual(0);
      if (durations[index] === 0) expect(row.amountCents).toBe(0);
    }
    for (const key of ["date", "label", "duration", "amount"] as const) {
      for (const direction of ["ascending", "descending"] as const) {
        const sorted = sortRows(rows, key, direction);
        expect(sorted.reduce((total, row) => total + (row.amountCents ?? 0), 0)).toBe(fees);
        expect(sorted).toEqual(expect.arrayContaining(rows));
      }
    }
  },
);

it.each([
  [0, 0],
  [null, null],
  [0, null],
])(
  "leaves period amounts unknown when there is no positive known duration: %s, %s",
  (first, second) => {
    const { state, core } = frontendFixture();
    const sample = core.periods[0];
    core.periods = [first, second].map((duration, index) => ({
      ...sample,
      id: String(index),
      detectedDurationMs: duration,
      durationOverrideMs: null,
    }));
    const item = state.cases[0];
    const preview = draftInvoice(state, core, item.id, "final");
    expect(preview.feesCents).toBe(0);
    expect(
      invoiceRows(item, core.periods, [], preview, "2026-10-17").map((row) => row.amountCents),
    ).toEqual([null, null]);
  },
);

it("keeps a flat fee separate from its period durations", () => {
  const { state, core } = frontendFixture();
  const item = state.cases[0];
  item.mode = "flat_fee";
  item.flatFeeCents = 335;
  const preview = draftInvoice(state, core, item.id, "final");
  const rows = invoiceRows(item, core.periods, [], preview, "2026-10-17");
  expect(rows.map((row) => [row.kind, row.amountCents])).toEqual([
    ["flat_fee", 335],
    ["period", null],
  ]);
});
