import { calendarDay, shiftCalendarMonth } from "../../shared/dates";
import type { CoreState, EntityId, State } from "../api/client";
import { summarizeWork } from "./billing";

export type MetricComparisonData =
  | { status: "unavailable"; message: string; reason: string }
  | { status: "available"; current: number; previous: number; ranges: string };

export const historicalComparison: MetricComparisonData = {
  status: "unavailable",
  message: "Historical comparison unavailable",
  reason:
    "Historical comparison unavailable: past billing balances and case counts are not stored.",
};

/** Compare current corrected records, grouped whole by their local start day. */
export function monthlyRecordedTime(
  state: State,
  workspace: CoreState,
  today: string,
  requestedClientId: EntityId | null = null,
) {
  const client =
    requestedClientId === null
      ? undefined
      : state.clients.find((item) => String(item.id) === String(requestedClientId));
  const clientId = client?.id ?? null;
  const scopeLabel = client?.name ?? "All clients";
  const previousDay = shiftCalendarMonth(today, -1);
  const currentStart = `${today.slice(0, 7)}-01`;
  const previousStart = `${previousDay.slice(0, 7)}-01`;
  const caseIds = new Set(
    state.cases
      .filter((item) => clientId === null || String(item.clientId) === String(clientId))
      .map((item) => String(item.id)),
  );
  const inRange = (from: string, to: string) =>
    summarizeWork(
      workspace.periods.filter((period) => {
        const day = calendarDay(period.startedAt);
        return period.caseId !== null && caseIds.has(period.caseId) && day >= from && day <= to;
      }),
      workspace.sources,
    );
  const current = inRange(currentStart, today);
  const previous = inRange(previousStart, previousDay);
  const ranges = `${currentStart}–${today} vs ${previousStart}–${previousDay}`;
  const comparison: MetricComparisonData =
    current.complete && previous.complete
      ? {
          status: "available",
          current: current.preciseDurationMs,
          previous: previous.preciseDurationMs,
          ranges,
        }
      : {
          status: "unavailable",
          message: "Time comparison unavailable",
          reason: `Time comparison unavailable: some durations or sources are missing. ${ranges}. Current corrected records are used.`,
        };
  return {
    current,
    previous,
    currentStart,
    previousStart,
    previousDay,
    ranges,
    comparison,
    clientId,
    scopeLabel,
    currentEnd: today,
  };
}
