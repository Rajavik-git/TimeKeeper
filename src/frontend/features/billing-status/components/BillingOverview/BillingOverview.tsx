import { PageHeader } from "../../../../shared/components/PageHeader/PageHeader";
import { caseBillingModeLabels } from "../../../../shared/presentation/catalog";
import { invoiceStatusLabels } from "../../../../shared/presentation/billing";
import { InvoiceType } from "../../../../../contracts/states.generated";
import {
  BillingStatus,
  CaseBillingMode,
  CaseStatus,
} from "../../../../../contracts/states.generated";
import { useEffect, useRef, useState } from "react";
import { clientForCase, type Case, type ScreenProps } from "../../../../api/client";
import { draftInvoice, formatRoundedMinutes } from "../../../../calculations/billing";
import { IssuedInvoiceDialog } from "../IssuedInvoiceDialog/IssuedInvoiceDialog";
import { money as formatMoney, recordedMoney, shortDate } from "../../../../shared/format";
import { Card } from "../../../../shared/components/Card/Card";
import { Kpi } from "../../../../shared/components/Kpi/Kpi";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";
import { Pill } from "../../../../shared/components/Pill/Pill";

const billingDate = (value: string) => shortDate(value).replace(/\bSept\b/, "Sep");
type Props = Pick<ScreenProps, "catalogState" | "workspaceState" | "navigate"> & {
  onSelect: (caseItem: Case) => void;
};

export function BillingOverview({ catalogState, workspaceState, navigate, onSelect }: Props) {
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency);
  const overviewRef = useRef<HTMLDivElement>(null);
  const [moreCases, setMoreCases] = useState(false);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const issued = workspaceState.billing.invoices.find((invoice) => invoice.id === invoiceId);
  const openCases = catalogState.cases
    .filter((item) => item.status === CaseStatus.Active)
    .map((item) => {
      const owner = clientForCase(catalogState, item.id);
      const periods = workspaceState.periods.filter(
        (period) =>
          period.caseId === String(item.id) &&
          !period.excluded &&
          period.billable &&
          period.billingStatus === BillingStatus.Unbilled,
      );
      const preview = draftInvoice(catalogState, workspaceState, item.id, InvoiceType.Final);
      const invoices = workspaceState.billing.invoices
        .filter((invoice) => invoice.caseId === String(item.id))
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        item,
        owner,
        periods,
        preview,
        lastInvoice: invoices[0],
        toBillCents: item.mode === CaseBillingMode.FlatFee ? 0 : preview.feesCents,
      };
    })
    .filter(
      (row) =>
        row.owner &&
        (row.periods.length ||
          row.preview.feesCents > 0 ||
          row.preview.expensesCents > 0 ||
          row.preview.disbursementsCents > 0),
    )
    .sort((a, b) => b.toBillCents - a.toBillCents);
  const recentInvoices = [...workspaceState.billing.invoices]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 5);
  useEffect(() => {
    const node = overviewRef.current;
    if (!node) return;
    const update = () => setMoreCases(node.scrollHeight - node.scrollTop > node.clientHeight + 2);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [openCases.length]);
  const note = "Estimates use current rates and billing state.";
  const ready = openCases.filter(
    (row) =>
      row.item.mode !== CaseBillingMode.FlatFee &&
      row.preview.pendingPeriods === 0 &&
      row.preview.complete,
  );
  const waiting = openCases.filter(
    (row) => row.item.mode !== CaseBillingMode.FlatFee && row.preview.pendingPeriods > 0,
  );
  const readyCents = ready.reduce((sum, row) => sum + row.preview.feesCents, 0);
  const allCents = openCases.reduce((sum, row) => sum + row.toBillCents, 0);
  return (
    <>
      <PageHeader
        className="page-head billing-page-head"
        title={<>Billing</>}
        description={<>Choose a case to prepare its invoice. {note}</>}
      />
      {openCases.some((row) => !row.preview.complete) && (
        <p role="status">
          Partial billing estimates · some durations or sources are unavailable. Resolve coverage
          before issuing an invoice.
        </p>
      )}
      <details className="comparison-method">
        <summary>About these figures</summary>
        <p>
          These are current balances, not amounts earned during a month. Historical balance
          comparisons are unavailable because earlier balances are not stored.
        </p>
      </details>
      <div className="billing-summary stats billing-scope">
        <Kpi
          title="Ready to invoice"
          value={
            <span className="metric-value">
              <span>{money(readyCents)}</span>
            </span>
          }
          detail={`${ready.length} hourly case${ready.length === 1 ? "" : "s"}, time validated`}
        />
        <Kpi
          title="Waiting for time validation"
          value={
            <span className="metric-value">
              <span>{waiting.length}</span>
            </span>
          }
          detail={`Hourly cases with time to validate`}
        />
        <Kpi
          title="To bill in total"
          value={
            <span className="metric-value">
              <span>{money(allCents)}</span>
            </span>
          }
          detail="Hourly cases"
        />
      </div>
      {issued && (
        <IssuedInvoiceDialog
          invoice={issued}
          lines={workspaceState.billing.lines}
          close={() => setInvoiceId(null)}
        />
      )}
      <div
        className="billing-overview billing-scope"
        ref={overviewRef}
        onScroll={(event) =>
          setMoreCases(
            event.currentTarget.scrollHeight - event.currentTarget.scrollTop >
              event.currentTarget.clientHeight + 2,
          )
        }
      >
        <div className="billing-cards">
          {openCases.map(({ item: caseItem, owner, preview, lastInvoice }) => (
            <button
              className="card card-padded billing-card"
              key={caseItem.id}
              onClick={() => onSelect(caseItem)}
            >
              <span className="billing-card-head">
                <strong title={owner!.name}>{owner!.name}</strong>
                <span title={caseItem.title}>{caseItem.title}</span>
                <CaseReference value={caseItem.reference} />
              </span>
              <span className="billing-card-value">
                <strong>{money(preview.feesCents)}</strong>
                <span>
                  {caseItem.mode === CaseBillingMode.FlatFee && preview.billedMinutes === 0
                    ? caseBillingModeLabels[CaseBillingMode.FlatFee]
                    : formatRoundedMinutes(preview.billedMinutes)}
                </span>
              </span>
              <span className="billing-card-foot">
                <Pill
                  kind={
                    !preview.complete || preview.pendingPeriods
                      ? "warn"
                      : caseItem.mode === CaseBillingMode.FlatFee
                        ? "out"
                        : "ok"
                  }
                >
                  {!preview.complete
                    ? "Review incomplete coverage"
                    : preview.pendingPeriods
                      ? `${preview.pendingPeriods} to validate`
                      : caseItem.mode === CaseBillingMode.FlatFee
                        ? caseBillingModeLabels[CaseBillingMode.FlatFee]
                        : "Ready to invoice"}
                </Pill>
                {lastInvoice && (
                  <small
                    title={`Last: ${lastInvoice.number}, ${billingDate(lastInvoice.date)}`}
                  >{`Last: ${lastInvoice.number}, ${billingDate(lastInvoice.date)}`}</small>
                )}
              </span>
            </button>
          ))}
          {!openCases.length && (
            <Card className="billing-empty">
              <h2>Nothing to invoice</h2>
              <p>New billable work will appear here.</p>
              <button className="btn" onClick={() => navigate("matters")}>
                View cases
              </button>
            </Card>
          )}
        </div>
        <Card className="card-flush billing-recent">
          <div className="card-h billing-recent-head">
            <h2>Recent invoices</h2>
            <span>{workspaceState.billing.invoices.length} issued</span>
          </div>
          {recentInvoices.length ? (
            <div className="billing-recent-list">
              <table className="data-table billing-recent-table">
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Client · case</th>
                    <th scope="col">Date</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((invoice) => {
                    const invoiceCase = catalogState.cases.find(
                      (caseItem) => String(caseItem.id) === invoice.caseId,
                    );
                    const invoiceClient = invoiceCase
                      ? clientForCase(catalogState, invoiceCase.id)
                      : undefined;
                    return (
                      <tr key={invoice.id}>
                        <td>
                          <button
                            className="invoice-open"
                            onClick={() => setInvoiceId(invoice.id)}
                            aria-label={`Open issued invoice ${invoice.number}`}
                          >
                            {invoice.number}
                          </button>
                        </td>
                        <td
                          className="billing-recent-case"
                          title={`${invoiceClient?.name ?? "Client"} · ${invoiceCase?.title ?? "Case"}`}
                        >
                          {invoiceClient?.name ?? "Client"} · {invoiceCase?.title ?? "Case"}
                        </td>
                        <td>{billingDate(invoice.date)}</td>
                        <td className="billing-recent-amount">
                          <strong>{recordedMoney(invoice.totalCents, invoice.currency)}</strong>
                        </td>
                        <td>
                          <Pill kind="out">{invoiceStatusLabels[invoice.status]}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="billing-recent-empty">Issued invoices will appear here.</div>
          )}
        </Card>
        {moreCases && (
          <button
            className="btn sm billing-scroll-cue"
            onClick={() =>
              overviewRef.current?.scrollBy({
                top: overviewRef.current.clientHeight,
                behavior: "smooth",
              })
            }
          >
            More cases <span aria-hidden="true">↓</span>
          </button>
        )}
      </div>
    </>
  );
}
