import type { CoreState, State } from "../../../../api/client";
import { calendarDay, calendarTime, systemTimeZone } from "../../../../../shared/dates";
import { shortDate } from "../../../../api/client";
import { effectiveMs, formatNearestMinuteDuration } from "../../../../calculations/billing";

type Entry = { id: string; period: CoreState["periods"][number] };
export function ActivityPeriodList({
  entries,
  state,
  selectedId,
  onSelect,
}: {
  entries: readonly Entry[];
  state: State;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="card activity-period-list" aria-label="Work periods">
      <div className="card-h">
        <div className="t">
          <h2>Work periods</h2>
          <p>Select a period to inspect its sources and recorded changes.</p>
        </div>
      </div>
      <ul>
        {entries.map(({ id, period }) => {
          const item = state.cases.find((candidate) => String(candidate.id) === period.caseId);
          const client = state.clients.find(
            (candidate) => String(candidate.id) === String(item?.clientId),
          );
          const durationMs = effectiveMs(period);
          const duration =
            durationMs !== null && durationMs > 0 && durationMs < 60000
              ? "Less than 1m"
              : formatNearestMinuteDuration(durationMs);
          const day = calendarDay(period.startedAt);
          const start = calendarTime(period.startedAt, systemTimeZone(), true);
          const end = period.endedAt
            ? `${calendarTime(period.endedAt, systemTimeZone(), true)}${calendarDay(period.endedAt) !== day ? ` (${shortDate(calendarDay(period.endedAt))})` : ""}`
            : "open";
          const identity = `${client?.name ?? "No client assigned"} · ${item ? `${item.reference} · ${item.title}` : "Unassigned case"}`;
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={selectedId === id}
                onClick={() => onSelect(id)}
                aria-label={`${identity} · ${period.label || "Work period"} · ${shortDate(day)} · ${start} to ${end} · ${duration}`}
              >
                <span>
                  <strong>{identity}</strong>
                  <span>{period.label || "Work period"}</span>
                </span>
                <span>
                  {shortDate(day)} · {start}–{end}
                  <strong>
                    {duration} ·{" "}
                    {period.excluded
                      ? "Excluded"
                      : period.timeValidated
                        ? "Time validated"
                        : "Awaiting time validation"}
                  </strong>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
