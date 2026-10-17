/** Preserve opaque identifiers while retaining the imported demo's numeric IDs. */
export function displayId(value: string): string | number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === value
    ? numeric
    : value;
}
