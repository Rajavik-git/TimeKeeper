import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../../shared/components/Icon/Icon";
import type { Case, Client } from "../../../../api/client";
type Props = {
  clients: Pick<Client, "id" | "name">[];
  cases: Pick<Case, "id" | "clientId" | "title">[];
  clientFilter: string;
  caseFilter: string;
  setClientFilter: (id: string) => void;
  setCaseFilter: (id: string) => void;
};
export function DayFilters({
  clients,
  cases,
  clientFilter,
  caseFilter,
  setClientFilter,
  setCaseFilter,
}: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const close = (event: PointerEvent) => {
      if (!filterWrap.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilterOpen(false);
        filterWrap.current?.querySelector<HTMLButtonElement>(".day-filter-toggle")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [filterOpen]);
  return (
    <div className="day-filter-wrap" ref={filterWrap}>
      <button
        className="btn ghost sm day-filter-toggle"
        aria-expanded={filterOpen}
        aria-controls="day-filter-popover"
        onClick={() => setFilterOpen((value) => !value)}
      >
        <Icon name="filter" small />
        Filter
        {(clientFilter || caseFilter) && (
          <>
            <span className="day-filter-dot" aria-hidden="true" />
            <span className="sr-only">Filters active</span>
          </>
        )}
      </button>
      {filterOpen && (
        <div
          id="day-filter-popover"
          className="day-filter-popover"
          role="group"
          aria-label="Filter work periods"
        >
          <label>
            Client
            <select
              className="select sm"
              value={clientFilter}
              onChange={(event) => {
                setClientFilter(event.target.value);
                setCaseFilter("");
              }}
            >
              <option value="">All clients</option>
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Case
            <select
              className="select sm"
              value={caseFilter}
              onChange={(event) => setCaseFilter(event.target.value)}
            >
              <option value="">All cases</option>
              {cases
                .filter((item) => !clientFilter || String(item.clientId) === clientFilter)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="btn sm"
            disabled={!clientFilter && !caseFilter}
            onClick={() => {
              setClientFilter("");
              setCaseFilter("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
