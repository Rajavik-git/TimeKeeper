import { resolveHourlyRate } from "../../shared/rate-policy.js";
export { resolveHourlyRate } from "../../shared/rate-policy.js";
import { RateOrigin } from "./states/billing.js";
export type { RateOrigin } from "./states/billing.js";

export interface RateChoice {
  rate_cents: number;
  origin: RateOrigin;
  flat_fee: boolean;
}

export function chooseRate(input: {
  base_cents: number;
  client_cents?: number;
  matter_cents?: number | null;
  flat_fee?: boolean;
}): RateChoice {
  const choice = resolveHourlyRate({
    globalRateCents: input.base_cents,
    clientRateCents: input.client_cents,
    caseRateCents: input.matter_cents,
    flatFee: input.flat_fee,
  });
  // The legacy input requires a base rate, so this result cannot be null.
  return { rate_cents: choice.rateCents!, origin: choice.origin, flat_fee: choice.flatFee };
}

export function calculateLine(input: {
  tenths: number;
  reference_cents: number;
  rate: RateChoice;
  billable: boolean;
  travel_excluded: boolean;
  billed_amount?: number;
}) {
  const value_cents = Math.round((input.tenths * input.reference_cents) / 10);
  const amount_cents =
    input.billed_amount ??
    (input.billable && !input.rate.flat_fee && !input.travel_excluded
      ? Math.round((input.tenths * input.rate.rate_cents) / 10)
      : 0);
  return { ...input.rate, value_cents, amount_cents };
}
