import { invoiceAmounts } from "../../shared/invoice-math";
import type { CoreState, State, EntityId } from "../api/client";
import { summarize, type Summary } from "./summary";

export type Period = CoreState["periods"][number];
export type Case = State["cases"][number];
export type InvoiceDraft = {
  caseId: EntityId;
  periodIds: string[];
  revisions: Record<string, number>;
  billedMinutes: number;
  rateCents: number;
  rateOrigin: "matter" | "client" | "base" | "flat_fee";
  feesCents: number;
  subtotalCents: number;
  expensesCents: number;
  disbursementsCents: number;
  vatCents: number;
  totalCents: number;
  pendingPeriods: number;
  complete: boolean;
  lines: Array<{
    origin: "work_period" | "expense" | "flat_fee";
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
  duration as formatPreciseDuration,
  minutes as formatRoundedMinutes,
} from "../shared/format";

export function hasCoverageGap(period: Period, sources: CoreState["sources"]): boolean {
  if (effectiveMs(period) === null) return true;
  const linked = sources.filter((source) => source.workPeriodId === period.id);
  if (linked.some((source) => source.availabilityStatus !== "available")) return true;
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

export function configuredRate(
  state: State,
  caseId: EntityId,
): { rateCents: number; origin: "matter" | "client" | "base" | "flat_fee" } {
  const item = state.cases.find((m) => String(m.id) === String(caseId));
  if (!item) throw Error("Case not found");
  if (item.mode === "flat_fee") return { rateCents: 0, origin: "flat_fee" };
  const client = state.clients.find((c) => String(c.id) === String(item.clientId));
  if (item.hourlyRateCents !== null) return { rateCents: item.hourlyRateCents, origin: "matter" };
  if (typeof client?.hourlyRateCents === "number")
    return { rateCents: client.hourlyRateCents, origin: "client" };
  return { rateCents: state.settings.globalHourlyRateCents ?? 0, origin: "base" };
}

export function dayFees(
  state: State,
  workspaceState: CoreState,
  periods: readonly Period[],
): number {
  const byRate = new Map<string, { periods: Period[]; rateCents: number }>();
  for (const period of periods.filter((p) => !p.excluded && p.billable)) {
    const configured = period.caseId
      ? configuredRate(state, period.caseId)
      : { rateCents: state.settings.globalHourlyRateCents ?? 0, origin: "base" as const };
    if (configured.origin === "flat_fee") continue;
    const rateCents =
      period.billingStatus === "billed"
        ? (period.appliedHourlyRateCents ?? configured.rateCents)
        : configured.rateCents;
    const key = `${period.caseId ?? ""}:${rateCents}`;
    const group = byRate.get(key) ?? { periods: [], rateCents };
    group.periods.push(period);
    byRate.set(key, group);
  }
  let fees = 0;
  for (const group of byRate.values()) {
    fees += Math.round(
      (summarizeWork(group.periods, workspaceState.sources).roundedMinutes * group.rateCents) / 60,
    );
  }
  return fees;
}

export function draftInvoice(
  state: State,
  workspaceState: CoreState,
  caseId: EntityId,
  type: "deposit" | "final",
): InvoiceDraft {
  const item = state.cases.find((m) => String(m.id) === String(caseId));
  if (!item) throw Error("Case not found");
  const client = state.clients.find((c) => String(c.id) === String(item.clientId));
  if (!client) throw Error("Client not found");
  const periods = workspaceState.periods.filter(
    (p) =>
      p.caseId === String(caseId) && !p.excluded && p.billable && p.billingStatus === "unbilled",
  );
  const summary = summarizeWork(periods, workspaceState.sources);
  const rate = configuredRate(state, caseId);
  const flatFeeDue =
    item.mode === "flat_fee" &&
    type === "final" &&
    !workspaceState.billing.invoices.some((i) => i.caseId === String(caseId) && i.type === "final");
  const expenses = workspaceState.billing.expenses.filter(
    (e) => e.caseId === String(caseId) && !e.invoiceId,
  );
  const expensesCents = expenses
    .filter((e) => e.type === "expense")
    .reduce((total, e) => total + e.amountCents, 0);
  const disbursementsCents = expenses
    .filter((e) => e.type === "disbursement")
    .reduce((total, e) => total + e.amountCents, 0);
  const amounts = invoiceAmounts({
    durationMs: summary.preciseDurationMs,
    rateCents: rate.rateCents,
    flatFeeCents: rate.origin === "flat_fee" ? (flatFeeDue ? (item.flatFeeCents ?? 0) : 0) : null,
    expensesCents,
    disbursementsCents,
    vatRate: state.settings.vatRate ?? 0,
    vatApplicable: client.vatApplicable,
  });
  const { feesCents } = amounts;
  const lines: InvoiceDraft["lines"] = [];
  if (flatFeeDue)
    lines.push({
      origin: "flat_fee",
      originId: String(caseId),
      label: `Agreed flat fee · ${item.title}`,
      billedMinutes: 0,
      rateCents: 0,
      amountCents: feesCents,
      vat: true,
    });
  if (periods.length)
    lines.push({
      origin: "work_period",
      originId: String(caseId),
      label: `Work on ${item.title}`,
      billedMinutes: summary.roundedMinutes,
      rateCents: rate.rateCents,
      amountCents: rate.origin === "flat_fee" ? 0 : feesCents,
      vat: true,
    });
  for (const expense of expenses)
    lines.push({
      origin: "expense",
      originId: String(expense.id),
      label: expense.label,
      billedMinutes: 0,
      rateCents: 0,
      amountCents: expense.amountCents,
      vat: expense.type !== "disbursement",
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
