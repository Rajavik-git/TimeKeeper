import {
  BillingStatus,
  CaseBillingMode,
  InvoiceLineOrigin,
} from "../../contracts/states.generated";
import type { Case, CoreState, State } from "../api/client";
import { effectiveMs, summarizeWork, type Period } from "./billing";

/** Fees consumed, excluding expenses and tax. Invoice lines are already frozen. */
export function caseBudget(state: State, workspace: CoreState, item: Case) {
  const flatFee = item.mode === CaseBillingMode.FlatFee;
  const limitCents = flatFee ? item.flatFeeCents : item.budgetCents;
  const periods = workspace.periods.filter(
    (period) => period.caseId === String(item.id) && !period.excluded && period.billable,
  );
  const currency = state.settings.currency;
  let complete = Boolean(currency);
  let knownCents = 0;
  const groups = new Map<number, Period[]>();
  const addPeriods = (selected: Period[], rate: number | null | undefined) => {
    if (rate === null || rate === undefined) {
      if (selected.length) complete = false;
      return;
    }
    groups.set(rate, [...(groups.get(rate) ?? []), ...selected]);
  };
  const client = state.clients.find((candidate) => String(candidate.id) === String(item.clientId));
  if (flatFee) {
    // This is a work-value estimate, not the fraction of the agreed fee invoiced.
    addPeriods(periods, client?.hourlyRateCents ?? state.settings.globalHourlyRateCents);
  } else {
    const invoices = workspace.billing.invoices.filter(
      (invoice) => invoice.caseId === String(item.id),
    );
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    if (periods.some((period) => period.invoiceId != null && !invoiceIds.has(period.invoiceId)))
      complete = false;
    for (const invoice of invoices) {
      const lines = workspace.billing.lines.filter(
        (line) =>
          line.invoiceId === invoice.id &&
          (line.origin === InvoiceLineOrigin.WorkPeriod ||
            line.origin === InvoiceLineOrigin.FlatFee),
      );
      if (!lines.length) {
        if (periods.some((period) => period.invoiceId === invoice.id)) complete = false;
        continue;
      }
      if (!currency || invoice.currency !== currency) {
        complete = false;
        continue;
      }
      knownCents += lines.reduce((total, line) => total + line.amountCents, 0);
    }
    for (const period of periods.filter((candidate) => candidate.invoiceId == null)) {
      if (period.billingStatus === BillingStatus.Billed) {
        if (!currency || period.appliedCurrency !== currency) {
          complete = false;
          continue;
        }
        addPeriods([period], period.appliedHourlyRateCents);
      } else {
        addPeriods(
          [period],
          item.hourlyRateCents ?? client?.hourlyRateCents ?? state.settings.globalHourlyRateCents,
        );
      }
    }
  }
  for (const [rate, selected] of groups) {
    const summary = summarizeWork(selected, workspace.sources);
    // Missing evidence affects coverage review, not the value of a known duration.
    complete &&= selected.every((period) => effectiveMs(period) !== null);
    knownCents += Math.round((summary.roundedMinutes * rate) / 60);
  }
  const spentCents = complete ? knownCents : null;
  const percent =
    spentCents !== null && limitCents !== null && limitCents > 0
      ? (spentCents * 100) / limitCents
      : null;
  return { limitCents, spentCents, knownCents, complete, percent };
}

/** Alert on the precise percentage before display rounding. */
export const BUDGET_WARNING_PERCENT = 85;
export const isBudgetWarning = (percent: number | null | undefined) =>
  percent != null && percent >= BUDGET_WARNING_PERCENT;
export const budgetWarningMessage = (mode: Case["mode"]) =>
  mode === CaseBillingMode.FlatFee
    ? `Estimated hourly work value has reached ${BUDGET_WARNING_PERCENT}% of the agreed flat fee.`
    : `Case budget has reached ${BUDGET_WARNING_PERCENT}%. Let the client know.`;
