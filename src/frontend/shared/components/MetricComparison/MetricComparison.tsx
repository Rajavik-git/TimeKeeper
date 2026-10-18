import type { MetricComparisonData } from "../../../calculations/comparison";

export function MetricComparison({ comparison }: { comparison: MetricComparisonData }) {
  if (comparison.status === "unavailable") {
    return (
      <span className="metric-comparison-empty" title={comparison.reason}>
        {comparison.message}
      </span>
    );
  }
  if (comparison.previous === 0) {
    return (
      <span
        className="metric-comparison-empty"
        title={`${comparison.ranges}. The previous value is zero.`}
      >
        No percentage comparison
      </span>
    );
  }
  const change = Math.round(
    ((comparison.current - comparison.previous) * 100) / comparison.previous,
  );
  return (
    <span
      className="metric-comparison flat"
      title={`${comparison.ranges}. Current corrected records are used.`}
    >
      {change > 0 ? "+" : change < 0 ? "−" : ""}
      {Math.abs(change)}%
    </span>
  );
}
