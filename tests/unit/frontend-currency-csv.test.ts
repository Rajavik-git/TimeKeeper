import { expect, it } from "vitest";
import { issuedFees } from "../../src/frontend/calculations/invoice-fees";
import { recordedMoney } from "../../src/frontend/shared/format";
import { invoiceRowsCsv } from "../../src/frontend/features/billing-status/lib/invoiceRows";
import { formatInvoiceCsv } from "../../src/backend/application/invoice-csv";
import type { CoreState } from "../../src/frontend/api/client";

const invoices = [
  { id: 1, currency: "USD" },
  { id: 2, currency: "EUR" },
] as CoreState["billing"]["invoices"];
const lines = [
  { invoiceId: 1, origin: "work_period", amountCents: 500 },
  { invoiceId: 2, origin: "work_period", amountCents: 700 },
] as CoreState["billing"]["lines"];
it("does not combine issued fees in different or missing currencies", () => {
  expect(issuedFees(invoices, lines, "USD")).toEqual({
    cents: null,
    knownCents: 500,
    complete: false,
  });
  expect(issuedFees([{ ...invoices[0], currency: null }], lines, "USD").cents).toBeNull();
  expect(recordedMoney(500, null)).toBe("5.00 · currency unavailable");
  expect(recordedMoney(700, "EUR")).toBe("€7.00");
});
it("does not include costs or VAT in issued work fees", () => {
  expect(
    issuedFees(
      [invoices[0]],
      [...lines, { invoiceId: 1, origin: "expense", amountCents: 400 } as (typeof lines)[number]],
      "USD",
    ),
  ).toEqual({ cents: 500, knownCents: 500, complete: true });
});
it.each(["=formula", "+formula", "-formula", "@formula", "\tformula", "\rformula"])(
  "protects formula-leading draft and issued text: %j",
  (label) => {
    const draft = invoiceRowsCsv(
      [
        {
          id: "period",
          date: "2026-10-17",
          label,
          durationMs: 60000,
          amountCents: 100,
          kind: "period",
          pending: false,
        },
      ],
      "USD",
    );
    expect(draft).toContain(`"'${label}"`);
    const issued = formatInvoiceCsv({
      number: "F-1",
      date: "2026-10-17",
      currency: "USD",
      vatCents: 0,
      clientName: label,
      caseTitle: label,
      lines: [{ label, billedMinutes: 1, rateCents: 6000, amountCents: 100, vat: false }],
    });
    expect(issued.match(/"'/g)).toHaveLength(3);
    expect(issued).toContain('"1";"60.00";"1.00";"USD";"no"');
  },
);
