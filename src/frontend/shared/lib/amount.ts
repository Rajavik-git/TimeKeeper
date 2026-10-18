/** Blank optional amounts remove an override; zero remains an explicit amount. */
export function parseAmount(
  value: string,
  nullable: boolean,
): { valid: true; cents: number | null } | { valid: false } {
  const normalized = value.trim().replace(",", ".");
  if (!normalized && nullable) return { valid: true, cents: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return { valid: false };
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? { valid: true, cents } : { valid: false };
}
