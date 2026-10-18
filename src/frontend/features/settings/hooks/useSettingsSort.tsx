import { useState } from "react";
import type { SectionProps } from "../types";

type SortState = { column: number; direction: 1 | -1 };
const rememberedSorts: Partial<Record<string, SortState>> = {};

export function useSettingsSort(
  table: "clients" | "tasks" | "rules",
  notify: SectionProps["notify"],
) {
  const [sort, setSort] = useState(rememberedSorts[table]);
  const head = (column: number, label: string, numeric = false) => (
    <th
      scope="col"
      aria-sort={
        sort?.column === column ? (sort.direction === 1 ? "ascending" : "descending") : undefined
      }
    >
      <button
        onClick={() => {
          const next: SortState = {
            column,
            direction: sort?.column === column ? (sort.direction === 1 ? -1 : 1) : numeric ? -1 : 1,
          };
          rememberedSorts[table] = next;
          setSort(next);
          notify(`Sorted by ${label}`);
        }}
      >
        {label}
        {sort?.column === column ? (sort.direction === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  function sorted<T>(rows: T[], values: (row: T) => (string | number)[]): T[] {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const left = values(a)[sort.column];
      const right = values(b)[sort.column];
      const comparison =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "en-US");
      return sort.direction * comparison;
    });
  }
  return { head, sorted };
}
