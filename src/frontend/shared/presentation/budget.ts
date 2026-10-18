const percentage = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Keep values just below the warning threshold visibly below it. */
export function budgetPercent(value: number): string {
  return `${percentage.format(Math.floor(value * 10) / 10)}%`;
}
