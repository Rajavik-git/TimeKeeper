import { BillingStatus, CaseBillingMode, InvoiceType } from "../../contracts/states.generated";
import type { CoreState, Case, State, EntityId } from "../api/client";
import { caseBudget } from "./case-budget";
import { configuredRate, draftInvoice, summarizeWork } from "./billing";

export function caseMetrics(state: State, workspaceState: CoreState, item: Case) {
  const periods = workspaceState.periods.filter(
    (period) => period.caseId === String(item.id) && !period.excluded,
  );
  const summary = summarizeWork(periods, workspaceState.sources);
  const time = summary.roundedMinutes;
  const nonBillable = summarizeWork(
    periods.filter((period) => !period.billable),
    workspaceState.sources,
  ).roundedMinutes;
  // The Cases "To bill" view tracks unbilled hourly work. A flat fee is shown
  // as its pricing mode on the case, not as unbilled time in this overview.
  const toBill =
    item.mode === CaseBillingMode.FlatFee
      ? 0
      : draftInvoice(state, workspaceState, item.id, InvoiceType.Final).feesCents;
  const budget = caseBudget(state, workspaceState, item);
  const pending = periods.filter((period) => !period.timeValidated).length;
  const rate = configuredRate(state, item.id);
  return {
    complete: summary.complete,
    periods,
    time,
    nonBillable,
    toBill,
    spent: budget.spentCents,
    budget: budget.limitCents,
    budgetPercent: budget.percent,
    budgetComplete: budget.complete,
    pending,
    rate,
  };
}

export function clientMetrics(state: State, workspaceState: CoreState, clientId: EntityId) {
  const cases = state.cases.filter((item) => String(item.clientId) === String(clientId));
  const periods = workspaceState.periods.filter(
    (period) => cases.some((item) => String(item.id) === period.caseId) && !period.excluded,
  );
  const summary = summarizeWork(periods, workspaceState.sources);
  const time = summary.roundedMinutes;
  const hourlyCaseIds = new Set(
    cases.filter((item) => item.mode !== CaseBillingMode.FlatFee).map((item) => String(item.id)),
  );
  const hourlyTime = summarizeWork(
    periods.filter((period) => period.caseId !== null && hourlyCaseIds.has(period.caseId)),
    workspaceState.sources,
  ).roundedMinutes;
  const unbilledSummary = summarizeWork(
    periods.filter(
      (period) =>
        period.caseId !== null &&
        hourlyCaseIds.has(period.caseId) &&
        period.billable &&
        period.billingStatus === BillingStatus.Unbilled,
    ),
    workspaceState.sources,
  );
  const toBill = cases.reduce(
    (sum, item) => sum + caseMetrics(state, workspaceState, item).toBill,
    0,
  );
  const pending = periods.filter((period) => !period.timeValidated).length;
  const latest = periods.reduce(
    (date, period) =>
      !date || Date.parse(period.startedAt) > Date.parse(date) ? period.startedAt : date,
    "",
  );
  return {
    complete: summary.complete,
    cases,
    time,
    hourlyTime,
    unbilledSummary,
    toBill,
    pending,
    latest,
  };
}
