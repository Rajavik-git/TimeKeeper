import { useEffect, useRef, useState } from "react";
import { clientForCase, type Case, type ScreenProps } from "../../api/client";
import { draftInvoice, formatRoundedMinutes } from "../../calculations/billing";
import { previousBillingMetrics } from "../../calculations/cases";
import { money as formatMoney, shortDate } from "../../shared/format";
import { useToday } from "../../shared/hooks/useToday";
import { Card } from "../../shared/components/Card";
import { Kpi } from "../../shared/components/Kpi";
import { CaseReference } from "../../shared/components/CaseReference";
import { Pill } from "../../shared/components/Pill";

const billingDate = (value: string) => shortDate(value).replace(/\bSept\b/, "Sep");
function delta(current: number, previous: number, previousDay: string, increaseGood: boolean) {
  if (!previous) return null;
  const change = Math.round(((current - previous) * 100) / previous);
  return (
    <span
      className={`case-kpi-delta ${change === 0 ? "flat" : change > 0 === increaseGood ? "up" : "down"}`}
      title={`vs ${new Date(`${previousDay}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`}
    >
      {change > 0 ? "+" : change < 0 ? "−" : ""}
      {Math.abs(change)}%
    </span>
  );
}

type Props = Pick<ScreenProps, "catalogState" | "workspaceState" | "navigate"> & {
  onSelect: (caseItem: Case) => void;
};

export function BillingOverview({ catalogState, workspaceState, navigate, onSelect }: Props) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const overviewRef = useRef<HTMLDivElement>(null);
  const [moreCases, setMoreCases] = useState(false);
  const openCases = catalogState.cases
    .filter((item) => item.status === "active")
    .map((item) => {
      const owner = clientForCase(catalogState, item.id);
      const periods = workspaceState.periods.filter(
        (period) =>
          period.caseId === String(item.id) &&
          !period.excluded &&
          period.billable &&
          period.billingStatus === "unbilled",
      );
      const preview = draftInvoice(catalogState, workspaceState, item.id, "final");
      const invoices = workspaceState.billing.invoices
        .filter((invoice) => invoice.caseId === String(item.id))
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        item,
        owner,
        periods,
        preview,
        lastInvoice: invoices[0],
        toBillCents: item.mode === "flat_fee" ? 0 : preview.feesCents,
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
  const prior = previousBillingMetrics(catalogState, workspaceState, today);
  const note = `Changes in % compare with the same period last month (${new Date(`${prior.previousDay.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}–${prior.previousDay.slice(-2)}).`;
  const ready = openCases.filter(
    (row) =>
      row.item.mode !== "flat_fee" && row.preview.pendingPeriods === 0 && row.preview.complete,
  );
  const waiting = openCases.filter(
    (row) => row.item.mode !== "flat_fee" && row.preview.pendingPeriods > 0,
  );
  const readyCents = ready.reduce((sum, row) => sum + row.preview.feesCents, 0);
  const allCents = openCases.reduce((sum, row) => sum + row.toBillCents, 0);
  return (
    <>
      <div className="page-head billing-page-head">
        <div>
          <h1>Billing</h1>
          <p>Choose a case to prepare its invoice. {note}</p>
        </div>
      </div>
      {openCases.some((row) => !row.preview.complete) && (
        <p role="status">
          Partial billing estimates · some durations or sources are unavailable. Resolve coverage
          before issuing an invoice.
        </p>
      )}
      <div className="billing-summary stats billing-scope">
        <Kpi
          title="Ready to invoice"
          value={
            <span className="billing-vrow">
              <span>{money(readyCents)}</span>
              {delta(readyCents, prior.readyCents, prior.previousDay, true)}
            </span>
          }
          detail={`${ready.length} hourly case${ready.length === 1 ? "" : "s"}, all validated`}
        />
        <Kpi
          title="Waiting for validation"
          value={
            <span className="billing-vrow">
              <span>{waiting.length}</span>
              {delta(waiting.length, prior.waitingCases, prior.previousDay, false)}
            </span>
          }
          detail={`Hourly cases with periods to validate`}
        />
        <Kpi
          title="To bill in total"
          value={
            <span className="billing-vrow">
              <span>{money(allCents)}</span>
              {delta(allCents, prior.toBillCents, prior.previousDay, false)}
            </span>
          }
          detail="Hourly cases"
        />
      </div>
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
            <button className="billing-card" key={caseItem.id} onClick={() => onSelect(caseItem)}>
              <span className="billing-card-head">
                <strong title={owner!.name}>{owner!.name}</strong>
                <span title={caseItem.title}>{caseItem.title}</span>
                <CaseReference value={caseItem.reference} />
              </span>
              <span className="billing-card-value">
                <strong>{money(preview.feesCents)}</strong>
                <span>
                  {caseItem.mode === "flat_fee" && preview.billedMinutes === 0
                    ? "Flat fee"
                    : formatRoundedMinutes(preview.billedMinutes)}
                </span>
              </span>
              <span className="billing-card-foot">
                <Pill
                  kind={
                    preview.pendingPeriods ? "warn" : caseItem.mode === "flat_fee" ? "out" : "ok"
                  }
                >
                  {preview.pendingPeriods
                    ? `${preview.pendingPeriods} to validate`
                    : caseItem.mode === "flat_fee"
                      ? "Flat fee"
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
        <Card className="billing-recent">
          <div className="billing-recent-head">
            <h2>Recent invoices</h2>
            <span>{workspaceState.billing.invoices.length} issued</span>
          </div>
          {recentInvoices.length ? (
            <div className="billing-recent-list">
              <table className="billing-recent-table">
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
                          <strong title={invoice.number}>{invoice.number}</strong>
                        </td>
                        <td
                          className="billing-recent-case"
                          title={`${invoiceClient?.name ?? "Client"} · ${invoiceCase?.title ?? "Case"}`}
                        >
                          {invoiceClient?.name ?? "Client"} · {invoiceCase?.title ?? "Case"}
                        </td>
                        <td>{billingDate(invoice.date)}</td>
                        <td className="billing-recent-amount">
                          <strong>
                            {formatMoney(
                              invoice.totalCents,
                              invoice.currency ?? catalogState.settings.currency ?? "USD",
                            )}
                          </strong>
                        </td>
                        <td>
                          <Pill
                            kind={
                              invoice.status === "paid"
                                ? "ok"
                                : invoice.status === "overdue"
                                  ? "warn"
                                  : "out"
                            }
                          >
                            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          </Pill>
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
            className="billing-scroll-cue"
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
