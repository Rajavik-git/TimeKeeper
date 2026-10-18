import type { CoreState, EntityId } from "../../../api/client";
import { ValidationStatus } from "../../../../contracts/states.generated";
import { timeValidationLabels } from "../../../shared/presentation/work-period";
import { effectiveMs, needsTimeValidation } from "../../../calculations/billing";

type Period = CoreState["periods"][number];
type Gap = CoreState["coverageGaps"][number];
export type DayFilter = "all" | "review" | "validated" | "left";
export type SortDirection = "ascending" | "descending";
export type SortState<Key extends string> = { key: Key; direction: SortDirection } | null;
export type MainSortKey = "period" | "case" | "work" | "duration" | "status";
export type LeftSortKey = "time" | "application" | "work" | "duration";
export type DayRow = { kind: "period"; period: Period } | { kind: "gap"; gap: Gap };

type CaseDetails = {
  title: string;
  clientName: string;
  clientId: EntityId | null;
};
type DayViewOptions = {
  periods: readonly Period[];
  coverageGaps: readonly Gap[];
  filter: DayFilter;
  clientFilter: string;
  caseFilter: string;
  mainSort: SortState<MainSortKey>;
  leftSort: SortState<LeftSortKey>;
  caseDetails: (caseId: string | null) => CaseDetails;
};

const compareText = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

function compareDuration(a: Period, b: Period, direction: SortDirection) {
  const first = effectiveMs(a);
  const second = effectiveMs(b);
  // Unknown durations stay last in both directions.
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return direction === "ascending" ? first - second : second - first;
}

export function buildDayView({
  periods,
  coverageGaps,
  filter,
  clientFilter,
  caseFilter,
  mainSort,
  leftSort,
  caseDetails,
}: DayViewOptions) {
  const included = periods.filter((period) => !period.excluded);
  const excluded = periods.filter((period) => period.excluded);
  const review = included.filter((period) => needsTimeValidation(period) || !period.caseId);
  const validated = included.filter((period) => period.timeValidated && period.caseId);
  const unresolved = included.filter((period) => !period.caseId);
  const assignedToValidate = included.filter(
    (period) => period.caseId && needsTimeValidation(period),
  );
  const statusGroups = { all: included, review, validated, left: excluded };
  const shown = statusGroups[filter].filter((period) => {
    if (caseFilter && period.caseId !== caseFilter) return false;
    if (clientFilter) {
      const ownerId = caseDetails(period.caseId).clientId;
      if (ownerId == null || String(ownerId) !== clientFilter) return false;
    }
    return true;
  });

  function comparePeriods(
    a: Period,
    b: Period,
    key: MainSortKey | LeftSortKey,
    direction: SortDirection,
  ) {
    if (key === "duration") return compareDuration(a, b, direction);
    if (key === "period" || key === "time") {
      const comparison = Date.parse(a.startedAt) - Date.parse(b.startedAt);
      return (comparison || a.id.localeCompare(b.id)) * (direction === "ascending" ? 1 : -1);
    }
    const label = (period: Period) => {
      if (key === "status")
        return timeValidationLabels[
          period.timeValidated ? ValidationStatus.Validated : ValidationStatus.Unvalidated
        ];
      if (key === "case") {
        const details = caseDetails(period.caseId);
        return `${details.clientName} ${details.title}`;
      }
      if (key === "work") return period.label;
      if (key === "application") return period.observedAppName ?? "";
      return period.startedAt;
    };
    return compareText(label(a), label(b)) * (direction === "ascending" ? 1 : -1);
  }

  const sortedPeriods = [...shown].sort((a, b) =>
    comparePeriods(a, b, mainSort?.key ?? "period", mainSort?.direction ?? "ascending"),
  );
  const mainRows: DayRow[] = sortedPeriods.map((period) => ({ kind: "period", period }));
  const showGaps =
    filter === "all" && !clientFilter && !caseFilter && (!mainSort || mainSort.key === "period");
  if (showGaps) {
    mainRows.push(...coverageGaps.map((gap) => ({ kind: "gap" as const, gap })));
    mainRows.sort((a, b) => {
      const first = a.kind === "gap" ? a.gap.startedAt : a.period.startedAt;
      const second = b.kind === "gap" ? b.gap.startedAt : b.period.startedAt;
      const firstId = a.kind === "gap" ? a.gap.id : a.period.id;
      const secondId = b.kind === "gap" ? b.gap.id : b.period.id;
      const comparison = Date.parse(first) - Date.parse(second) || firstId.localeCompare(secondId);
      return comparison * (mainSort?.direction === "descending" ? -1 : 1);
    });
  }
  const leftRows = [...shown].sort((a, b) =>
    comparePeriods(a, b, leftSort?.key ?? "time", leftSort?.direction ?? "ascending"),
  );
  const exportedPeriods =
    filter === "left"
      ? leftRows
      : mainRows.flatMap((row) => (row.kind === "period" ? [row.period] : []));

  return {
    included,
    excluded,
    review,
    validated,
    unresolved,
    assignedToValidate,
    shown,
    mainRows,
    leftRows,
    exportedPeriods,
  };
}
