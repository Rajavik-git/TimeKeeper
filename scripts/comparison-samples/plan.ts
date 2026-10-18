import { addMilliseconds } from "date-fns";
import { TZDate } from "@date-fns/tz";
import {
  calendarDay,
  dayBounds,
  shiftCalendarMonth,
  systemTimeZone,
} from "../../src/shared/dates.js";

export const sampleNamespace = "timekeeper-comparison-sample-v1";
export const sampleClients = [
  { key: "atlas", name: "[Sample] Atlas Industries", rate: 24000, budget: 240000 },
  { key: "river", name: "[Sample] River Consulting", rate: 18000, budget: 360000 },
] as const;

/** Explicit fictional durations. No duration is inferred from a screenshot. */
export function comparisonSamplePlan(now = new Date(), timeZone = systemTimeZone()) {
  const today = calendarDay(now, timeZone);
  const previousDay = shiftCalendarMonth(today, -1);
  const start = new Date(dayBounds(today, timeZone).startAt);
  const elapsed = now.getTime() - start.getTime();
  // Near midnight on the first day, use precise shorter periods without future time.
  const unitMs = Math.min(3600000, Math.floor(elapsed / 6) * 2);
  if (unitMs < 2) throw new Error("Wait until the current calendar day has started");
  const [year, month, day] = today.split("-").map(Number);
  const nine = new TZDate(year!, month! - 1, day!, 9, 0, 0, 0, timeZone);
  const currentStart = new Date(Math.max(start.getTime(), Math.min(+nine, +now - 3 * unitMs)));
  const priorStart = new Date(dayBounds(previousDay, timeZone).startAt);
  const batch = `${sampleNamespace}:${today.slice(0, 7)}`;
  return {
    generatedAt: now.toISOString(),
    today,
    previousDay,
    timeZone,
    batch,
    periods: sampleClients.flatMap((client, index) => {
      const duration = (index === 0 ? 2 : 1) * unitMs;
      return [
        { role: "current", day: today, start: currentStart, durationMs: duration },
        { role: "previous", day: previousDay, start: priorStart, durationMs: duration / 2 },
      ].map((period) => {
        const offset = index === 0 ? 0 : period.role === "current" ? 2 * unitMs : unitMs;
        const startedAt = addMilliseconds(period.start, offset).toISOString();
        const durationMs = Math.floor(period.durationMs);
        const id = `${batch}:${client.key}:${period.role}`;
        return {
          id,
          sessionId: `${id}:session`,
          clientKey: client.key,
          day: period.day,
          startedAt,
          endedAt: addMilliseconds(new Date(startedAt), durationMs).toISOString(),
          durationMs,
          billed: index === 0 && period.role === "previous",
        };
      });
    }),
  };
}
export type ComparisonSamplePlan = ReturnType<typeof comparisonSamplePlan>;
