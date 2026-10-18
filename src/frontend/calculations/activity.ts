import { calendarDay, dayBounds, systemTimeZone } from "../../shared/dates";
import type { CoreState, State } from "../api/client";

/** Work periods own activity identity, assignment, and validation. */
export function activityPeriods(
  state: State,
  workspaceState: CoreState,
  clientId = "",
  caseId = "",
) {
  return workspaceState.periods
    .filter((period) => {
      if (caseId && period.caseId !== caseId) return false;
      const item = state.cases.find((item) => String(item.id) === period.caseId);
      return !clientId || String(item?.clientId) === clientId;
    })
    .map((period) => {
      return {
        id: period.id,
        date: calendarDay(period.startedAt),
        label: period.label,
        caseId: period.caseId,
        billable: period.billable,
        timeValidated: period.timeValidated,
        period,
      };
    });
}

export function selectActivityPeriod<T extends { id: string }>(
  entries: readonly T[],
  requestedId: string,
  pickedId?: string,
) {
  const picked = entries.find((entry) => entry.id === pickedId);
  if (picked) return picked;
  if (requestedId) return entries.find((entry) => entry.id === requestedId);
  return entries[0];
}

/** One bar per period. Coordinates use real elapsed time, including DST and overnight bounds. */
export function activityTimeline(periods: CoreState["periods"], timeZone = systemTimeZone()) {
  const positions = new Map(
    periods.map((period) => {
      const day = calendarDay(period.startedAt, timeZone);
      const midnight = Date.parse(dayBounds(day, timeZone).startAt);
      const startMs = Date.parse(period.startedAt) - midnight;
      // An open boundary has no known span; it is rendered as a point until it closes.
      const endMs = period.endedAt === null ? startMs : Date.parse(period.endedAt) - midnight;
      return [period.id, { day, midnight, startMs, endMs }];
    }),
  );
  const endHour = Math.max(
    24,
    Math.ceil(Math.max(0, ...[...positions.values()].map((value) => value.endMs)) / 3600000),
  );
  const spanMs = endHour * 3600000;
  const tickStep = Math.max(1, Math.ceil(endHour / 6));
  const ticks = Array.from(
    { length: Math.floor(endHour / tickStep) + 1 },
    (_, index) => index * tickStep,
  );
  return { positions, spanMs, ticks };
}
