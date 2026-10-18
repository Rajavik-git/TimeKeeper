import type { Ref } from "react";
import { calendarTime } from "../../../../../shared/dates";
import { effectiveMs, formatPreciseDuration, type Period } from "../../../../calculations/billing";
import type { SortState, LeftSortKey } from "../../lib/dayView";
import { DaySortHeader } from "../DaySortHeader/DaySortHeader";
type Props = {
  periods: Period[];
  sort: SortState<LeftSortKey>;
  onSort: (key: LeftSortKey, numeric: boolean) => void;
  onRestore: (period: Period) => Promise<unknown>;
  onShowAll: () => void;
  tableRef: Ref<HTMLDivElement>;
  hasMoreRows: boolean;
};
export function LeftOutPeriods({
  periods,
  sort,
  onSort,
  onRestore,
  onShowAll,
  tableRef,
  hasMoreRows,
}: Props) {
  return (
    <div className="tbl" ref={tableRef} data-has-more={hasMoreRows}>
      <table className="data-table">
        <thead>
          <tr>
            <DaySortHeader label="Time" sort={sort} sortKey="time" numeric onSort={onSort} />
            <DaySortHeader label="Application" sort={sort} sortKey="application" onSort={onSort} />
            <DaySortHeader label="Work observed" sort={sort} sortKey="work" onSort={onSort} />
            <DaySortHeader
              label="Duration"
              sort={sort}
              sortKey="duration"
              numeric
              className="r"
              onSort={onSort}
            />
            <th scope="col" className="r">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.id}>
              <td className="num">
                {calendarTime(period.startedAt)}–
                {(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}
              </td>
              <td>{period.demoApp ?? "—"}</td>
              <td>{period.demoWindowTitle ?? period.label}</td>
              <td className="r num">{formatPreciseDuration(effectiveMs(period))}</td>
              <td>
                <button className="btn sm" onClick={() => void onRestore(period)}>
                  Include in totals
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!periods.length && (
        <div className="empty">
          <b>No matching periods excluded from totals</b>
          <button className="btn sm" onClick={onShowAll}>
            Show all periods
          </button>
        </div>
      )}
    </div>
  );
}
