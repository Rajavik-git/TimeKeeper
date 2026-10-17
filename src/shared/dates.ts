import { addDays, addMonths, endOfMonth, format, isValid, parseISO, startOfMonth } from "date-fns";
import { TZDate, tz } from "@date-fns/tz";

export type Instant = string | Date | number;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validZones = new Set<string>();
const utc = tz("UTC");

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isTimeZone(value: string): boolean {
  if (!value) return false;
  if (validZones.has(value)) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    validZones.add(value);
    return true;
  } catch {
    return false;
  }
}

function requireTimeZone(value: string): string {
  if (!isTimeZone(value)) throw new RangeError("Invalid time zone");
  return value;
}

export function isCalendarDay(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = parseISO(`${value}T00:00:00Z`, { in: utc });
  return isValid(date) && format(date, "yyyy-MM-dd", { in: utc }) === value;
}

function calendarDate(value: string): TZDate {
  if (!isCalendarDay(value)) throw new RangeError("Invalid calendar date");
  return parseISO(`${value}T00:00:00Z`, { in: utc });
}

function instantDate(value: Instant): Date {
  const date = typeof value === "string" ? parseISO(value) : new Date(value);
  if (!isValid(date)) throw new RangeError("Invalid timestamp");
  return date;
}

/** Date-only values retain their calendar meaning. Instants use the selected zone. */
export function calendarDay(value: Instant, timeZone = systemTimeZone()): string {
  requireTimeZone(timeZone);
  if (typeof value === "string" && datePattern.test(value)) {
    calendarDate(value);
    return value;
  }
  return format(instantDate(value), "yyyy-MM-dd", { in: tz(timeZone) });
}

export function calendarTime(
  value: Instant,
  timeZone = systemTimeZone(),
  includeSeconds = false,
): string {
  return format(instantDate(value), includeSeconds ? "HH:mm:ss" : "HH:mm", {
    in: tz(requireTimeZone(timeZone)),
  });
}

export function shiftCalendarDay(day: string, amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Invalid day offset");
  return format(addDays(calendarDate(day), amount, { in: utc }), "yyyy-MM-dd", { in: utc });
}

export function shiftCalendarMonth(day: string, amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Invalid month offset");
  return format(addMonths(calendarDate(day), amount, { in: utc }), "yyyy-MM-dd", { in: utc });
}

export function monthBounds(day: string): { from: string; to: string } {
  const date = calendarDate(day);
  return {
    from: format(startOfMonth(date, { in: utc }), "yyyy-MM-dd", { in: utc }),
    to: format(endOfMonth(date, { in: utc }), "yyyy-MM-dd", { in: utc }),
  };
}

/** Half-open local day boundaries. Their elapsed span can be 23, 24, or 25 hours. */
export function dayBounds(
  day: string,
  timeZone = systemTimeZone(),
): { startAt: string; endAt: string } {
  calendarDate(day);
  requireTimeZone(timeZone);
  const [year, month, date] = day.split("-").map(Number);
  const start = new TZDate(year!, month! - 1, date!, 0, 0, 0, 0, timeZone);
  const end = addDays(start, 1, { in: tz(timeZone) });
  return {
    startAt: new Date(start.getTime()).toISOString(),
    endAt: new Date(end.getTime()).toISOString(),
  };
}
