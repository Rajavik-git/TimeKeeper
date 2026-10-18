import { isBudgetWarning } from "../../../../calculations/case-budget";
import { budgetPercent } from "../../../../shared/presentation/budget";
import { CaseBillingMode } from "../../../../../contracts/states.generated";
import { useEffect, useRef, useState } from "react";
import {
  api,
  sameId,
  type Client,
  type EntityId,
  type Case,
  type ScreenProps,
} from "../../../../api/client";
import { clientMetrics, type caseMetrics } from "../../../../calculations/cases";
import { money as formatMoney } from "../../../../shared/format";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";

type Suggestion =
  | { kind: "client"; client: Client; caption: string }
  | { kind: "case"; item: Case; caption: string };
type Props = Pick<ScreenProps, "catalogState" | "workspaceState"> & {
  recentIds: EntityId[];
  attentionRows: Array<{ item: Case; metrics: ReturnType<typeof caseMetrics> }>;
  onSelectClient: (id: EntityId) => void;
  onSelectCase: (item: Case) => void;
};

/** Own search requests and keyboard interaction independently of case-page navigation. */
export function CaseSearch({
  catalogState,
  workspaceState,
  recentIds,
  attentionRows,
  onSelectClient,
  onSelectCase,
}: Props) {
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClients, setSearchClients] = useState<Client[]>([]);
  const [searchCases, setSearchCases] = useState<Case[]>([]);
  const [searchActive, setSearchActive] = useState(-1);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSearchStatus("idle");
      return;
    }
    const controller = new AbortController();
    let current = true;
    setSearchStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.GET("/api/cases/search", {
          params: { query: { query: term } },
          signal: controller.signal,
        });
        if (!current) return;
        if (response.error || !response.data) throw Error("Search failed");
        setSearchClients(response.data.clients);
        setSearchCases(response.data.cases);
        setSearchActive(-1);
        setSearchStatus("ready");
      } catch {
        if (current) setSearchStatus("error");
      }
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!searchOpen) return;
    const outside = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [searchOpen]);

  const recentSuggestions: Suggestion[] = (
    recentIds.length
      ? recentIds
      : [...catalogState.cases]
          .sort((a, b) => (b.openedOn ?? "").localeCompare(a.openedOn ?? ""))
          .slice(0, 3)
          .map((item) => item.id)
  )
    .map((id) => catalogState.cases.find((item) => sameId(item.id, id)))
    .filter((item): item is Case => !!item)
    .map((item) => ({
      kind: "case",
      item,
      caption: catalogState.clients.find((client) => sameId(client.id, item.clientId))?.name ?? "",
    }));
  const attentionSuggestions: Suggestion[] = attentionRows.slice(0, 3).map(({ item, metrics }) => ({
    kind: "case",
    item,
    caption: isBudgetWarning(metrics.budgetPercent)
      ? `${item.mode === CaseBillingMode.FlatFee ? "Estimated work value / agreed flat fee" : "Budget"} at ${budgetPercent(metrics.budgetPercent!)}`
      : `${metrics.pending} to validate`,
  }));
  const topSuggestions: Suggestion[] = catalogState.clients
    .map((client) => ({
      kind: "client" as const,
      client,
      amount: clientMetrics(catalogState, workspaceState, client.id).toBill,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map(({ amount, ...suggestion }) => ({ ...suggestion, caption: money(amount) }));
  const searchSuggestions: Suggestion[] = query.trim()
    ? [
        ...searchClients.map((client) => ({
          kind: "client" as const,
          client,
          caption: `${catalogState.cases.filter((item) => sameId(item.clientId, client.id)).length} cases`,
        })),
        ...searchCases.map((item) => ({
          kind: "case" as const,
          item,
          caption:
            catalogState.clients.find((client) => sameId(client.id, item.clientId))?.name ?? "",
        })),
      ]
    : [...recentSuggestions, ...attentionSuggestions, ...topSuggestions];
  const chooseSuggestion = (suggestion: Suggestion) => {
    if (suggestion.kind === "client") onSelectClient(suggestion.client.id);
    else onSelectCase(suggestion.item);
    setQuery("");
    setSearchOpen(false);
  };
  const searchBox = (
    <div className="case-search" ref={searchRef}>
      <label className="case-search-box">
        <Icon name="search" small />
        <input
          type="search"
          value={query}
          placeholder="Search for a client or case"
          aria-label="Search for a client or case"
          aria-expanded={searchOpen}
          aria-controls="case-search-results"
          aria-activedescendant={
            searchOpen && searchSuggestions.length && searchActive >= 0
              ? `case-search-option-${searchActive}`
              : undefined
          }
          onFocus={() => setSearchOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchClients([]);
            setSearchCases([]);
            setSearchOpen(true);
            setSearchActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              setSearchOpen(false);
              event.currentTarget.blur();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSearchOpen(true);
              setSearchActive((index) =>
                Math.min(index + 1, Math.max(0, searchSuggestions.length - 1)),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSearchActive((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter" && searchOpen && searchSuggestions[searchActive]) {
              event.preventDefault();
              chooseSuggestion(searchSuggestions[searchActive]);
            }
          }}
        />
      </label>
      {searchOpen && (
        <div
          className="case-search-results"
          id="case-search-results"
          role="listbox"
          aria-label="Case search suggestions"
        >
          {!query.trim() && (
            <>
              <div className="case-search-group">Recently opened</div>
              {recentSuggestions.map((suggestion, index) => searchItem(suggestion, index))}
              {attentionSuggestions.length > 0 && (
                <div className="case-search-group">Needs attention</div>
              )}
              {attentionSuggestions.map((suggestion, index) =>
                searchItem(suggestion, index + recentSuggestions.length),
              )}
              <div className="case-search-group">Most to bill</div>
              {topSuggestions.map((suggestion, index) =>
                searchItem(
                  suggestion,
                  index + recentSuggestions.length + attentionSuggestions.length,
                ),
              )}
              <p className="case-search-help">
                Enter a client name, case title, reference such as{" "}
                <span className="matter-reference">2025-031</span>, or an opposing party.
              </p>
            </>
          )}
          {query.trim() && (
            <>
              {searchClients.length > 0 && <div className="case-search-group">Clients</div>}
              {searchSuggestions
                .slice(0, searchClients.length)
                .map((suggestion, index) => searchItem(suggestion, index))}
              {searchCases.length > 0 && <div className="case-search-group">Cases</div>}
              {searchSuggestions
                .slice(searchClients.length)
                .map((suggestion, index) => searchItem(suggestion, index + searchClients.length))}
              {searchStatus === "loading" && (
                <p className="case-search-help" role="status">
                  Searching…
                </p>
              )}
              {searchStatus === "error" && (
                <p className="case-search-help" role="alert">
                  Could not search clients or cases. Try again.
                </p>
              )}
              {searchStatus === "ready" && !searchSuggestions.length && (
                <p className="case-search-help">No client or case matches “{query}”.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
  function searchItem(suggestion: Suggestion, index: number) {
    return (
      <button
        type="button"
        role="option"
        id={`case-search-option-${index}`}
        aria-selected={searchActive === index}
        className="case-search-item"
        key={`${suggestion.kind}-${suggestion.kind === "case" ? suggestion.item.id : suggestion.client.id}-${index}`}
        title={suggestion.kind === "case" ? suggestion.item.title : suggestion.client.name}
        onMouseEnter={() => setSearchActive(index)}
        onClick={() => chooseSuggestion(suggestion)}
      >
        <span className="case-search-primary">
          {suggestion.kind === "case" ? (
            <>
              {!query.trim() && (
                <Icon name={index < recentSuggestions.length ? "source" : "alert"} small />
              )}
              <span className="case-search-text">
                {!query.trim() && index >= recentSuggestions.length && (
                  <>
                    <strong>
                      {
                        catalogState.clients.find((client) =>
                          sameId(client.id, suggestion.item.clientId),
                        )?.name
                      }
                    </strong>{" "}
                    ·{" "}
                  </>
                )}
                {suggestion.item.title}{" "}
                {!(index >= recentSuggestions.length && !query.trim()) && (
                  <CaseReference value={suggestion.item.reference} />
                )}
              </span>
            </>
          ) : (
            <>
              {!query.trim() && <Icon name="cases" small />}
              <span className="case-search-text">{suggestion.client.name}</span>
            </>
          )}
        </span>
        <small>{suggestion.caption}</small>
      </button>
    );
  }
  return searchBox;
}
