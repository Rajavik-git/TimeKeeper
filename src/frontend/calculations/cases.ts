import { calendarDay, shiftCalendarMonth } from "../../shared/dates";
import type { CoreState, Case, State, EntityId } from "../api/client";
import { configuredRate, draftInvoice, effectiveMs, summarizeWork } from "./billing";

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
    item.mode === "flat_fee" ? 0 : draftInvoice(state, workspaceState, item.id, "final").feesCents;
  const issuedIds = new Set(
    workspaceState.billing.invoices
      .filter((invoice) => invoice.caseId === String(item.id))
      .map((invoice) => invoice.id),
  );
  const issued = workspaceState.billing.lines
    .filter(
      (line) =>
        issuedIds.has(line.invoiceId) &&
        (line.origin === "work_period" || line.origin === "flat_fee"),
    )
    .reduce((sum, line) => sum + line.amountCents, 0);
  const budget = item.mode === "flat_fee" ? item.flatFeeCents : item.budgetCents;
  const clientRate =
    state.clients.find((client) => String(client.id) === String(item.clientId))?.hourlyRateCents ??
    state.settings.globalHourlyRateCents ??
    0;
  const spent =
    item.mode === "flat_fee"
      ? Math.round(
          (summarizeWork(
            periods.filter((period) => period.billable),
            workspaceState.sources,
          ).roundedMinutes *
            clientRate) /
            60,
        )
      : issued + toBill;
  const budgetPercent = budget && budget > 0 ? Math.round((spent * 100) / budget) : null;
  const pending = periods.filter((period) => !period.timeValidated).length;
  const rate = configuredRate(state, item.id);
  return {
    complete: summary.complete,
    periods,
    time,
    nonBillable,
    toBill,
    spent,
    budget,
    budgetPercent,
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
    cases.filter((item) => item.mode !== "flat_fee").map((item) => String(item.id)),
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
        period.billingStatus === "unbilled",
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

/** Values visible at the same date in the previous month. No historical alert state is inferred. */
export function previousMonthMetrics(state: State, workspaceState: CoreState, today: string) {
  const previousDay = shiftCalendarMonth(today, -1);
  const monthStart = `${previousDay.slice(0, 7)}-01`;
  const previousCases = state.cases.filter(
    (item) => item.openedOn !== null && item.openedOn <= previousDay,
  ).length;
  const caseIds = new Set(state.cases.map((item) => String(item.id)));
  const previousMinutes = Math.ceil(
    workspaceState.periods
      .filter(
        (period) =>
          !period.excluded &&
          period.caseId !== null &&
          caseIds.has(period.caseId) &&
          calendarDay(period.startedAt) >= monthStart &&
          calendarDay(period.startedAt) <= previousDay,
      )
      .reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000,
  );
  const invoicesById = new Map(
    workspaceState.billing.invoices.map((invoice) => [invoice.id, invoice.date]),
  );
  const previousToBill = state.cases.reduce((total, item) => {
    if (item.mode === "flat_fee" || item.openedOn === null || item.openedOn > previousDay)
      return total;
    const periods = workspaceState.periods.filter((period) => {
      if (
        period.caseId !== String(item.id) ||
        !period.billable ||
        period.excluded ||
        calendarDay(period.startedAt) > previousDay
      )
        return false;
      const invoiceId = period.invoiceId;
      const invoiceDate = invoiceId ? invoicesById.get(invoiceId) : null;
      return !invoiceDate || invoiceDate > previousDay;
    });
    const minutes = Math.ceil(
      periods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000,
    );
    return total + Math.round((minutes * configuredRate(state, item.id).rateCents) / 60);
  }, 0);
  return { previousDay, previousCases, previousMinutes, previousToBill };
}

/** A historical billing snapshot uses the validation and invoice dates, not today's flags. */
export function previousBillingMetrics(state: State, workspaceState: CoreState, today: string) {
  const previousDay = shiftCalendarMonth(today, -1);
  const invoiceDates = new Map(
    workspaceState.billing.invoices.map((invoice) => [invoice.id, invoice.date]),
  );
  let readyCents = 0,
    waitingCases = 0,
    toBillCents = 0;
  for (const item of state.cases.filter(
    (caseItem) =>
      caseItem.mode === "hourly" &&
      caseItem.status === "active" &&
      caseItem.openedOn !== null &&
      caseItem.openedOn <= previousDay,
  )) {
    const periods = workspaceState.periods.filter((period) => {
      if (
        period.caseId !== String(item.id) ||
        !period.billable ||
        period.excluded ||
        calendarDay(period.startedAt) > previousDay
      )
        return false;
      const invoiceId = period.invoiceId;
      const invoiceDate = invoiceId ? invoiceDates.get(invoiceId) : null;
      return !invoiceDate || invoiceDate > previousDay;
    });
    if (!periods.length) continue;
    const minutes = Math.ceil(
      periods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000,
    );
    const amount = Math.round((minutes * configuredRate(state, item.id).rateCents) / 60);
    toBillCents += amount;
    if (
      periods.every(
        (period) =>
          period.timeValidatedAt !== null && calendarDay(period.timeValidatedAt) <= previousDay,
      )
    )
      readyCents += amount;
    else waitingCases++;
  }
  return { previousDay, readyCents, waitingCases, toBillCents };
}
