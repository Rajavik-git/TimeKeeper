import type { SortState } from "../../lib/dayView";
export function DaySortHeader<Key extends string>({
  label,
  sort,
  sortKey,
  numeric,
  onSort,
  className = "",
}: {
  label: string;
  sort: SortState<Key>;
  sortKey: Key;
  numeric?: boolean;
  onSort: (key: Key, numeric: boolean) => void;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`sortable ${className}`}
      aria-sort={sort?.key === sortKey ? sort.direction : undefined}
    >
      <button className="day-sort" onClick={() => onSort(sortKey, !!numeric)}>
        {label}
      </button>
    </th>
  );
}
