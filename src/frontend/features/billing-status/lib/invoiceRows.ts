import { csvCell } from "../../../../shared/csv";
import { CaseBillingMode, InvoiceLineOrigin } from "../../../../contracts/states.generated";
import { calendarDay } from "../../../../shared/dates";
import type { CoreState, Case } from "../../../api/client";
import { effectiveMs, type InvoiceDraft } from "../../../calculations/billing";

export type InvoiceRow = {
  id: string;
  date: string;
  label: string;
  durationMs: number | null;
  amountCents: number | null;
  kind: "period" | "expense" | "disbursement" | "flat_fee";
  pending: boolean;
};
export type SortKey = "date" | "label" | "duration" | "amount";
export type SortState = { key: SortKey; direction: "ascending" | "descending" };

export function sortRows(rows: InvoiceRow[], key: SortKey, direction: "ascending" | "descending") {
  const value = (row: InvoiceRow): string | number | null =>
    key === "date"
      ? row.date
      : key === "label"
        ? row.label
        : key === "duration"
          ? row.durationMs
          : row.amountCents;
  return [...rows].sort((a, b) => {
    const left = value(a),
      right = value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const comparison =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "en-US");
    return direction === "ascending" ? comparison : -comparison;
  });
}

export function invoiceRows(
  item: Case,
  billable: CoreState["periods"],
  expenses: CoreState["billing"]["expenses"],
  preview: InvoiceDraft,
  today: string,
): InvoiceRow[] {
  const totalMs = billable.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0);
  let allocatedMs = 0;
  let allocatedCents = 0;
  const flatFeeLine = preview.lines.find((line) => line.origin === InvoiceLineOrigin.FlatFee);
  return [
    ...(flatFeeLine
      ? [
          {
            id: "flat-fee",
            date: today,
            label: flatFeeLine.label,
            durationMs: null,
            amountCents: flatFeeLine.amountCents,
            kind: "flat_fee" as const,
            pending: false,
          },
        ]
      : []),
    ...billable.map((period) => {
      const durationMs = effectiveMs(period);
      let amountCents: number | null = null;
      if (item.mode !== CaseBillingMode.FlatFee && durationMs !== null) {
        // Round cumulative shares so each row is nonnegative and all rows sum to the fee.
        allocatedMs += durationMs;
        const cumulativeCents =
          totalMs > 0 ? Math.round(preview.feesCents * (allocatedMs / totalMs)) : 0;
        amountCents = cumulativeCents - allocatedCents;
        allocatedCents = cumulativeCents;
      }
      return {
        id: period.id,
        date: calendarDay(period.startedAt),
        label: period.label,
        durationMs,
        amountCents,
        kind: "period" as const,
        pending: !period.timeValidated,
      };
    }),
    ...expenses.map((expense) => ({
      id: String(expense.id),
      date: expense.date,
      label: expense.label,
      durationMs: null,
      amountCents: expense.amountCents,
      kind: expense.type as InvoiceRow["kind"],
      pending: false,
    })),
  ];
}

/** Draft exports retain precise period minutes; the invoice total rounds only after summing. */
export function invoiceRowsCsv(rows: readonly InvoiceRow[], currency: string): string {
  return [
    "date;work;minutes;amount;currency",
    ...rows.map((row) =>
      [
        row.date,
        row.label,
        row.durationMs === null ? "" : String(row.durationMs / 60000),
        row.amountCents === null ? "" : (row.amountCents / 100).toFixed(2),
        currency,
      ]
        .map(csvCell)
        .join(";"),
    ),
  ].join("\n");
}
