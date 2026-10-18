import { resolveHourlyRate } from "../../shared/rate-policy";
import { BillingStatus, CaseBillingMode } from "../../contracts/states.generated";
import type { CoreState, State } from "../api/client";

type Period = CoreState["periods"][number];
export type FeeEstimate = {
  cents: number | null;
  knownCents: number;
  currency: string | null;
  complete: boolean;
};

/** An hourly work estimate. Agreed flat fees are not allocated to individual days. */
export function dayFees(state: State, periods: readonly Period[]): FeeEstimate {
  const currency = state.settings.currency || null;
  let complete = currency !== null;
  const groups = new Map<string, { durationMs: number; rateCents: number }>();
  for (const period of periods) {
    if (period.excluded || !period.billable) continue;
    const item = state.cases.find((candidate) => String(candidate.id) === period.caseId);
    const client = state.clients.find(
      (candidate) => String(candidate.id) === String(item?.clientId),
    );
    let rateCents: number | null | undefined;
    if (period.billingStatus === BillingStatus.Billed) {
      // Historical pricing takes precedence over today's case billing mode.
      if (!currency || period.appliedCurrency !== currency) {
        complete = false;
        continue;
      }
      rateCents = period.appliedHourlyRateCents;
    } else {
      if (item?.mode === CaseBillingMode.FlatFee) continue;
      if (!item || !client) {
        complete = false;
        continue;
      }
      rateCents = resolveHourlyRate({
        caseRateCents: item.hourlyRateCents,
        clientRateCents: client.hourlyRateCents,
        globalRateCents: state.settings.globalHourlyRateCents,
      }).rateCents;
    }
    const durationMs = period.durationOverrideMs ?? period.detectedDurationMs;
    if (rateCents == null || durationMs === null) {
      complete = false;
      continue;
    }
    const key = `${period.caseId ?? ""}:${rateCents}`;
    const group = groups.get(key) ?? { durationMs: 0, rateCents };
    group.durationMs += durationMs;
    groups.set(key, group);
  }
  let knownCents = 0;
  for (const group of groups.values()) {
    knownCents += Math.round((Math.ceil(group.durationMs / 60000) * group.rateCents) / 60);
  }
  return { cents: complete ? knownCents : null, knownCents, currency, complete };
}
