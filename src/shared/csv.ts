/** Quote CSV syntax and keep user text from becoming a spreadsheet formula. */
export function csvCell(value: string | number): string {
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
