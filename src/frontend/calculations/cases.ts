import type { CoreState, Matter, State } from '../api/client';
import { configuredRate, draftInvoice, summarizeWork } from './billing';

export function caseMetrics(state: State, core: CoreState, item: Matter) {
  const periods = core.periods.filter(period => period.caseId === String(item.id) && !period.excluded);
  const time = summarizeWork(periods, core.sources).roundedMinutes;
  const nonBillable = summarizeWork(periods.filter(period => !period.billable), core.sources).roundedMinutes;
  const toBill = draftInvoice(state, core, item.id, 'final').feesCents;
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
  const toBill = cases.reduce((sum, item) => sum + caseMetrics(state, core, item).toBill, 0);
  const pending = periods.filter(period => !period.timeValidated).length;
  const latest = periods.reduce((date, period) => period.startedAt > date ? period.startedAt : date, '');
  return { cases, time, toBill, pending, latest };
}
