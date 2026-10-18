import { useState } from "react";
import { api, type CoreState } from "../../../../api/client";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { recordedMoney, shortDate } from "../../../../shared/format";
import { invoiceStatusLabels, invoiceTypeLabels } from "../../../../shared/presentation/billing";

type Invoice = CoreState["billing"]["invoices"][number];

/** Issued amounts and lines come exclusively from the stored invoice snapshot. */
export function IssuedInvoiceDialog({
  invoice,
  lines,
  close,
}: {
  invoice: Invoice;
  lines: CoreState["billing"]["lines"];
  close: () => void;
}) {
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const amount = (cents: number) => recordedMoney(cents, invoice.currency);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      const result = await api.GET("/api/invoices/{id}/csv", {
        params: { path: { id: invoice.id } },
      });
      if (result.error || result.data === undefined) throw Error("CSV unavailable");
      const url = URL.createObjectURL(
        new Blob(["\ufeff", result.data.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.number}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError("Could not download this issued invoice. Try again.");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Modal label={`Issued invoice ${invoice.number}`} close={close}>
      <section className="modal issued-invoice-dialog">
        <div className="row between">
          <div>
            <h2>Invoice {invoice.number}</h2>
            <p>
              {shortDate(invoice.date)} · {invoiceTypeLabels[invoice.type]} ·{" "}
              {invoiceStatusLabels[invoice.status]}
            </p>
          </div>
          <button className="btn sm" onClick={close}>
            Close
          </button>
        </div>
        <p className="muted">
          Issued amounts are frozen. Current rates do not change this invoice.
        </p>
        {!invoice.currency && (
          <p role="alert">
            The historical currency was not recorded. No current currency has been substituted.
          </p>
        )}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Work or cost</th>
                <th className="r">Minutes</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines
                .filter((line) => line.invoiceId === invoice.id)
                .map((line) => (
                  <tr key={line.id}>
                    <td>{line.label}</td>
                    <td className="r">{line.billedMinutes || "—"}</td>
                    <td className="r">{amount(line.amountCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <dl className="issued-invoice-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{amount(invoice.subtotalCents)}</dd>
          </div>
          <div>
            <dt>VAT</dt>
            <dd>{amount(invoice.vatCents)}</dd>
          </div>
          <div>
            <dt>Disbursements</dt>
            <dd>{amount(invoice.disbursementsCents)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{amount(invoice.totalCents)}</dd>
          </div>
        </dl>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            className="btn primary"
            disabled={downloading}
            aria-busy={downloading}
            onClick={() => void download()}
          >
            {downloading ? "Downloading…" : "Download issued CSV"}
          </button>
        </div>
      </section>
    </Modal>
  );
}
