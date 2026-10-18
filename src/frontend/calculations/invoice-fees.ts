import { InvoiceLineOrigin } from "../../contracts/states.generated";
import type { CoreState } from "../api/client";

/** Frozen work fees can share a total only when their recorded currencies agree. */
export function issuedFees(
  invoices: CoreState["billing"]["invoices"],
  lines: CoreState["billing"]["lines"],
  currency: string,
) {
  let knownCents = 0;
  let complete = true;
  for (const invoice of invoices) {
    const fees = lines.filter(
      (line) =>
        line.invoiceId === invoice.id &&
        (line.origin === InvoiceLineOrigin.WorkPeriod || line.origin === InvoiceLineOrigin.FlatFee),
    );
    if (fees.length && invoice.currency !== currency) {
      complete = false;
      continue;
    }
    knownCents += fees.reduce((total, line) => total + line.amountCents, 0);
  }
  return { cents: complete ? knownCents : null, knownCents, complete };
}
