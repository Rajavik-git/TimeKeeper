import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { ScreenProps, State } from "../../api/client";
import { Icon } from "../../shared/components/Icon";
import { rate } from "../../shared/format";
import { parseAmount } from "./amount";

export type SectionProps = Pick<
  ScreenProps,
  "catalogState" | "workspaceState" | "action" | "navigate"
> & {
  saved: (operation: Promise<unknown>) => Promise<boolean>;
  notify: (message: string) => void;
};

export const currencyAmount = (state: State, cents: number) =>
  rate(cents, state.settings.currency ?? "USD").replace("/h", "");

export function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

export function cardHead(title: string, subtitle: string, button?: ReactNode) {
  return (
    <div className="card-h">
      <div className="t">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {button}
    </div>
  );
}

export function AddButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button className="btn sm" onClick={onToggle}>
      {open ? (
        "Cancel"
      ) : (
        <>
          <Icon name="plus" small />
          {label}
        </>
      )}
    </button>
  );
}

export function useAmountFields() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setFieldError = (key: string, message: string) =>
    setErrors((old) => ({ ...old, [key]: message }));
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="settings-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
  const commitAmount = (
    key: string,
    value: string,
    current: number | null,
    patch: (next: number | null) => Promise<boolean>,
    nullable = true,
  ) => {
    const parsed = parseAmount(value, nullable);
    if (!parsed.valid) {
      setFieldError(key, "Enter a non-negative amount (up to two decimal places).");
      return;
    }
    setFieldError(key, "");
    if (parsed.cents !== current) void patch(parsed.cents);
  };
  return { setFieldError, fieldError, commitAmount };
}

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
