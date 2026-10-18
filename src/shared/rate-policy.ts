/** Stable rate origins shared by domain rules and interface calculations. */
export const RateOrigin = {
  Base: "base",
  Client: "client",
  Case: "matter",
  FlatFee: "flat_fee",
} as const;
export type RateOrigin = (typeof RateOrigin)[keyof typeof RateOrigin];

export interface HourlyRateInput {
  globalRateCents: number | null;
  clientRateCents?: number | null;
  caseRateCents?: number | null;
  flatFee?: boolean;
}

/** A configured zero rate is an explicit choice, not a missing value. */
export function resolveHourlyRate(input: HourlyRateInput): {
  rateCents: number | null;
  origin: RateOrigin;
  flatFee: boolean;
} {
  if (input.flatFee) return { rateCents: 0, origin: RateOrigin.FlatFee, flatFee: true };
  if (input.caseRateCents != null)
    return { rateCents: input.caseRateCents, origin: RateOrigin.Case, flatFee: false };
  if (input.clientRateCents != null)
    return { rateCents: input.clientRateCents, origin: RateOrigin.Client, flatFee: false };
  return { rateCents: input.globalRateCents, origin: RateOrigin.Base, flatFee: false };
}
