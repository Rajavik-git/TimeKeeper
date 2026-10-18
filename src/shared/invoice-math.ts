/** Exact milliseconds are summed before the single whole-minute ceiling. */
export function invoiceAmounts(input: {
  durationMs: number;
  rateCents: number;
  flatFeeCents: number | null;
  expensesCents: number;
  disbursementsCents: number;
  vatRate: number;
  vatApplicable: boolean;
}) {
  const billedMinutes = Math.ceil(input.durationMs / 60000);
  const feesCents = input.flatFeeCents ?? Math.round((billedMinutes * input.rateCents) / 60);
  const subtotalCents = feesCents + input.expensesCents;
  const vatCents = input.vatApplicable ? Math.round((subtotalCents * input.vatRate) / 100) : 0;
  return {
    billedMinutes,
    feesCents,
    subtotalCents,
    expensesCents: input.expensesCents,
    disbursementsCents: input.disbursementsCents,
    vatCents,
    totalCents: subtotalCents + input.disbursementsCents + vatCents,
  };
}
