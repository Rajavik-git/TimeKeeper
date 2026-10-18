import { shortDate, type CoreState, type State } from "../../../../api/client";
import { formatRoundedMinutes } from "../../../../calculations/billing";
import type { monthlyRecordedTime } from "../../../../calculations/comparison";
import { coverageProblems } from "../../../../calculations/coverage";
import { calendarDay, calendarTime } from "../../../../../shared/dates";

type Props = {
  clients: State["clients"];
  comparison: ReturnType<typeof monthlyRecordedTime>;
  workspace: CoreState;
  onChange: (clientId: string | null) => void;
};

export function RecordedTimeComparison({ clients, comparison, workspace, onChange }: Props) {
  const total = (summary: typeof comparison.current) => {
    if (summary.complete) return <strong>{formatRoundedMinutes(summary.roundedMinutes)}</strong>;
    const count = summary.incompletePeriodIds.length;
    // Name each period that keeps the total incomplete and why, so the lawyer knows what to check.
    const details = summary.incompletePeriodIds
      .map((id) => workspace.periods.find((period) => period.id === id))
      .filter((period) => period !== undefined)
      .map(
        (period) =>
          `${shortDate(calendarDay(period.startedAt))} ${calendarTime(period.startedAt)} · ${coverageProblems(period, workspace.sources).join(" ")}`,
      )
      .join("\n");
    return (
      <>
        <strong>{formatRoundedMinutes(summary.roundedMinutes)}</strong>{" "}
        <span className="comparison-to-check" title={details}>
          · {count} {count === 1 ? "period" : "periods"} to check
        </span>
      </>
    );
  };
  return (
    <div className="recorded-time-comparison">
      <label htmlFor="comparison-client">
        Compare recorded time for
        <select
          id="comparison-client"
          className="field"
          value={comparison.clientId ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
      <p aria-live="polite">
        <span>
          {comparison.currentStart}–{comparison.currentEnd}: {total(comparison.current)}
        </span>
        <span>
          {comparison.previousStart}–{comparison.previousDay}: {total(comparison.previous)}
        </span>
      </p>
    </div>
  );
}
