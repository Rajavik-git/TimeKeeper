export type RateOrigin = "base" | "client" | "matter" | "flat_fee";

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
  if (input.flat_fee) return { rate_cents: 0, origin: "flat_fee", flat_fee: true };
  if (input.matter_cents != null)
    return { rate_cents: input.matter_cents, origin: "matter", flat_fee: false };
  if (input.client_cents != null)
    return { rate_cents: input.client_cents, origin: "client", flat_fee: false };
  return { rate_cents: input.base_cents, origin: "base", flat_fee: false };
}

export function calculateLine(input: {
  tenths: number;
  reference_cents: number;
  rate: RateChoice;
  billable: boolean;
  travel_excluded: boolean;
  billed_amount?: number;
}) {
  const value_cents = Math.round(input.tenths * input.reference_cents / 10);
  const amount_cents = input.billed_amount ?? (
    input.billable && !input.rate.flat_fee && !input.travel_excluded
      ? Math.round(input.tenths * input.rate.rate_cents / 10)
      : 0
  );
  return { ...input.rate, value_cents, amount_cents };
}
