import { calendarDay, systemTimeZone } from "../../../shared/dates";
import { BillingOverview } from "./BillingOverview";
import { invoiceRows, invoiceRowsCsv, sortRows, type SortState, type SortKey } from "./invoiceRows";
import { validatePeriods as runValidation, validationMessage } from "../../api/validatePeriods";
import { useToday } from "../../shared/hooks/useToday";
import { sameId, type EntityId } from "../../api/client";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  clientForCase,
  money as formatMoney,
  shortDate,
  type ScreenProps,
} from "../../api/client";
import {
  configuredRate,
  draftInvoice,
  formatPreciseDuration,
  formatRoundedMinutes,
  summarizeWork,
} from "../../calculations/billing";
import { Card } from "../../shared/components/Card";
import { Pill } from "../../shared/components/Pill";
import { Icon } from "../../shared/components/Icon";
import { rate as rateLabel } from "../../shared/format";
import "./Billing.css";

let billingSort: SortState | null = null;
const billingDate = (value: string) => shortDate(value).replace(/\bSept\b/, "Sep");

function SavingSpinner() {
  return <span className="billing-spinner" aria-hidden="true" />;
}

export function PreInvoices({
  catalogState,
  workspaceState,
  action,
  navigate,
  selectedCase,
  refresh,
}: ScreenProps) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");

  const selectedCaseInvoiceType =
    selectedCase && catalogState.cases.find((m) => sameId(m.id, selectedCase))?.mode === "flat_fee"
      ? "final"
      : "deposit";
  const [selected, setSelected] = useState<EntityId | null>(selectedCase ?? null);
  const [type, setType] = useState<"final" | "deposit">(selectedCaseInvoiceType);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseType, setExpenseType] = useState<"expense" | "disbursement">("expense");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [sort, setSort] = useState<SortState | null>(billingSort);
  const [undoSort, setUndoSort] = useState<SortState | null | undefined>();
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [correctedMinutes, setCorrectedMinutes] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);
  const [tableFade, setTableFade] = useState({ top: false, bottom: false });
  const [breadcrumbHost, setBreadcrumbHost] = useState<HTMLElement | null>(null);
  const detailHeadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelected(selectedCase ?? null);
    if (selectedCase) setType(selectedCaseInvoiceType);
  }, [selectedCase, selectedCaseInvoiceType]);
  useEffect(() => {
    if (!notice || pendingAction) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setUndoSort(undefined);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [notice, pendingAction]);
  useEffect(() => {
    setBreadcrumbHost(detailHeadRef.current?.closest(".shell-main") as HTMLElement | null);
  }, [selected]);

  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;
    const update = () =>
      setTableFade({
        top: node.scrollTop > 2,
        bottom: node.scrollHeight - node.scrollTop > node.clientHeight + 2,
      });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const body = node.querySelector("tbody");
    if (body) observer.observe(body);
    update();
    return () => observer.disconnect();
  }, [
    selected,
    workspaceState.periods.length,
    workspaceState.billing.expenses.length,
    expenseOpen,
  ]);

  const validate = async (ids: string[]) => {
    if (pendingAction || !ids.length) return;
    setPendingAction("validate");
    setNotice(`Validating ${ids.length} period${ids.length === 1 ? "" : "s"}…`);
    try {
      const result = await runValidation(ids, refresh);
      setNotice(validationMessage(result.successful, ids.length, result.refreshFailed));
    } finally {
      setPendingAction(null);
    }
  };
  const item = catalogState.cases.find((caseItem) => sameId(caseItem.id, selected));
  if (!item) {
    return (
      <>
        <BillingOverview
          catalogState={catalogState}
          workspaceState={workspaceState}
          navigate={navigate}
          onSelect={(item) => {
            setSelected(item.id);
            setType(item.mode === "flat_fee" ? "final" : "deposit");
          }}
        />
        {notice && (
          <div className="toast billing-toast" role="status" onClick={() => setNotice("")}>
            {notice}
            {notice.startsWith("Sorted by") && undoSort !== undefined && (
              <button
                className="billing-toast-undo"
                onClick={(event) => {
                  event.stopPropagation();
                  billingSort = undoSort;
                  setSort(undoSort);
                  setUndoSort(undefined);
                  setNotice("Sort restored");
                }}
              >
                Undo
              </button>
            )}
            <span aria-hidden="true">×</span>
          </div>
        )}
      </>
    );
  }

  const owner = clientForCase(catalogState, item.id)!;
  const periods = workspaceState.periods
    .filter((period) => period.caseId === String(item.id) && !period.excluded)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
  const billed = periods.filter((period) => period.billable && period.billingStatus === "billed");
  const billable = periods.filter(
    (period) => period.billable && period.billingStatus === "unbilled",
  );
  const non = periods.filter((period) => !period.billable);
  const preview = draftInvoice(catalogState, workspaceState, item.id, type);
  const pending = billable.filter((period) => !period.timeValidated);
  const expenses = workspaceState.billing.expenses.filter(
    (expense) => expense.caseId === String(item.id) && expense.invoiceId === null,
  );
  const invoices = workspaceState.billing.invoices.filter(
    (invoice) => invoice.caseId === String(item.id),
  );
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const alreadyBilledCents = workspaceState.billing.lines
    .filter(
      (line) =>
        invoiceIds.has(line.invoiceId) &&
        (line.origin === "work_period" || line.origin === "flat_fee"),
    )
    .reduce((sum, line) => sum + line.amountCents, 0);
  const nextNumber = `${catalogState.settings.invoicePrefix}${String(catalogState.settings.nextNumber).padStart(4, "0")}`;
  const rate = configuredRate(catalogState, item.id);
  const alerts: string[] = [];
  for (const rule of catalogState.clientRules.filter((rule) => sameId(rule.clientId, owner.id))) {
    if (rule.type === "daily_research_cap") {
      const selectedIds = new Set(billable.map((period) => period.id));
      const research = workspaceState.periods.filter(
        (period) =>
          period.billable &&
          !period.excluded &&
          (period.billingStatus === "billed" || selectedIds.has(period.id)) &&
          sameId(
            catalogState.cases.find((caseItem) => String(caseItem.id) === period.caseId)?.clientId,
            owner.id,
          ) &&
          catalogState.taskTypes.find((task) => task.id === period.taskTypeId)?.code === "RECH",
      );
      const byDate = new Map<string, typeof research>();
      for (const period of research) {
        const date = calendarDay(period.startedAt);
        byDate.set(date, [...(byDate.get(date) ?? []), period]);
      }
      for (const [date, day] of byDate) {
        const ms = summarizeWork(day, workspaceState.sources).preciseDurationMs;
        if (ms > rule.value * 6 * 60000)
          alerts.push(
            `${owner.name} asked for at most ${formatRoundedMinutes(rule.value * 6)} of research per day. On ${shortDate(date)} you recorded ${formatPreciseDuration(ms)}. Check this line before you bill.`,
          );
      }
    }
    if (
      rule.type === "nonbillable_travel" &&
      billable.some(
        (period) =>
          catalogState.taskTypes.find((task) => task.id === period.taskTypeId)?.code === "DEPL",
      )
    )
      alerts.push(rule.label);
  }
  if (item.budgetCents && preview.feesCents >= item.budgetCents * 0.85)
    alerts.push("Case budget has reached 85%.");

  const rows = invoiceRows(item, billable, expenses, preview, today);
  const workRows = rows.filter((row) => row.kind === "period" || row.kind === "flat_fee");
  const expenseRows = rows.filter((row) => row.kind === "expense" || row.kind === "disbursement");
  const sortedWork = sort ? sortRows(workRows, sort.key, sort.direction) : workRows;
  const sortedExpenses =
    sort?.key === "date"
      ? sortRows(expenseRows, "date", sort.direction)
      : sortRows(expenseRows, "date", "ascending");
  const sorted = [...sortedWork, ...sortedExpenses];
  const sortHeader = (key: SortKey, title: string) => (
    <th scope="col" aria-sort={sort?.key === key ? sort.direction : undefined}>
      <button
        type="button"
        className="sort-button"
        onClick={() => {
          setUndoSort(sort);
          billingSort = {
            key,
            direction:
              sort?.key === key
                ? sort.direction === "ascending"
                  ? "descending"
                  : "ascending"
                : key === "label"
                  ? "ascending"
                  : "descending",
          };
          setSort(billingSort);
          setNotice(`Sorted by ${title.toLowerCase()}, ${billingSort.direction}`);
        }}
      >
        {title}
        <span className="billing-sort-indicator" aria-hidden="true">
          {" "}
          {sort?.key === key ? (sort.direction === "ascending" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
  const issue = async () => {
    if (pendingAction) return;
    setPendingAction("issue");
    setNotice("Creating invoice…");
    const { pendingPeriods, complete, ...snapshot } = preview;
    try {
      const result = await action(
        api.POST("/api/invoices", { body: { ...snapshot, type, timeZone: systemTimeZone() } }),
      );
      setNotice(result ? `Invoice ${nextNumber} created` : "Invoice could not be created.");
    } catch {
      setNotice("Invoice could not be created. Please try again.");
    } finally {
      setPendingAction(null);
    }
  };
  const downloadCsv = async () => {
    const csv = invoiceRowsCsv(rows, catalogState.settings.currency ?? "USD");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${nextNumber}-draft.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Spreadsheet downloaded");
  };

  return (
    <>
      {breadcrumbHost &&
        createPortal(
          <nav className="billing-crumbs-outer" aria-label="Billing breadcrumb">
            <button onClick={() => setSelected(null)}>Billing</button>
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
              <path
                d="m5 2.5 4.5 4.5L5 11.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <strong>
              {owner.name} · {item.title}
            </strong>
          </nav>,
          breadcrumbHost,
        )}
      <div ref={detailHeadRef} className="page-head billing-page-head billing-detail-head">
        <div>
          <h1>
            {owner.name} · {item.title}
          </h1>
          <p>Check what will be billed, then create the invoice.</p>
        </div>
        <button className="btn" onClick={() => setSelected(null)}>
          <svg className="i sm billing-back-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
          All billing
        </button>
      </div>
      <Card className="billing-hero billing-scope">
        <div>
          <h2>
            {item.mode === "flat_fee"
              ? `This case is billed at a flat fee of ${money(item.flatFeeCents ?? 0)}.`
              : `You can bill ${owner.name} ${money(preview.feesCents)} for ${formatRoundedMinutes(preview.billedMinutes)} of work.`}
          </h2>
          <p>
            {item.title} · {item.mode === "flat_fee" ? "flat fee" : rateLabel(rate.rateCents)}
            {alreadyBilledCents ? ` · ${money(alreadyBilledCents)} already billed` : ""}
          </p>
        </div>
        {pending.length ? (
          <div className="row">
            <Pill kind="warn">
              {pending.length} period{pending.length === 1 ? "" : "s"} to validate first
            </Pill>
            <button
              className="btn attn"
              disabled={pendingAction !== null}
              onClick={() => validate(pending.map((period) => period.id))}
            >
              {pendingAction === "validate" ? (
                <>
                  <SavingSpinner />
                  Validating…
                </>
              ) : (
                "Validate them"
              )}
            </button>
          </div>
        ) : (
          <Pill kind="ok">Everything is validated</Pill>
        )}
      </Card>
      {alerts.map((alert) => {
        const boundary = alert.indexOf(". On ");
        return (
          <div className="card-l warn billing-alert billing-scope" key={alert}>
            <Icon name="alert" />
            <span>
              {boundary < 0 ? (
                alert
              ) : (
                <>
                  <b>{alert.slice(0, boundary + 1)}</b>
                  {alert.slice(boundary + 1)}
                </>
              )}
            </span>
          </div>
        );
      })}
      <div className="billing-detail billing-scope">
        <Card className="billing-lines">
          <div className="billing-card-header">
            <div>
              <h2>What will be on the invoice</h2>
              <p>
                {billable.length} line{billable.length === 1 ? "" : "s"}
                {expenses.length
                  ? ` and ${expenses.length} cost${expenses.length === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>
            <button
              className="btn small"
              aria-expanded={expenseOpen}
              onClick={() => setExpenseOpen((value) => !value)}
            >
              <Icon name="plus" small />
              Add a cost
            </button>
          </div>
          <div
            ref={tableRef}
            className={`table-scroll${tableFade.top ? " billing-fade-top" : ""}${tableFade.bottom ? " billing-fade-bottom" : ""}`}
            onScroll={(event) => {
              const node = event.currentTarget;
              setTableFade({
                top: node.scrollTop > 2,
                bottom: node.scrollHeight - node.scrollTop > node.clientHeight + 2,
              });
            }}
          >
            <table>
              <thead>
                <tr>
                  {sortHeader("date", "Date")}
                  {sortHeader("label", "Work")}
                  {sortHeader("duration", "Time")}
                  {sortHeader("amount", "Amount")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, index) => (
                  <Fragment key={`${row.kind}-${row.id}`}>
                    {index === sortedWork.length && expenseRows.length > 0 && (
                      <tr className="billing-expense-subhead">
                        <td colSpan={4}>Expenses</td>
                      </tr>
                    )}
                    <tr className={editing === row.id ? "billing-row-selected" : undefined}>
                      <td className="num">{billingDate(row.date)}</td>
                      <td>
                        {row.label}
                        {(row.pending || row.kind !== "period") && (
                          <small className={row.pending ? "billing-pending" : ""}>
                            {row.pending
                              ? "To validate"
                              : row.kind === "disbursement"
                                ? "Cost paid for the client"
                                : row.kind === "expense"
                                  ? "Expense"
                                  : "Agreed flat fee"}
                          </small>
                        )}
                        {row.kind === "period" && (
                          <button
                            className="link billing-correct"
                            title="Correct time"
                            aria-label={`Correct time for ${row.label}`}
                            onClick={() => {
                              setEditing(row.id);
                              setCorrectedMinutes(String((row.durationMs ?? 0) / 60000));
                            }}
                          >
                            <Icon name="edit" small />
                          </button>
                        )}
                      </td>
                      <td className={`num${row.durationMs === null ? " muted" : ""}`}>
                        {editing === row.id ? (
                          <span className="row">
                            <input
                              className="field"
                              type="number"
                              min="0"
                              step="0.001"
                              aria-label="Corrected minutes"
                              value={correctedMinutes}
                              onChange={(event) => setCorrectedMinutes(event.target.value)}
                            />
                            <button
                              className="btn small"
                              disabled={pendingAction !== null}
                              onClick={async () => {
                                const value = Number(correctedMinutes);
                                if (!Number.isFinite(value) || value < 0) {
                                  setNotice("Enter a valid duration.");
                                  return;
                                }
                                setPendingAction(`correct-${row.id}`);
                                setNotice("Saving corrected time…");
                                try {
                                  const result = await action(
                                    api.POST("/api/work-periods/{id}/duration-override", {
                                      params: { path: { id: row.id } },
                                      body: { durationMs: Math.round(value * 60000) },
                                    }),
                                  );
                                  if (result) {
                                    setEditing(null);
                                    setNotice("Corrected time saved");
                                  } else setNotice("Could not save corrected time.");
                                } catch {
                                  setNotice("Could not save corrected time. Please try again.");
                                } finally {
                                  setPendingAction(null);
                                }
                              }}
                            >
                              {pendingAction === `correct-${row.id}` ? (
                                <>
                                  <SavingSpinner />
                                  Saving…
                                </>
                              ) : (
                                "Save"
                              )}
                            </button>
                          </span>
                        ) : row.durationMs === null ? (
                          "—"
                        ) : (
                          formatPreciseDuration(row.durationMs)
                        )}
                      </td>
                      <td className="num">
                        {row.amountCents === null ? "Included" : money(row.amountCents)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4}>
                      <div className="billing-empty-row">
                        Nothing left to bill on this case.{" "}
                        <button className="link" onClick={() => setSelected(null)}>
                          View all cases
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {expenseOpen && (
            <form
              className="row billing-cost-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (pendingAction) return;
                const cents = Math.round(Number(expenseAmount) * 100);
                if (!Number.isFinite(cents) || cents <= 0) {
                  setNotice("Enter a valid cost amount.");
                  return;
                }
                setPendingAction("expense");
                setNotice("Adding cost…");
                try {
                  const result = await action(
                    api.POST("/api/billing/expenses", {
                      body: {
                        caseId: String(item.id),
                        date: today,
                        label: expenseLabel,
                        type: expenseType,
                        amountCents: cents,
                      },
                    }),
                  );
                  if (result) {
                    setExpenseLabel("");
                    setExpenseAmount("");
                    setExpenseOpen(false);
                    setNotice("Cost added");
                  } else setNotice("Could not add cost.");
                } catch {
                  setNotice("Could not add cost. Please try again.");
                } finally {
                  setPendingAction(null);
                }
              }}
            >
              <input
                className="field grow"
                placeholder="Cost description"
                aria-label="Cost description"
                required
                value={expenseLabel}
                onChange={(event) => setExpenseLabel(event.target.value)}
              />
              <select
                className="field"
                value={expenseType}
                aria-label="Cost type"
                onChange={(event) => setExpenseType(event.target.value as typeof expenseType)}
              >
                <option value="expense">Expense</option>
                <option value="disbursement">Cost paid for the client</option>
              </select>
              <input
                className="field num"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                aria-label={`Amount in ${catalogState.settings.currency ?? "USD"}`}
                required
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
              />
              <button className="btn primary" disabled={pendingAction !== null}>
                {pendingAction === "expense" ? (
                  <>
                    <SavingSpinner />
                    Adding…
                  </>
                ) : (
                  "Add"
                )}
              </button>
            </form>
          )}
          {(billed.length > 0 || non.length > 0) && (
            <div className="billing-excluded">
              Not on this invoice:{" "}
              {billed.length
                ? `${formatRoundedMinutes(summarizeWork(billed, workspaceState.sources).roundedMinutes)} already billed`
                : ""}
              {billed.length && non.length ? " · " : ""}
              {non.length
                ? `${formatRoundedMinutes(summarizeWork(non, workspaceState.sources).roundedMinutes)} you chose not to bill`
                : ""}
              .
            </div>
          )}
        </Card>
        <Card className="billing-side">
          <div className="billing-card-header">
            <div>
              <h2>Invoice {nextNumber}</h2>
              <p>{owner.name}</p>
            </div>
          </div>
          <div className="billing-side-body">
            <div className="billing-totals">
              <span>Work</span>
              <strong>{money(preview.feesCents)}</strong>
              {preview.expensesCents > 0 && (
                <>
                  <span>Expenses</span>
                  <strong>{money(preview.expensesCents)}</strong>
                </>
              )}
              {preview.vatCents > 0 && (
                <>
                  <span>Sales tax</span>
                  <strong>{money(preview.vatCents)}</strong>
                </>
              )}
              {preview.disbursementsCents > 0 && (
                <>
                  <span>Costs paid for the client</span>
                  <strong>{money(preview.disbursementsCents)}</strong>
                </>
              )}
              <span>Total to pay</span>
              <strong>{money(preview.totalCents)}</strong>
            </div>
            <div>
              <span>Type of invoice</span>
              <div className="seg" role="group" aria-label="Type of invoice">
                <button aria-pressed={type === "deposit"} onClick={() => setType("deposit")}>
                  Deposit
                </button>
                <button aria-pressed={type === "final"} onClick={() => setType("final")}>
                  Final
                </button>
              </div>
              <small>
                {type === "deposit"
                  ? "An advance on the work done so far. The case stays open."
                  : "The last invoice for this case."}
              </small>
            </div>
            <button
              className="btn primary"
              disabled={
                pendingAction !== null ||
                (!pending.length && (!preview.complete || preview.totalCents === 0))
              }
              onClick={() =>
                pending.length ? validate(pending.map((period) => period.id)) : issue()
              }
            >
              {pendingAction === "validate" ? (
                <>
                  <SavingSpinner />
                  Validating…
                </>
              ) : pendingAction === "issue" ? (
                <>
                  <SavingSpinner />
                  Creating invoice…
                </>
              ) : pending.length ? (
                `Validate ${pending.length} period${pending.length === 1 ? "" : "s"}`
              ) : !preview.complete ? (
                "Resolve coverage gaps"
              ) : preview.totalCents === 0 ? (
                "Nothing to invoice"
              ) : (
                `Create invoice ${nextNumber}`
              )}
            </button>
            <button className="btn billing-download" onClick={downloadCsv}>
              <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
              </svg>
              Download as spreadsheet
            </button>
          </div>
        </Card>
      </div>
      {notice && (
        <div className="toast billing-toast" role="status" onClick={() => setNotice("")}>
          {notice}
          {notice.startsWith("Sorted by") && undoSort !== undefined && (
            <button
              className="billing-toast-undo"
              onClick={(event) => {
                event.stopPropagation();
                billingSort = undoSort;
                setSort(undoSort);
                setUndoSort(undefined);
                setNotice("Sort restored");
              }}
            >
              Undo
            </button>
          )}
          <span aria-hidden="true">×</span>
        </div>
      )}
    </>
  );
}
