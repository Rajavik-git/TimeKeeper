import { periodDay, type CoreState, type Matter, type State } from '../api/client';
import { configuredRate, draftInvoice, effectiveMs, summarizeWork } from './billing';

export function caseMetrics(state: State, core: CoreState, item: Matter) {
  const periods = core.periods.filter(period => period.caseId === String(item.id) && !period.excluded);
  const time = summarizeWork(periods, core.sources).roundedMinutes;
  const nonBillable = summarizeWork(periods.filter(period => !period.billable), core.sources).roundedMinutes;
  // The Cases "To bill" view tracks unbilled hourly work. A flat fee is shown
  // as its pricing mode on the case, not as unbilled time in this overview.
  const toBill = item.mode === 'flat_fee' ? 0 : draftInvoice(state, core, item.id, 'final').feesCents;
  const issuedIds = new Set(core.billing.invoices.filter(invoice => invoice.caseId === String(item.id)).map(invoice => invoice.id));
  const issued = core.billing.lines.filter(line => issuedIds.has(line.invoiceId) &&
    (line.origin === 'work_period' || line.origin === 'flat_fee')).reduce((sum, line) => sum + line.amountCents, 0);
  const budget = item.mode === 'flat_fee' ? item.flat_fee_cents : item.budget_cents;
  const clientRate = state.client.find(client => client.id === item.client_id)?.rate_cents ?? state.firm[0]?.base_rate_cents ?? 0;
  const spent = item.mode === 'flat_fee'
    ? Math.round(summarizeWork(periods.filter(period => period.billable), core.sources).roundedMinutes * clientRate / 60)
    : issued + toBill;
  const budgetPercent = budget && budget > 0 ? Math.round(spent * 100 / budget) : null;
  const pending = periods.filter(period => !period.timeValidated).length;
  const rate = configuredRate(state, item.id);
  return { periods, time, nonBillable, toBill, spent, budget, budgetPercent, pending, rate };
}

export function clientMetrics(state: State, core: CoreState, clientId: number) {
  const cases = state.matter.filter(item => item.client_id === clientId);
  const periods = core.periods.filter(period => cases.some(item => String(item.id) === period.caseId) && !period.excluded);
  const time = summarizeWork(periods, core.sources).roundedMinutes;
  const hourlyCaseIds = new Set(cases.filter(item => item.mode !== 'flat_fee').map(item => String(item.id)));
  const hourlyTime = summarizeWork(periods.filter(period => period.caseId !== null && hourlyCaseIds.has(period.caseId)), core.sources).roundedMinutes;
  const toBill = cases.reduce((sum, item) => sum + caseMetrics(state, core, item).toBill, 0);
  const pending = periods.filter(period => !period.timeValidated).length;
  const latest = periods.reduce((date, period) => period.startedAt > date ? period.startedAt : date, '');
  return { cases, time, hourlyTime, toBill, pending, latest };
}

/** Values visible at the same date in the previous month. No historical alert state is inferred. */
export function previousMonthMetrics(state: State, core: CoreState, today: string) {
  const [year, month, day] = today.split('-').map(Number);
  const prior = new Date(Date.UTC(year!, month! - 2, day!));
  const previousDay = prior.toISOString().slice(0, 10);
  const monthStart = `${previousDay.slice(0, 7)}-01`;
  const previousCases = state.matter.filter(item => item.opened_on <= previousDay).length;
  const caseIds = new Set(state.matter.map(item => String(item.id)));
  const previousMinutes = Math.ceil(core.periods.filter(period => !period.excluded && period.caseId !== null && caseIds.has(period.caseId) && periodDay(period) >= monthStart && periodDay(period) <= previousDay)
    .reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000);
  const invoicesById = new Map(core.billing.invoices.map(invoice => [invoice.id, invoice.date]));
  const previousToBill = state.matter.reduce((total, item) => {
    if (item.mode === 'flat_fee') return total;
    const periods = core.periods.filter(period => {
      if (period.caseId !== String(item.id) || !period.billable || period.excluded || periodDay(period) > previousDay) return false;
      const invoiceId = period.invoiceId ?? state.time_entry.find(entry => String(entry.id) === period.id)?.invoice_id;
      const invoiceDate = invoiceId ? invoicesById.get(invoiceId) ?? state.invoice.find(invoice => invoice.id === invoiceId)?.date : null;
      return !invoiceDate || invoiceDate > previousDay;
    });
    const minutes = Math.ceil(periods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000);
    return total + Math.round(minutes * configuredRate(state, item.id).rateCents / 60);
  }, 0);
  return { previousDay, previousCases, previousMinutes, previousToBill };
}

/** A historical billing snapshot uses the validation and invoice dates, not today's flags. */
export function previousBillingMetrics(state: State, core: CoreState, today: string) {
  const [year, month, day] = today.split('-').map(Number);
  const previousDay = new Date(Date.UTC(year!, month! - 2, day!)).toISOString().slice(0, 10);
  const invoiceDates = new Map(core.billing.invoices.map(invoice => [invoice.id, invoice.date]));
  let readyCents = 0, waitingCases = 0, toBillCents = 0;
  for (const item of state.matter.filter(matter => matter.mode === 'hourly' && matter.status === 'open' && matter.opened_on <= previousDay)) {
    const periods = core.periods.filter(period => {
      if (period.caseId !== String(item.id) || !period.billable || period.excluded || periodDay(period) > previousDay) return false;
      const invoiceId = period.invoiceId ?? state.time_entry.find(entry => String(entry.id) === period.id)?.invoice_id;
      const invoiceDate = invoiceId ? invoiceDates.get(invoiceId) ?? state.invoice.find(invoice => invoice.id === invoiceId)?.date : null;
      return !invoiceDate || invoiceDate > previousDay;
    });
    if (!periods.length) continue;
    const minutes = Math.ceil(periods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000);
    const amount = Math.round(minutes * configuredRate(state, item.id).rateCents / 60);
    toBillCents += amount;
    if (periods.every(period => period.timeValidatedAt !== null && period.timeValidatedAt.slice(0, 10) <= previousDay)) readyCents += amount;
    else waitingCases++;
  }
  return { previousDay, readyCents, waitingCases, toBillCents };
}
