import type { State } from "../../../../api/client";
import { formatRoundedMinutes } from "../../../../calculations/billing";
import type { monthlyRecordedTime } from "../../../../calculations/comparison";

type Props = {
  clients: State["clients"];
  comparison: ReturnType<typeof monthlyRecordedTime>;
  onChange: (clientId: string | null) => void;
};

export function RecordedTimeComparison({ clients, comparison, onChange }: Props) {
  const total = (summary: typeof comparison.current) =>
    `${formatRoundedMinutes(summary.roundedMinutes)}${summary.complete ? "" : " (partial)"}`;
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
          {comparison.currentStart}–{comparison.currentEnd}:{" "}
          <strong>{total(comparison.current)}</strong>
        </span>
        <span>
          {comparison.previousStart}–{comparison.previousDay}:{" "}
          <strong>{total(comparison.previous)}</strong>
        </span>
      </p>
    </div>
  );
}
