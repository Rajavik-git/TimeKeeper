import { format, parseISO } from "date-fns";
import "./MetricComparison.css";

type Props = {
  current: number;
  previous: number;
  previousDay: string;
  increaseGood?: boolean;
};

export function MetricComparison({ current, previous, previousDay, increaseGood = true }: Props) {
  const comparisonDate = format(parseISO(previousDay), "MMM d");
  if (previous === 0) {
    return (
      <span
        className="metric-comparison-empty"
        title={`No percentage available: the value on ${comparisonDate} was zero.`}
      >
        No previous-period data
      </span>
    );
  }
  const change = Math.round(((current - previous) * 100) / previous);
  const direction = change === 0 ? "flat" : change > 0 === increaseGood ? "up" : "down";
  return (
    <span className={`case-kpi-delta ${direction}`} title={`vs ${comparisonDate}`}>
      {change > 0 ? "+" : change < 0 ? "−" : ""}
      {Math.abs(change)}%
    </span>
  );
}
