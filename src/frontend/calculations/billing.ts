import { resolveHourlyRate } from "../../shared/rate-policy";
import {
  AvailabilityStatus,
  BillingStatus,
  CaseBillingMode,
  ExpenseType,
  InvoiceLineOrigin,
  InvoiceType,
  RateOrigin,
} from "../../contracts/states.generated";
import { invoiceAmounts } from "../../shared/invoice-math";
import type { CoreState, State, EntityId, Client } from "../api/client";
import { summarize, type Summary } from "./summary";

export type Period = CoreState["periods"][number];
export type Case = State["cases"][number];
export type InvoiceDraft = {
  caseId: EntityId;
  periodIds: string[];
  revisions: Record<string, number>;
  billedMinutes: number;
  rateCents: number;
  rateOrigin: RateOrigin;
  feesCents: number;
  subtotalCents: number;
  expensesCents: number;
  disbursementsCents: number;
  vatCents: number;
  totalCents: number;
  pendingPeriods: number;
  complete: boolean;
  lines: Array<{
    origin: InvoiceLineOrigin;
    originId: string;
    label: string;
    billedMinutes: number;
    rateCents: number;
    amountCents: number;
    vat: boolean;
  }>;
};

export const effectiveMs = (
  period: Pick<Period, "detectedDurationMs" | "durationOverrideMs">,
): number | null => period.durationOverrideMs ?? period.detectedDurationMs;

export {
  nearestMinuteDuration as formatNearestMinuteDuration,
  minutes as formatRoundedMinutes,
} from "../shared/format";

export function hasCoverageGap(period: Period, sources: CoreState["sources"]): boolean {
  if (effectiveMs(period) === null) return true;
  const linked = sources.filter((source) => source.workPeriodId === period.id);
  if (linked.some((source) => source.availabilityStatus !== AvailabilityStatus.Available))
    return true;
  if (period.durationOverrideMs !== null) return false;
  return linked.length === 0;
}

export function summarizeWork(periods: readonly Period[], sources: CoreState["sources"]): Summary {
  return summarize(
    periods
      .filter((period) => !period.excluded)
      .map((period) => ({
        id: period.id,
        caseId: period.caseId,
        clientId: period.clientId ?? null,
        startedAt: period.startedAt,
        endedAt: period.endedAt,
        detectedDurationMs: period.detectedDurationMs,
        durationOverrideMs: period.durationOverrideMs,
        coverage: hasCoverageGap(period, sources) ? "incomplete" : "complete",
      })),
  );
}

export function configuredClientRate(state: State, client: Client): number {
  return (
    resolveHourlyRate({
      clientRateCents: client.hourlyRateCents,
      globalRateCents: state.settings.globalHourlyRateCents,
    }).rateCents ?? 0
  );
}

export function configuredRate(
  state: State,
  caseId: EntityId,
): { rateCents: number; origin: RateOrigin } {
  const item = state.cases.find((m) => String(m.id) === String(caseId));
  if (!item) throw Error("Case not found");
  const client = state.clients.find((candidate) => String(candidate.id) === String(item.clientId));
  const resolved = resolveHourlyRate({
    flatFee: item.mode === CaseBillingMode.FlatFee,
    caseRateCents: item.hourlyRateCents,
    clientRateCents: client?.hourlyRateCents,
    globalRateCents: state.settings.globalHourlyRateCents,
  });
  return { rateCents: resolved.rateCents ?? 0, origin: resolved.origin };
}

export { dayFees, type FeeEstimate } from "./fees";

export function needsTimeValidation(period: Pick<Period, "excluded" | "timeValidated">) {
  return !period.excluded && !period.timeValidated;
}

export function draftInvoice(
  state: State,
  workspaceState: CoreState,
  caseId: EntityId,
  type: InvoiceType,
): InvoiceDraft {
  const item = state.cases.find((m) => String(m.id) === String(caseId));
  if (!item) throw Error("Case not found");
  const client = state.clients.find((c) => String(c.id) === String(item.clientId));
  if (!client) throw Error("Client not found");
  const periods = workspaceState.periods.filter(
    (p) =>
      p.caseId === String(caseId) &&
      !p.excluded &&
      p.billable &&
      p.billingStatus === BillingStatus.Unbilled,
  );
  const summary = summarizeWork(periods, workspaceState.sources);
  const rate = configuredRate(state, caseId);
  const flatFeeDue =
    item.mode === CaseBillingMode.FlatFee &&
    type === InvoiceType.Final &&
    !workspaceState.billing.invoices.some(
      (i) => i.caseId === String(caseId) && i.type === InvoiceType.Final,
    );
  const expenses = workspaceState.billing.expenses.filter(
    (e) => e.caseId === String(caseId) && !e.invoiceId,
  );
  const expensesCents = expenses
    .filter((e) => e.type === ExpenseType.Expense)
    .reduce((total, e) => total + e.amountCents, 0);
  const disbursementsCents = expenses
    .filter((e) => e.type === ExpenseType.Disbursement)
    .reduce((total, e) => total + e.amountCents, 0);
  const amounts = invoiceAmounts({
    durationMs: summary.preciseDurationMs,
    rateCents: rate.rateCents,
    flatFeeCents:
      rate.origin === RateOrigin.FlatFee ? (flatFeeDue ? (item.flatFeeCents ?? 0) : 0) : null,
    expensesCents,
    disbursementsCents,
    vatRate: state.settings.vatRate ?? 0,
    vatApplicable: client.vatApplicable,
  });
  const { feesCents } = amounts;
  const lines: InvoiceDraft["lines"] = [];
  if (flatFeeDue)
    lines.push({
      origin: InvoiceLineOrigin.FlatFee,
      originId: String(caseId),
      label: `Agreed flat fee · ${item.title}`,
      billedMinutes: 0,
      rateCents: 0,
      amountCents: feesCents,
      vat: true,
    });
  if (periods.length)
    lines.push({
      origin: InvoiceLineOrigin.WorkPeriod,
      originId: String(caseId),
      label: `Work on ${item.title}`,
      billedMinutes: summary.roundedMinutes,
      rateCents: rate.rateCents,
      amountCents: rate.origin === RateOrigin.FlatFee ? 0 : feesCents,
      vat: true,
    });
  for (const expense of expenses)
    lines.push({
      origin: InvoiceLineOrigin.Expense,
      originId: String(expense.id),
      label: expense.label,
      billedMinutes: 0,
      rateCents: 0,
      amountCents: expense.amountCents,
      vat: expense.type !== ExpenseType.Disbursement,
    });
  return {
    caseId,
    periodIds: periods.map((p) => p.id),
    revisions: Object.fromEntries(periods.map((p) => [p.id, p.effectiveRevision])),
    ...amounts,
    rateCents: rate.rateCents,
    rateOrigin: rate.origin,
    pendingPeriods: periods.filter((p) => !p.timeValidated).length,
    complete: summary.complete,
    lines,
  };
}
