import { calendarDay, systemTimeZone } from "../../../../shared/dates";
import { api, type CoreState, type State } from "../../../api/client";
import { useResource, requireData } from "../../../api/queries";
import { monthEnd } from "../components/DayCalendar/DayCalendar";

export type DayData = Omit<CoreState, "auditEvents"> & {
  date: string;
  state: State;
};

/** Day and month requests retain separate identities and failure feedback. */
export function useDayResources(selectedDate: string, month: string, enabled = true) {
  const dayQuery = useResource(
    `day:${selectedDate}`,
    async (signal): Promise<DayData> => {
      const snapshot = requireData(
        await api.GET("/api/workspace", {
          signal,
          params: { query: { date: selectedDate, timeZone: systemTimeZone() } },
        }),
      );
      return { date: selectedDate, state: snapshot.catalogState, ...snapshot.workspaceState };
    },
    5000,
    enabled,
  );
  const monthQuery = useResource(
    `month:${month}`,
    async (signal) =>
      requireData(
        await api.GET("/api/workspace", {
          signal,
          params: {
            query: { from: `${month}-01`, to: monthEnd(month), timeZone: systemTimeZone() },
          },
        }),
      ).workspaceState.periods,
    5000,
    enabled,
  );
  const recorded = new Set(
    (monthQuery.data ?? [])
      .filter((period) => !period.excluded)
      .map((period) => calendarDay(period.startedAt)),
  );
  const pending = new Set(
    (monthQuery.data ?? [])
      .filter((period) => !period.excluded && (!period.timeValidated || !period.caseId))
      .map((period) => calendarDay(period.startedAt)),
  );
  const data: DayData | null = dayQuery.data ?? null;
  return { dayQuery, monthQuery, data, recorded, pending };
}
