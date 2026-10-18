import { isCalendarDay } from "../../shared/dates.js";
import { AppError } from "./errors.js";
export function assertTime(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !isCalendarDay(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new AppError("invalid-request", "UTC timestamp required");
}
export function assertId(value: string): void {
  if (!value || value.length > 200) throw new AppError("invalid-request", "invalid identifier");
}
