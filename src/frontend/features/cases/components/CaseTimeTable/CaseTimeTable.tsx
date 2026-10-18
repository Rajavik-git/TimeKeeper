import { timeValidationUnavailable } from "../../../../shared/lib/timeValidation";
import { useToday } from "../../../../shared/hooks/useToday";
import { caseBillingModeLabels } from "../../../../shared/presentation/catalog";
import {
  billingStatusLabels,
  nonbillableReasonLabels,
  timeValidationLabels,
} from "../../../../shared/presentation/work-period";
import {
  BillingStatus,
  CaseBillingMode,
  ValidationStatus,
} from "../../../../../contracts/states.generated";
import type { Case, CoreState, ScreenProps } from "../../../../api/client";
import { effectiveMs, formatNearestMinuteDuration } from "../../../../calculations/billing";
import { calendarDay } from "../../../../../shared/dates";
import { money as formatMoney, shortDate } from "../../../../shared/format";

type Props = Pick<
  ScreenProps,
  "catalogState" | "openPeriodActivity" | "openPeriodReview" | "navigate"
> & {
  caseItem: Case;
  periods: CoreState["periods"];
  sources: CoreState["sources"];
  rateCents: number;
  sorting?: { column: number; direction: 1 | -1 };
  onSort: (column: number, numeric: boolean, label: string) => void;
  validatingIds: string[];
  onValidate: (ids: string[]) => Promise<void>;
};
export function periodLabel(label: string, reference: string) {
  const shortReference = reference.split("-").slice(0, 2).join("-");
  return label.startsWith(`[${shortReference}]`)
    ? label.slice(shortReference.length + 2).trimStart()
    : label;
}

/** Owns period sorting, row states and accessible review actions for a case. */
export function CaseTimeTable({
  catalogState,
  caseItem: currentCase,
  periods,
  sources,
  rateCents,
  sorting,
  onSort: changeSort,
  validatingIds,
  onValidate: validatePeriods,
  openPeriodActivity,
  openPeriodReview,
  navigate,
}: Props) {
  const today = useToday();
  const validating = validatingIds.length > 0;
  const money = (amount: number) => formatMoney(amount, catalogState.settings.currency);
  const sortedHeading = (label: string, column: number, numeric = false, right = false) => (
    <th
      className={`${right ? "r " : ""}case-sortable`}
      scope="col"
      aria-sort={
        sorting?.column === column
          ? sorting.direction === 1
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button type="button" onClick={() => changeSort(column, numeric, label)}>
        {label}
        {sorting?.column === column ? (sorting.direction === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  const amountFor = (line: (typeof periods)[number]) =>
    line.billingStatus === BillingStatus.Billed ||
    currentCase.mode === CaseBillingMode.FlatFee ||
    !line.billable ||
    effectiveMs(line) === null
      ? null
      : Math.round((effectiveMs(line)! * rateCents) / 3600000);
  const lines = [...periods].sort((a, b) => {
    if (!sorting)
      return Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id);
    const value = (line: typeof a) =>
      [
        Date.parse(line.startedAt),
        line.label,
        effectiveMs(line),
        amountFor(line),
        timeValidationLabels[
          line.timeValidated ? ValidationStatus.Validated : ValidationStatus.Unvalidated
        ],
        line.billingStatus,
      ][sorting.column];
    const av = value(a),
      bv = value(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (
      sorting.direction *
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv)))
    );
  });
  return (
    <div className="tbl">
      <table className="data-table">
        <thead>
          <tr>
            {sortedHeading("Date", 0, true)}
            {sortedHeading("Work performed", 1)}
            {sortedHeading("Duration", 2, true, true)}
            {sortedHeading("Amount", 3, true, true)}
            {sortedHeading("Status", 4)}
            {sortedHeading("Billing", 5)}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.id}
              data-work-period-id={line.id}
              className={sources.some((record) => record.workPeriodId === line.id) ? "click" : ""}
              tabIndex={sources.some((record) => record.workPeriodId === line.id) ? 0 : undefined}
              onClick={() => {
                if (sources.some((record) => record.workPeriodId === line.id))
                  openPeriodActivity(line.id);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (
                  (event.key === "Enter" || event.key === " ") &&
                  sources.some((record) => record.workPeriodId === line.id)
                ) {
                  event.preventDefault();
                  openPeriodActivity(line.id);
                }
              }}
            >
              <td>{shortDate(calendarDay(line.startedAt))}</td>
              <td className="wrap">
                {periodLabel(line.label, currentCase.reference)}
                <span className="sub">
                  {catalogState.taskTypes.find((task) => task.id === line.taskTypeId)?.label ??
                    "Work period"}
                </span>
              </td>
              <td className="r num">{formatNearestMinuteDuration(effectiveMs(line))}</td>
              <td className="r num">
                {line.billingStatus === BillingStatus.Billed
                  ? line.invoiceId != null
                    ? "Included in issued invoice"
                    : billingStatusLabels[line.billingStatus]
                  : currentCase.mode === CaseBillingMode.FlatFee
                    ? caseBillingModeLabels[CaseBillingMode.FlatFee]
                    : line.billable && effectiveMs(line) !== null
                      ? money(Math.round((effectiveMs(line)! * rateCents) / 3600000))
                      : "—"}
              </td>
              <td>
                {line.timeValidated ? (
                  <span className="st ok">
                    <i />
                    {timeValidationLabels[ValidationStatus.Validated]}
                  </span>
                ) : (
                  <span className="st warn">
                    <i />
                    {timeValidationLabels[ValidationStatus.Unvalidated]}
                  </span>
                )}
              </td>
              <td>
                {line.billable ? (
                  line.billingStatus === BillingStatus.Billed ? (
                    <span className="st billed">
                      <i />
                      {billingStatusLabels[line.billingStatus]}
                    </span>
                  ) : (
                    <span className="st">
                      <i />
                      {billingStatusLabels[line.billingStatus]}
                    </span>
                  )
                ) : (
                  <span className="st">
                    <i />
                    {line.nonbillableReason
                      ? nonbillableReasonLabels[line.nonbillableReason]
                      : "Non-billable"}
                  </span>
                )}
              </td>
              <td>
                <span className="case-rowact">
                  {openPeriodReview && (
                    <button
                      className="btn sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        openPeriodReview(line.id);
                      }}
                    >
                      Review
                    </button>
                  )}
                  {!line.timeValidated && (
                    <button
                      className="btn sm attn"
                      disabled={validating || timeValidationUnavailable(line, today) !== null}
                      title={timeValidationUnavailable(line, today) ?? undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        void validatePeriods([line.id]);
                      }}
                    >
                      {validatingIds.includes(line.id) ? "Validating…" : "Validate"}
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {!lines.length && (
            <tr>
              <td colSpan={7} className="case-empty">
                No work periods for this case yet.{" "}
                <button onClick={() => navigate("myDay")}>Open My day</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
