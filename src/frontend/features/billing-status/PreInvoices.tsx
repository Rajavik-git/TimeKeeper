import { researchCapDurationMs, researchCapMinutes } from "../../../shared/client-rule-policy";
import { issuedFees } from "../../calculations/invoice-fees";
import {
  ActionNotice,
  NOTICE_DURATION_MS,
} from "../../shared/components/ActionNotice/ActionNotice";
import { PageHeader } from "../../shared/components/PageHeader/PageHeader";
import { invoiceTypeLabels } from "../../shared/presentation/billing";
import { caseBillingModeLabels } from "../../shared/presentation/catalog";
import { timeValidationLabels } from "../../shared/presentation/work-period";
import {
  BillingStatus,
  CaseBillingMode,
  ClientRuleType,
  InvoiceType,
  ValidationStatus,
  SystemTaskCode,
} from "../../../contracts/states.generated";
import { calendarDay, systemTimeZone } from "../../../shared/dates";
import { ExpenseForm } from "./components/ExpenseForm/ExpenseForm";
import { IssuedInvoiceDialog } from "./components/IssuedInvoiceDialog/IssuedInvoiceDialog";
import { BillingOverview } from "./components/BillingOverview/BillingOverview";
import {
  invoiceRows,
  invoiceRowsCsv,
  sortRows,
  type SortState,
  type SortKey,
} from "./lib/invoiceRows";
import { validatePeriods as runValidation, validationMessage } from "../../api/validatePeriods";
import { coverageProblems } from "../../calculations/coverage";
import { useToday } from "../../shared/hooks/useToday";
import { sameId, type EntityId } from "../../api/client";
import { Fragment, useEffect, useRef, useState } from "react";
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
import { Card } from "../../shared/components/Card/Card";
import { Pill } from "../../shared/components/Pill/Pill";
import { Icon } from "../../shared/components/Icon/Icon";
import { caseBudget, isBudgetWarning, budgetWarningMessage } from "../../calculations/case-budget";
import { rate as rateLabel } from "../../shared/format";

let billingSort: SortState | null = null;
const billingDate = (value: string) => shortDate(value).replace(/\bSept\b/, "Sep");

function SavingSpinner() {
  return <span className="billing-spinner" aria-hidden="true" />;
}

type BillingProps = ScreenProps & {
  selection?: EntityId | null;
  setSelection?: React.Dispatch<React.SetStateAction<EntityId | null>>;
};
export function PreInvoices({
  catalogState,
  workspaceState,
  action,
  navigate,
  selectedCase,
  refresh,
  openPeriodReview,
  openPeriodActivity,
  selection,
  setSelection,
}: BillingProps) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");

  const selectedCaseInvoiceType =
    selectedCase &&
    catalogState.cases.find((m) => sameId(m.id, selectedCase))?.mode === CaseBillingMode.FlatFee
      ? InvoiceType.Final
      : InvoiceType.Deposit;
  const [localSelection, setLocalSelection] = useState<EntityId | null>(selectedCase ?? null);
  const selected = selection === undefined ? localSelection : selection;
  const setSelected = setSelection ?? setLocalSelection;
  const [type, setType] = useState<InvoiceType>(selectedCaseInvoiceType);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(billingSort);
  const [undoSort, setUndoSort] = useState<SortState | null | undefined>();
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [tableFade, setTableFade] = useState({ top: false, bottom: false });
  const [invoiceError, setInvoiceError] = useState("");
  const [issuedInvoiceId, setIssuedInvoiceId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedCase !== undefined) {
      setSelected(selectedCase);
      setType(selectedCaseInvoiceType);
    }
  }, [selectedCase, selectedCaseInvoiceType, setSelected]);
  useEffect(() => {
    if (!notice || pendingAction) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setUndoSort(undefined);
    }, NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, pendingAction]);

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
      const result = await runValidation(
        workspaceState.periods.filter((period) => ids.includes(period.id)),
        refresh,
      );
      setNotice(
        validationMessage(result.successful, ids.length, result.refreshFailed, result.stale),
      );
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
            setType(
              item.mode === CaseBillingMode.FlatFee ? InvoiceType.Final : InvoiceType.Deposit,
            );
          }}
        />
        {notice && (
          <ActionNotice
            message={notice}
            dismiss={() => setNotice("")}
            actionLabel={
              notice.startsWith("Sorted by") && undoSort !== undefined ? "Undo" : undefined
            }
            onAction={() => {
              if (undoSort === undefined) return;
              billingSort = undoSort;
              setSort(undoSort);
              setUndoSort(undefined);
              setNotice("Sort restored");
            }}
          />
        )}
      </>
    );
  }

  const owner = clientForCase(catalogState, item.id)!;
  const periods = workspaceState.periods
    .filter((period) => period.caseId === String(item.id) && !period.excluded)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
  const billed = periods.filter(
    (period) => period.billable && period.billingStatus === BillingStatus.Billed,
  );
  const billable = periods.filter(
    (period) => period.billable && period.billingStatus === BillingStatus.Unbilled,
  );
  const non = periods.filter((period) => !period.billable);
  const preview = draftInvoice(catalogState, workspaceState, item.id, type);
  const coverageBlockers = billable
    .map((period) => ({ period, reasons: coverageProblems(period, workspaceState.sources) }))
    .filter((item) => item.reasons.length > 0);
  const pending = billable.filter((period) => !period.timeValidated);
  const expenses = workspaceState.billing.expenses.filter(
    (expense) => expense.caseId === String(item.id) && expense.invoiceId === null,
  );
  const invoices = workspaceState.billing.invoices.filter(
    (invoice) => invoice.caseId === String(item.id),
  );
  const alreadyBilled = issuedFees(
    invoices,
    workspaceState.billing.lines,
    catalogState.settings.currency,
  );
  const nextNumber = `${catalogState.settings.invoicePrefix}${String(catalogState.settings.nextNumber).padStart(4, "0")}`;
  const rate = configuredRate(catalogState, item.id);
  const alerts: string[] = [];
  for (const rule of catalogState.clientRules.filter((rule) => sameId(rule.clientId, owner.id))) {
    if (rule.type === ClientRuleType.DailyResearchCap) {
      const selectedIds = new Set(billable.map((period) => period.id));
      const research = workspaceState.periods.filter(
        (period) =>
          period.billable &&
          !period.excluded &&
          (period.billingStatus === BillingStatus.Billed || selectedIds.has(period.id)) &&
          sameId(
            catalogState.cases.find((caseItem) => String(caseItem.id) === period.caseId)?.clientId,
            owner.id,
          ) &&
          catalogState.taskTypes.find((task) => task.id === period.taskTypeId)?.code ===
            SystemTaskCode.Research,
      );
      const byDate = new Map<string, typeof research>();
      for (const period of research) {
        const date = calendarDay(period.startedAt);
        byDate.set(date, [...(byDate.get(date) ?? []), period]);
      }
      for (const [date, day] of byDate) {
        const ms = summarizeWork(day, workspaceState.sources).preciseDurationMs;
        if (ms > researchCapDurationMs(rule.value))
          alerts.push(
            `${owner.name} asked for at most ${formatRoundedMinutes(researchCapMinutes(rule.value))} of research per day. On ${shortDate(date)} you recorded ${formatPreciseDuration(ms)}. Check this line before you bill.`,
          );
      }
    }
    if (
      rule.type === ClientRuleType.NonbillableTravel &&
      billable.some(
        (period) =>
          catalogState.taskTypes.find((task) => task.id === period.taskTypeId)?.code ===
          SystemTaskCode.Travel,
      )
    )
      alerts.push(rule.label);
  }
  const budget = caseBudget(catalogState, workspaceState, item);
  if (isBudgetWarning(budget.percent)) alerts.push(budgetWarningMessage(item.mode));
  if (budget.limitCents !== null && !budget.complete)
    alerts.push(
      "Budget comparison unavailable: some work durations, sources, rates, or currencies are missing or differ.",
    );

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
    if (expenseOpen) {
      setNotice("Save or close the cost form before creating an invoice.");
      return;
    }
    if (pendingAction) return;
    setPendingAction("issue");
    setInvoiceError("");
    setNotice("Creating invoice…");
    const { pendingPeriods, complete, ...snapshot } = preview;
    try {
      const result = await action(
        api.POST("/api/invoices", { body: { ...snapshot, type, timeZone: systemTimeZone() } }),
        setInvoiceError,
      );
      if (!result) setNotice("");
      if (result) setIssuedInvoiceId(result.id);
      if (result) setNotice(`Invoice ${result.number} created`);
    } catch {
      setInvoiceError("Invoice could not be created. Please try again.");
      setNotice("");
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
      </nav>
      <PageHeader
        className="page-head billing-page-head billing-detail-head"
        title={
          <>
            {owner.name} · {item.title}
          </>
        }
        description={<>Check what will be billed, then create the invoice.</>}
        actions={
          <button className="btn" onClick={() => setSelected(null)}>
            <svg className="i sm billing-back-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
            All billing
          </button>
        }
      />
      <Card className="billing-hero billing-scope">
        <div>
          <h2>
            {item.mode === CaseBillingMode.FlatFee
              ? `This case is billed at a flat fee of ${money(item.flatFeeCents ?? 0)}.`
              : `Estimated fees for ${owner.name}: ${money(preview.feesCents)} for ${formatRoundedMinutes(preview.billedMinutes)} of work.`}
          </h2>
          <p>
            {item.title} ·{" "}
            {item.mode === CaseBillingMode.FlatFee
              ? caseBillingModeLabels[item.mode]
              : rateLabel(rate.rateCents)}
            {invoices.length
              ? alreadyBilled.cents === null
                ? " · Issued fees have missing or different currencies"
                : ` · ${money(alreadyBilled.cents)} in issued work fees`
              : ""}
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
          <Pill kind="ok">
            {timeValidationLabels[ValidationStatus.Validated]} for included periods
          </Pill>
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
      {issuedInvoiceId !== null &&
        (() => {
          const invoice = workspaceState.billing.invoices.find(
            (entry) => entry.id === issuedInvoiceId,
          );
          return invoice ? (
            <IssuedInvoiceDialog
              invoice={invoice}
              lines={workspaceState.billing.lines}
              close={() => setIssuedInvoiceId(null)}
            />
          ) : (
            <p role="status">Invoice created. Refresh Billing to open the issued snapshot.</p>
          );
        })()}
      {invoiceError && <p role="alert">{invoiceError}</p>}
      <div className="billing-detail billing-scope">
        <Card className="card-flush billing-lines">
          <div className="card-h billing-card-header">
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
              disabled={pendingAction !== null}
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
            <table className="data-table">
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
                        <td colSpan={4}>Expenses and disbursements</td>
                      </tr>
                    )}
                    <tr data-work-period-id={row.kind === "period" ? row.id : undefined}>
                      <td className="num">{billingDate(row.date)}</td>
                      <td>
                        {row.label}
                        {(row.pending || row.kind !== "period") && (
                          <small className={row.pending ? "billing-pending" : ""}>
                            {row.pending
                              ? "Time to validate"
                              : row.kind === "disbursement"
                                ? "Disbursement"
                                : row.kind === "expense"
                                  ? "Expense"
                                  : "Agreed flat fee"}
                          </small>
                        )}
                        {row.kind === "period" && (
                          <button
                            className="btn sm ghost iconbtn billing-correct"
                            title="Correct time"
                            aria-label={`Correct time for ${row.label}`}
                            disabled={!openPeriodReview}
                            onClick={() => openPeriodReview?.(row.id)}
                          >
                            <Icon name="edit" small />
                          </button>
                        )}
                      </td>
                      <td className={`num${row.durationMs === null ? " muted" : ""}`}>
                        {row.durationMs === null ? "—" : formatPreciseDuration(row.durationMs)}
                      </td>
                      <td className="num">
                        {row.amountCents !== null
                          ? money(row.amountCents)
                          : item.mode === CaseBillingMode.FlatFee
                            ? "Included in flat fee"
                            : row.durationMs === null
                              ? "Amount unavailable"
                              : money(0)}
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
            <ExpenseForm
              caseId={String(item.id)}
              currency={catalogState.settings.currency ?? "USD"}
              action={action}
              close={() => setExpenseOpen(false)}
              notify={setNotice}
              busy={pendingAction === "expense"}
              setBusy={(busy) => setPendingAction(busy ? "expense" : null)}
            />
          )}

          {(billed.length > 0 || non.length > 0) && (
            <div className="card-b billing-excluded">
              Not on this invoice:{" "}
              {billed.length
                ? `${formatRoundedMinutes(summarizeWork(billed, workspaceState.sources).roundedMinutes)} already billed`
                : ""}
              {billed.length && non.length ? " · " : ""}
              {non.length
                ? `${formatRoundedMinutes(summarizeWork(non, workspaceState.sources).roundedMinutes)} non-billable`
                : ""}
              .
            </div>
          )}
        </Card>
        <Card className="card-flush billing-side">
          <div className="card-h billing-card-header">
            <div>
              <h2>Invoice {nextNumber}</h2>
              <p>{owner.name}</p>
            </div>
          </div>
          <div className="card-b billing-side-body">
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
                  <span>VAT</span>
                  <strong>{money(preview.vatCents)}</strong>
                </>
              )}
              {preview.disbursementsCents > 0 && (
                <>
                  <span>Disbursements</span>
                  <strong>{money(preview.disbursementsCents)}</strong>
                </>
              )}
              <span>Invoice total</span>
              <strong>{money(preview.totalCents)}</strong>
            </div>
            <div>
              <span>Type of invoice</span>
              <div className="seg" role="group" aria-label="Type of invoice">
                <button
                  aria-pressed={type === InvoiceType.Deposit}
                  onClick={() => setType(InvoiceType.Deposit)}
                >
                  {invoiceTypeLabels[InvoiceType.Deposit]}
                </button>
                <button
                  aria-pressed={type === InvoiceType.Final}
                  onClick={() => setType(InvoiceType.Final)}
                >
                  {invoiceTypeLabels[InvoiceType.Final]}
                </button>
              </div>
              <small>
                {type === InvoiceType.Deposit
                  ? "An advance on the work done so far. The case stays open."
                  : "The last invoice for this case."}
              </small>
            </div>
            {coverageBlockers.length > 0 && (
              <div className="billing-coverage-blockers" role="status">
                <b>Invoice blocked by incomplete coverage</b>
                <ul>
                  {coverageBlockers.map(({ period, reasons }) => (
                    <li key={period.id}>
                      <span>
                        {shortDate(calendarDay(period.startedAt))} · {period.label}:{" "}
                        {reasons.join(" ")}
                      </span>{" "}
                      <button
                        className="link"
                        onClick={() =>
                          openPeriodReview
                            ? openPeriodReview(period.id)
                            : openPeriodActivity(period.id)
                        }
                      >
                        Review period
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                "Coverage review required"
              ) : preview.totalCents === 0 ? (
                "Nothing to invoice"
              ) : (
                `Create invoice ${nextNumber}`
              )}
            </button>
            <button className="btn ghost billing-download" onClick={downloadCsv}>
              <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
              </svg>
              Download as spreadsheet
            </button>
          </div>
        </Card>
      </div>
      {notice && (
        <ActionNotice
          message={notice}
          dismiss={() => setNotice("")}
          actionLabel={
            notice.startsWith("Sorted by") && undoSort !== undefined ? "Undo" : undefined
          }
          onAction={() => {
            if (undoSort === undefined) return;
            billingSort = undoSort;
            setSort(undoSort);
            setUndoSort(undefined);
            setNotice("Sort restored");
          }}
        />
      )}
    </>
  );
}
