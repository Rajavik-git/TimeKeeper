import { calendarDay, calendarTime, isCalendarDay } from "../../shared/dates";
const currencies = new Map<string, Intl.NumberFormat>();
function currencyFormatter(code: string) {
  let formatter = currencies.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencies.set(code, formatter);
  }
  return formatter;
}
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const parseDate = (value: string) => {
  if (!isCalendarDay(value)) throw Error("Invalid calendar day");
  return new Date(`${value}T00:00:00Z`);
};

export const money = (cents: number, currency = "USD") =>
  currencyFormatter(currency).format(cents / 100);
export const recordedMoney = (cents: number, currency: string | null | undefined) =>
  currency ? money(cents, currency) : `${(cents / 100).toFixed(2)} · currency unavailable`;
export const rate = (cents: number, currency = "USD") => `${money(cents, currency)}/h`;
export const percent = (value: number) => `${whole.format(Math.round(value))}%`;
export const shortDate = (value: string) => short.format(parseDate(value));
export const longDate = (value: string) => long.format(parseDate(value)).replace(",", "");
export const auditDate = (value: string) =>
  `${shortDate(calendarDay(value))}, ${calendarTime(value)}`;
export function minutes(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid duration");
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}
export const duration = (ms: number | null) =>
  ms === null ? "Unknown" : minutes(Math.round(ms / 60000));
export const tenthsOfHour = (value: number) => minutes(Math.round(value * 6));
