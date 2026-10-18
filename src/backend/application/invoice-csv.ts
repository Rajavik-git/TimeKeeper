import { csvCell } from "../../shared/csv.js";
import type { InvoiceExport } from "../ports/source-export.js";

/** Export decimal amounts in the currency frozen when the invoice was issued. */
export function formatInvoiceCsv(invoice: InvoiceExport): string {
  const rows = ["number;date;client;case;label;minutes;hourly_rate;amount;currency;sales_tax"];
  for (const line of invoice.lines) {
    rows.push(
      [
        invoice.number,
        invoice.date,
        invoice.clientName,
        invoice.caseTitle,
        line.label,
        line.billedMinutes,
        (line.rateCents / 100).toFixed(2),
        (line.amountCents / 100).toFixed(2),
        invoice.currency ?? "",
        line.vat && invoice.vatCents > 0 ? "yes" : "no",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return rows.join("\n");
}
