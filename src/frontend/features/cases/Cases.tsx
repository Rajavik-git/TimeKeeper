import { format, parseISO } from "date-fns";
import { calendarDay } from "../../../shared/dates";
import { validatePeriods as runValidation, validationMessage } from "../../api/validatePeriods";
import { useToday } from "../../shared/hooks/useToday";
import { sameId, type EntityId } from "../../api/client";
import { NewCaseDialog } from "./NewCaseDialog";
import { CaseSearch } from "./CaseSearch";
import { useRecentCases } from "./useRecentCases";
import { useEffect, useRef, useState } from "react";
import { api, type ScreenProps, type Case } from "../../api/client";
import {
  effectiveMs,
  formatPreciseDuration,
  formatRoundedMinutes,
  summarizeWork,
} from "../../calculations/billing";
import { caseMetrics, clientMetrics, previousMonthMetrics } from "../../calculations/cases";
import { money as formatMoney, percent, rate as displayRate, shortDate } from "../../shared/format";
import { Icon } from "../../shared/components/Icon";
import { MetricComparison } from "../../shared/components/MetricComparison";
import { CaseReference } from "../../shared/components/CaseReference";
import { SourcePackDialog } from "../../shared/components/SourcePackDialog";
import "./Cases.css";

type ClientSort = "toBill" | "name" | "lastActivity" | "cases" | "rate";
const clientSortStorageKey = "timekeeper-client-sort";
function storedClientSort(): ClientSort {
  const value = sessionStorage.getItem(clientSortStorageKey);
  return value === "name" || value === "lastActivity" || value === "cases" || value === "rate"
    ? value
    : "toBill";
}
const visibleValue = (value: string | null | undefined): value is string =>
  !!value && value !== "N/A" && !value.includes("[");
function DownIcon() {
  return (
    <svg className="case-down-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v13m-5-5 5 5 5-5M5 20h14" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg className="case-chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg className="case-more-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}
function periodLabel(label: string, reference: string) {
  const shortReference = reference.split("-").slice(0, 2).join("-");
  return label.startsWith(`[${shortReference}]`)
    ? label.slice(shortReference.length + 2).trimStart()
    : label;
}

export function Cases({
  catalogState,
  workspaceState,
  action,
  navigate,
  openPeriodActivity,
  openPeriodReview,
  selectedCase,
  refresh,
}: ScreenProps) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const formatRate = (cents: number) => displayRate(cents, catalogState.settings.currency ?? "USD");

  const [clientId, setClientId] = useState<EntityId | null>(null);
  const [caseId, setCaseId] = useState<EntityId | null>(null);
  const [adding, setAdding] = useState(false);
  const [markerValue, setMarkerValue] = useState("");
  const [showMarkerForm, setShowMarkerForm] = useState(false);
  const [markerType, setMarkerType] = useState<
    "case_number" | "opposing_party" | "file" | "email" | "domain" | "keyword"
  >("keyword");
  const [tab, setTab] = useState<"time" | "markers">("time");
  const { recentIds, rememberCase } = useRecentCases();
  const [clientSort, setClientSort] = useState<ClientSort>(storedClientSort);
  const [expandedBillingClients, setExpandedBillingClients] = useState<Set<EntityId>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null);
  const [validatingIds, setValidatingIds] = useState<string[]>([]);
  const validating = validatingIds.length > 0;
  const [savingMarker, setSavingMarker] = useState(false);
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [sorts, setSorts] = useState<Record<string, { column: number; direction: 1 | -1 }>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("timekeeper-case-sorts") ?? "{}");
    } catch {
      return {};
    }
  });
  const [pack, setPack] = useState(false);
  useEffect(() => {
    sessionStorage.setItem("timekeeper-case-sorts", JSON.stringify(sorts));
  }, [sorts]);
  useEffect(() => {
    sessionStorage.setItem(clientSortStorageKey, clientSort);
  }, [clientSort]);
  const caseMenuRef = useRef<HTMLDivElement>(null);
  const appliedSelectedCase = useRef<string | undefined>(undefined);
  const clientsCardRef = useRef<HTMLElement>(null);
  const attentionCardRef = useRef<HTMLElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const showNotice = (message: string, undo?: () => void) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, undo });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  };
  const packAction: ScreenProps["action"] = async <T,>(
    promise: Promise<{ data?: T; error?: unknown }>,
  ) => {
    showNotice("Creating source pack…");
    try {
      const result = await action(promise);
      showNotice(result ? "Source pack created" : "Could not create source pack.");
      return result;
    } catch {
      showNotice("Could not create source pack.");
      return undefined;
    }
  };
  useEffect(() => {
    if (!caseMenuOpen) return;
    caseMenuRef.current?.querySelector<HTMLButtonElement>(".case-overflow-menu button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!caseMenuRef.current?.contains(event.target as Node)) setCaseMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCaseMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [caseMenuOpen]);
  useEffect(() => {
    const requestedId = selectedCase === undefined ? undefined : String(selectedCase);
    if (requestedId === appliedSelectedCase.current) return;
    if (requestedId === undefined) appliedSelectedCase.current = undefined;
    if (selectedCase !== undefined) {
      const target = catalogState.cases.find((item) => sameId(item.id, selectedCase));
      if (target) {
        appliedSelectedCase.current = requestedId;
        setClientId(target.clientId);
        setCaseId(target.id);
        rememberCase(target.id);
      }
    }
  }, [selectedCase, catalogState.cases, rememberCase]);
  const currentClient = catalogState.clients.find((item) => sameId(item.id, clientId));
  const currentCase = catalogState.cases.find((item) => sameId(item.id, caseId));
  const focusCard = (target: HTMLElement | null) => {
    target?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
    target?.focus({ preventScroll: true });
  };
  const openClient = (id: EntityId) => {
    setClientId(id);
    setCaseId(null);
  };
  const openCase = (item: Case) => {
    setClientId(item.clientId);
    setCaseId(item.id);
    setTab("time");
    rememberCase(item.id);
  };
  const validatePeriods = async (ids: string[]) => {
    if (validating || !ids.length) return;
    setValidatingIds(ids);
    showNotice(`Validating ${ids.length} period${ids.length === 1 ? "" : "s"}…`);
    try {
      const result = await runValidation(
        workspaceState.periods.filter((period) => ids.includes(period.id)),
        refresh,
      );
      showNotice(
        validationMessage(result.successful, ids.length, result.refreshFailed, result.stale),
      );
    } finally {
      setValidatingIds([]);
    }
  };
  const breadcrumb = currentClient && (
    <nav className="case-breadcrumb" aria-label="Case breadcrumb">
      <button
        onClick={() => {
          setClientId(null);
          setCaseId(null);
        }}
      >
        Cases
      </button>
      {currentClient && (
        <>
          <ChevronIcon />
          {currentCase ? (
            <button onClick={() => openClient(currentClient.id)}>{currentClient.name}</button>
          ) : (
            <strong>{currentClient.name}</strong>
          )}
        </>
      )}
      {currentCase && (
        <>
          <ChevronIcon />
          <strong>{currentCase.title}</strong>
        </>
      )}
    </nav>
  );
  const header = (title: string, description: string, overview = false) => (
    <>
      {breadcrumb}
      <div className="ph">
        <div className="t">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="actions">
          {overview && (
            <CaseSearch
              catalogState={catalogState}
              workspaceState={workspaceState}
              recentIds={recentIds}
              attentionRows={attentionRows}
              onSelectClient={openClient}
              onSelectCase={openCase}
            />
          )}
          {currentCase && (
            <>
              <button className="btn" onClick={() => setPack(true)}>
                <DownIcon />
                Export source pack
              </button>
              <button className="btn" onClick={() => navigate("preInvoices", currentCase.id)}>
                Billing
              </button>
            </>
          )}
          {currentClient && !currentCase && (
            <button
              className="btn"
              onClick={() => showNotice("Client editing is not available yet.")}
            >
              Edit client
            </button>
          )}
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" small />
            New case
          </button>
        </div>
      </div>
    </>
  );
  const metric = (
    label: string,
    value: string | number,
    detail: string,
    change?: React.ReactNode,
    onClick?: () => void,
  ) => {
    const contents = (
      <>
        <span className="l">{label}</span>
        <span className="case-kpi-value">
          <span className="v">{value}</span>
          {change}
        </span>
        <span className="s">{detail}</span>
      </>
    );
    return onClick ? (
      <button type="button" className="stat case-stat-action" key={label} onClick={onClick}>
        {contents}
      </button>
    ) : (
      <div className="stat" key={label}>
        {contents}
      </div>
    );
  };
  const stats = (items: [string, string | number, string, React.ReactNode?, (() => void)?][]) => (
    <div className="stats cases-stats">
      {items.map(([label, value, detail, change, onClick]) =>
        metric(label, value, detail, change, onClick),
      )}
    </div>
  );
  const reasons = (item: Case, metrics: ReturnType<typeof caseMetrics>) =>
    [
      (metrics.budgetPercent ?? 0) >= 85
        ? `${item.mode === "flat_fee" ? "Flat fee" : "Budget"} at ${percent(metrics.budgetPercent!)}`
        : null,
      metrics.pending
        ? `${metrics.pending} period${metrics.pending === 1 ? "" : "s"} to validate`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const attentionRows = catalogState.cases
    .filter((item) => item.status === "active")
    .map((item) => ({ item, metrics: caseMetrics(catalogState, workspaceState, item) }))
    .filter((row) => (row.metrics.budgetPercent ?? 0) >= 85 || row.metrics.pending > 0)
    .sort(
      (a, b) =>
        (b.metrics.budgetPercent ?? 0) - (a.metrics.budgetPercent ?? 0) ||
        b.metrics.pending - a.metrics.pending,
    );
  const caseCard = (item: Case) => {
    const m = caseMetrics(catalogState, workspaceState, item);
    return (
      <button
        className="case-tile"
        key={item.id}
        title={`${item.title} · ${item.reference}`}
        onClick={() => openCase(item)}
      >
        <div className="case-tile-top">
          <span>
            <strong>{item.title}</strong>
            <CaseReference value={item.reference} />
          </span>
          <span className={`st ${item.status === "active" ? "ok" : ""}`}>
            <i />
            {item.status === "active" ? "Open" : "Closed"}
          </span>
        </div>
        <p>
          {item.category}
          {visibleValue(item.opposingParty) ? ` · v ${item.opposingParty}` : ""}
        </p>
        <dl className="case-tile-facts">
          <div>
            <dt>Pricing</dt>
            <dd>
              {item.mode === "flat_fee"
                ? `Flat fee ${money(item.flatFeeCents ?? 0)}`
                : formatRate(m.rate.rateCents)}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{`${formatRoundedMinutes(m.time)}${m.complete ? "" : " · partial"}`}</dd>
          </div>
          <div>
            <dt>To bill</dt>
            <dd className="case-to-bill-value">
              {item.mode === "flat_fee" ? "Flat fee" : money(m.toBill)}
            </dd>
          </div>
          <div>
            <dt>{item.mode === "flat_fee" ? "Flat fee used" : "Budget"}</dt>
            <dd>{m.budgetPercent === null ? "—" : percent(m.budgetPercent)}</dd>
          </div>
        </dl>
        {m.budgetPercent !== null && (
          <div className="bar">
            <span style={{ width: `${Math.min(m.budgetPercent, 100)}%` }} />
          </div>
        )}
      </button>
    );
  };
  let body;
  if (!currentClient) {
    const caseIds = new Set(catalogState.cases.map((item) => String(item.id)));
    const allPeriods = workspaceState.periods.filter(
      (period) =>
        !period.excluded &&
        period.caseId !== null &&
        caseIds.has(period.caseId) &&
        calendarDay(period.startedAt).slice(0, 7) === today.slice(0, 7) &&
        calendarDay(period.startedAt) <= today,
    );
    const monthlyMinutes = Math.ceil(
      allPeriods.reduce((sum, period) => sum + (effectiveMs(period) ?? 0), 0) / 60000,
    );
    const clients = catalogState.clients.map((item) => ({
      item,
      metrics: clientMetrics(catalogState, workspaceState, item.id),
    }));
    const sortedClients = [...clients].sort((a, b) => {
      let comparison = 0;
      switch (clientSort) {
        case "name":
          comparison = a.item.name.localeCompare(b.item.name, "en-US");
          break;
        case "lastActivity":
          comparison = a.metrics.latest
            ? b.metrics.latest
              ? Date.parse(b.metrics.latest) - Date.parse(a.metrics.latest)
              : -1
            : b.metrics.latest
              ? 1
              : 0;
          break;
        case "cases":
          comparison = b.metrics.cases.length - a.metrics.cases.length;
          break;
        case "rate":
          comparison =
            (b.item.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0) -
            (a.item.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0);
          break;
        default:
          comparison =
            b.metrics.toBill - a.metrics.toBill ||
            (a.metrics.toBill === 0 ? Number(!!b.metrics.latest) - Number(!!a.metrics.latest) : 0);
      }
      return comparison || a.item.name.localeCompare(b.item.name, "en-US");
    });
    const toBill = clients.reduce((sum, row) => sum + row.metrics.toBill, 0);
    const maxToBill = Math.max(1, ...clients.map((row) => row.metrics.toBill));
    const budgetAlerts = attentionRows.filter((row) => (row.metrics.budgetPercent ?? 0) >= 85);
    const pendingAlerts = attentionRows.reduce((sum, row) => sum + row.metrics.pending, 0);
    const attentionCount = budgetAlerts.length + pendingAlerts;
    const prior = previousMonthMetrics(catalogState, workspaceState, today);
    const openCases = catalogState.cases.filter((item) => item.status === "active").length;
    body = (
      <>
        {header(
          "Cases",
          `An overview of your practice. Estimates use current rates and billing state. Changes in % compare with the same period last month (${format(parseISO(prior.previousDay), "MMM")} 1–${Number(prior.previousDay.slice(8))}).`,
          true,
        )}
        {stats([
          [
            "Needs attention",
            attentionCount,
            `${budgetAlerts.length} budget${budgetAlerts.length === 1 ? "" : "s"} · ${pendingAlerts} periods to validate`,
            undefined,
            () => focusCard(attentionCardRef.current),
          ],
          [
            "To bill",
            money(toBill),
            "All cases",
            <MetricComparison
              current={toBill}
              previous={prior.previousToBill}
              previousDay={prior.previousDay}
              increaseGood={false}
            />,
            () => navigate("preInvoices"),
          ],
          [
            "Cases",
            catalogState.cases.length,
            `${catalogState.clients.length} clients · ${openCases} open`,
            <MetricComparison
              current={catalogState.cases.length}
              previous={prior.previousCases}
              previousDay={prior.previousDay}
            />,
            () => focusCard(clientsCardRef.current),
          ],
          [
            `Time in ${format(parseISO(today), "MMMM")}`,
            formatRoundedMinutes(monthlyMinutes),
            "All cases",
            <MetricComparison
              current={monthlyMinutes}
              previous={prior.previousMinutes}
              previousDay={prior.previousDay}
            />,
            () => navigate("source"),
          ],
        ])}
        <div className="cases-dashboard cases-fill">
          <section className="card cases-clients" ref={clientsCardRef} tabIndex={-1}>
            <div className="card-h">
              <div className="t">
                <h2>Clients</h2>
                <p>{catalogState.clients.length} clients · choose one to see its cases</p>
              </div>
              <label className="client-sort" htmlFor="client-sort">
                Sort by{" "}
                <select
                  id="client-sort"
                  className="field"
                  value={clientSort}
                  onChange={(event) => {
                    const previous = clientSort;
                    setClientSort(event.target.value as ClientSort);
                    showNotice(
                      `Sorted clients by ${event.currentTarget.selectedOptions[0].text.toLowerCase()}`,
                      () => setClientSort(previous),
                    );
                  }}
                >
                  <option value="toBill">To bill</option>
                  <option value="name">Name</option>
                  <option value="lastActivity">Last activity</option>
                  <option value="cases">Cases</option>
                  <option value="rate">Rate</option>
                </select>
              </label>
            </div>
            <div className="case-scroll client-grid">
              {sortedClients.map(({ item, metrics }) => (
                <button
                  className="client-tile"
                  key={item.id}
                  title={item.name}
                  onClick={() => openClient(item.id)}
                >
                  <div className="case-tile-top">
                    <strong>{item.name}</strong>
                    <span className="muted">
                      {item.type === "company" ? "Company" : "Individual"}
                    </span>
                  </div>
                  <dl className="case-tile-facts">
                    <div>
                      <dt>Cases</dt>
                      <dd>{metrics.cases.length}</dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {formatRate(
                          item.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>To bill</dt>
                      <dd className="case-to-bill-value">{money(metrics.toBill)}</dd>
                    </div>
                    <div>
                      <dt>Last activity</dt>
                      <dd>{metrics.latest ? shortDate(calendarDay(metrics.latest)) : "—"}</dd>
                    </div>
                  </dl>
                </button>
              ))}
              {!sortedClients.length && (
                <p className="case-empty">
                  No clients yet.{" "}
                  <button onClick={() => navigate("settings")}>Open Settings</button>
                </p>
              )}
            </div>
          </section>
          <div className="cases-rail">
            <section className="card" ref={attentionCardRef} tabIndex={-1}>
              <div className="card-h">
                <div className="t">
                  <h2>Needs attention</h2>
                  <p>Do these first.</p>
                </div>
              </div>
              <div className="case-scroll attention-list">
                {attentionRows.length ? (
                  attentionRows.map(({ item, metrics }) => {
                    const client = catalogState.clients.find((owner) =>
                      sameId(owner.id, item.clientId),
                    );
                    const pendingIds = metrics.periods
                      .filter((period) => !period.timeValidated)
                      .map((period) => period.id);
                    return (
                      <div key={item.id}>
                        <Icon name="alert" small />
                        <span>
                          <span>
                            <strong>{client?.name}</strong> · {item.title}{" "}
                            <CaseReference value={item.reference} />
                          </span>
                          <small>{reasons(item, metrics)}</small>
                          {(metrics.budgetPercent ?? 0) >= 85 && (
                            <span className="bar">
                              <span
                                style={{ width: `${Math.min(metrics.budgetPercent ?? 0, 100)}%` }}
                              />
                            </span>
                          )}
                        </span>
                        <span className="case-attention-actions">
                          {pendingIds.length > 0 && (
                            <button
                              className="btn sm attn"
                              disabled={validating}
                              onClick={() => void validatePeriods(pendingIds)}
                            >
                              {pendingIds.some((id) => validatingIds.includes(id))
                                ? "Validating…"
                                : `Validate ${pendingIds.length}`}
                            </button>
                          )}
                          <button className="btn sm" onClick={() => openCase(item)}>
                            Open
                          </button>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="case-empty">
                    All caught up. <button onClick={() => navigate("myDay")}>Review My day</button>
                  </p>
                )}
              </div>
            </section>
            <section className="card">
              <div className="card-h">
                <div className="t">
                  <h2>To bill by client</h2>
                  <p>Unbilled work. Click a client to open it.</p>
                </div>
              </div>
              <div className="case-scroll bar-list">
                {[...clients]
                  .sort((a, b) => b.metrics.toBill - a.metrics.toBill)
                  .map(({ item, metrics }) => {
                    const expanded = expandedBillingClients.has(item.id);
                    const cases = metrics.cases
                      .map((caseItem) => {
                        const unbilled =
                          caseItem.mode === "flat_fee"
                            ? []
                            : workspaceState.periods.filter(
                                (period) =>
                                  period.caseId === String(caseItem.id) &&
                                  period.billable &&
                                  !period.excluded &&
                                  period.billingStatus === "unbilled",
                              );
                        return {
                          caseItem,
                          metrics: caseMetrics(catalogState, workspaceState, caseItem),
                          unbilledMinutes: summarizeWork(unbilled, workspaceState.sources)
                            .roundedMinutes,
                        };
                      })
                      .sort(
                        (a, b) =>
                          b.metrics.toBill - a.metrics.toBill ||
                          a.caseItem.title.localeCompare(b.caseItem.title, "en-US"),
                      );
                    const unbilledClientMinutes = metrics.unbilledSummary.roundedMinutes;
                    const unbilledComplete = metrics.unbilledSummary.complete;
                    return (
                      <div className="bill-client-group" key={item.id}>
                        <div className="bill-client-head">
                          <button
                            type="button"
                            className="bill-expand"
                            aria-label={`${expanded ? "Collapse" : "Expand"} cases for ${item.name}`}
                            aria-expanded={expanded}
                            aria-controls={`bill-cases-${item.id}`}
                            onClick={() =>
                              setExpandedBillingClients((previous) => {
                                const next = new Set(previous);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                          >
                            <ChevronIcon />
                          </button>
                          <button
                            type="button"
                            className="bill-client-link"
                            title={item.name}
                            onClick={() => openClient(item.id)}
                          >
                            <strong className="bar-client-name">{item.name}</strong>
                            <span className="bar">
                              <span style={{ width: `${(metrics.toBill * 100) / maxToBill}%` }} />
                            </span>
                            <span
                              className={`bar-amount${metrics.toBill === 0 ? " case-zero" : ""}`}
                            >
                              {metrics.toBill === 0 ? "—" : money(metrics.toBill)}
                            </span>
                            <span className="bar-time">
                              {formatRoundedMinutes(unbilledClientMinutes)}
                              {!unbilledComplete && " · partial"}
                            </span>
                          </button>
                        </div>
                        <div
                          className="bill-case-list"
                          id={`bill-cases-${item.id}`}
                          role="group"
                          aria-label={`Cases for ${item.name}`}
                          hidden={!expanded}
                        >
                          {cases.map(({ caseItem, metrics: caseTotals, unbilledMinutes }) => {
                            return (
                              <button
                                type="button"
                                className="bill-case-row"
                                key={caseItem.id}
                                title={caseItem.title}
                                onClick={() => openCase(caseItem)}
                              >
                                <span className="bill-case-name">
                                  <strong>{caseItem.title}</strong>
                                  <CaseReference value={caseItem.reference} />
                                </span>
                                <span className="bar">
                                  <span
                                    style={{ width: `${(caseTotals.toBill * 100) / maxToBill}%` }}
                                  />
                                </span>
                                <span className="bar-amount">
                                  {caseItem.mode === "flat_fee"
                                    ? "Flat fee"
                                    : money(caseTotals.toBill)}
                                </span>
                                <span className="bar-time">
                                  {formatRoundedMinutes(unbilledMinutes)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                {!clients.length && (
                  <p className="case-empty">
                    Nothing to bill yet.{" "}
                    <button onClick={() => navigate("myDay")}>Review My day</button>
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </>
    );
  } else if (!currentCase) {
    const m = clientMetrics(catalogState, workspaceState, currentClient.id);
    const clientCases = new Map(m.cases.map((item) => [String(item.id), item]));
    const recentPeriods = workspaceState.periods
      .filter(
        (period) => !period.excluded && period.caseId !== null && clientCases.has(period.caseId),
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id))
      .slice(0, 5);
    const clientDescription = `${currentClient.type === "company" ? "Company" : "Individual"} · ${formatRate(currentClient.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0)}${visibleValue(currentClient.billingAddress) ? ` · billing address ${currentClient.billingAddress}` : ""}`;
    body = (
      <>
        {header(currentClient.name, clientDescription)}
        {stats([
          [
            "Cases",
            m.cases.length,
            `${m.cases.filter((item) => item.status === "active").length} open`,
          ],
          [
            "Time recorded",
            `${formatRoundedMinutes(m.time)}${m.complete ? "" : " · partial"}`,
            "All cases",
          ],
          ["To bill", money(m.toBill), "Before expenses"],
          ["To validate", m.pending, "Periods"],
        ])}
        <div className="cases-client-content cases-fill">
          <div className="case-scroll case-grid cases-client-grid">
            {m.cases.length ? (
              m.cases.map(caseCard)
            ) : (
              <p className="case-empty">
                No cases for this client yet.{" "}
                <button onClick={() => setAdding(true)}>Create a case</button>
              </p>
            )}
          </div>
          <section className="card cases-recent">
            <div className="card-h">
              <div className="t">
                <h2>Recent activity</h2>
                <p>Latest recorded work for this client.</p>
              </div>
            </div>
            <div className="case-scroll tbl">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Case</th>
                    <th>Work performed</th>
                    <th className="r">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPeriods.map((period) => (
                    <tr key={period.id}>
                      <td>{shortDate(calendarDay(period.startedAt))}</td>
                      <td title={clientCases.get(period.caseId!)?.title}>
                        <button
                          className="case-inline-link"
                          onClick={() => openCase(clientCases.get(period.caseId!)!)}
                        >
                          {clientCases.get(period.caseId!)?.title}
                        </button>
                      </td>
                      <td
                        title={periodLabel(
                          period.label,
                          clientCases.get(period.caseId!)?.reference ?? "",
                        )}
                      >
                        {periodLabel(
                          period.label,
                          clientCases.get(period.caseId!)?.reference ?? "",
                        )}
                      </td>
                      <td className="r num">{formatPreciseDuration(effectiveMs(period))}</td>
                    </tr>
                  ))}
                  {!recentPeriods.length && (
                    <tr>
                      <td colSpan={4} className="case-empty">
                        No activity yet.{" "}
                        <button onClick={() => navigate("myDay")}>Open My day</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </>
    );
  } else {
    const m = caseMetrics(catalogState, workspaceState, currentCase);
    const sortKey = `${currentCase.id}:${tab}`;
    const sorting = sorts[sortKey];
    const changeSort = (column: number, numeric: boolean, label: string) => {
      const previous = sorts[sortKey];
      setSorts((old) => ({
        ...old,
        [sortKey]: {
          column,
          direction:
            old[sortKey]?.column === column
              ? old[sortKey]!.direction === 1
                ? -1
                : 1
              : numeric
                ? -1
                : 1,
        },
      }));
      showNotice(`Sorted by ${label.toLowerCase()}`, () =>
        setSorts((old) => {
          const next = { ...old };
          if (previous) next[sortKey] = previous;
          else delete next[sortKey];
          return next;
        }),
      );
    };
    const sortedHeading = (label: string, column: number, numeric = false, right = false) => (
      <th
        className={`${right ? "r " : ""}case-sortable`}
        scope="col"
        aria-sort={
          sorting?.column === column
            ? sorting.direction === 1
              ? "ascending"
              : "descending"
            : undefined
        }
      >
        <button type="button" onClick={() => changeSort(column, numeric, label)}>
          {label}
          {sorting?.column === column ? (sorting.direction === 1 ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
    const amountFor = (line: (typeof m.periods)[number]) =>
      line.billingStatus === "billed" ||
      currentCase.mode === "flat_fee" ||
      !line.billable ||
      effectiveMs(line) === null
        ? null
        : Math.round((effectiveMs(line)! * m.rate.rateCents) / 3600000);
    const lines = [...m.periods].sort((a, b) => {
      if (!sorting)
        return Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id);
      const value = (line: typeof a) =>
        [
          Date.parse(line.startedAt),
          line.label,
          effectiveMs(line),
          amountFor(line),
          line.timeValidated ? "Validated" : "To validate",
          line.billingStatus,
        ][sorting.column];
      const av = value(a),
        bv = value(b);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (
        sorting.direction *
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv)))
      );
    });
    const markerTypeOrder: Record<string, number> = {
      opposing_party: 0,
      case_number: 1,
      file: 2,
      email: 3,
      domain: 4,
      keyword: 5,
    };
    const markers = catalogState.markers
      .filter(
        (item) =>
          sameId(item.caseId, currentCase.id) &&
          item.type !== "client_name" &&
          visibleValue(item.value),
      )
      .sort((a, b) =>
        sorting && tab === "markers"
          ? sorting.direction *
            (sorting.column === 1 ? a.type.localeCompare(b.type) : a.value.localeCompare(b.value))
          : (markerTypeOrder[a.type] ?? 9) - (markerTypeOrder[b.type] ?? 9) ||
            a.value.localeCompare(b.value),
      );
    const builtInMarkers = [
      {
        value: currentCase.reference.split("-").slice(0, 2).join("-"),
        type: "Case reference",
        badge: true,
      },
      ...(visibleValue(currentCase.opposingParty) &&
      !markers.some(
        (marker) =>
          marker.value.toLocaleLowerCase() === currentCase.opposingParty.toLocaleLowerCase(),
      )
        ? [{ value: currentCase.opposingParty, type: "Opposing party", badge: false }]
        : []),
    ];
    const clientNameMarker = visibleValue(currentClient.name)
      ? { value: currentClient.name, type: "Client name", badge: false }
      : null;
    const markerCount = builtInMarkers.length + markers.length + (clientNameMarker ? 1 : 0);
    body = (
      <>
        {breadcrumb}
        <div className="ph cases-detail-header">
          <div className="t">
            <h1>
              {currentCase.title} <CaseReference value={currentCase.reference} />
            </h1>
            <p>
              {currentClient.name} · {currentCase.category}
            </p>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => navigate("preInvoices", currentCase.id)}>
              <Icon name="pre" small />
              Pre-invoice
            </button>
            <button
              className="btn"
              onClick={() => showNotice("Case editing is not available yet.")}
            >
              <Icon name="edit" small />
              Edit case
            </button>
            <div className="case-overflow" ref={caseMenuRef}>
              <button
                type="button"
                className="btn case-overflow-trigger"
                aria-label="More case actions"
                aria-expanded={caseMenuOpen}
                aria-controls="case-overflow-menu"
                onClick={() => setCaseMenuOpen((open) => !open)}
              >
                <MoreIcon />
              </button>
              {caseMenuOpen && (
                <div className="case-overflow-menu" id="case-overflow-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setCaseMenuOpen(false);
                      setPack(true);
                    }}
                  >
                    <DownIcon />
                    Export source pack
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {stats([
          [
            "Time recorded",
            `${formatRoundedMinutes(m.time)}${m.complete ? "" : " · partial"}`,
            `${lines.length} periods`,
          ],
          [
            "To bill",
            currentCase.mode === "flat_fee" ? "Flat fee" : money(m.toBill),
            "Before expenses",
          ],
          [
            "Not billable",
            formatRoundedMinutes(m.nonBillable),
            `Value ${money(Math.round((m.nonBillable * m.rate.rateCents) / 60))}`,
          ],
          [
            currentCase.mode === "flat_fee" ? "Flat fee used" : "Budget used",
            m.budgetPercent === null ? "—" : percent(m.budgetPercent),
            m.budget ? `${money(m.spent)} of ${money(m.budget)}` : "No budget set",
          ],
        ])}
        <section className="card case-facts-card">
          <dl className="facts case-facts">
            <div>
              <dt>Pricing</dt>
              <dd>
                {currentCase.mode === "flat_fee"
                  ? `Flat fee ${money(currentCase.flatFeeCents ?? 0)}`
                  : `${formatRate(m.rate.rateCents)} · ${m.rate.origin === "matter" ? "case rate" : m.rate.origin === "client" ? "client rate" : "base rate"}`}
              </dd>
            </div>
            {visibleValue(currentCase.opposingParty) && (
              <div>
                <dt>Opposing party</dt>
                <dd>{currentCase.opposingParty}</dd>
              </div>
            )}
            {visibleValue(currentCase.caseNumber) && (
              <div>
                <dt>Case number</dt>
                <dd>{currentCase.caseNumber}</dd>
              </div>
            )}
            <div>
              <dt>Opened</dt>
              <dd>
                {currentCase.openedOn
                  ? `${shortDate(currentCase.openedOn)} ${currentCase.openedOn.slice(0, 4)}`
                  : "Unknown"}
              </dd>
            </div>
          </dl>
          {m.budgetPercent !== null && (
            <div
              className={`card-b budget${m.budgetPercent >= 100 ? " case-budget-danger" : m.budgetPercent >= 85 ? " case-budget-warn" : ""}`}
            >
              <div className="row between">
                <span>{currentCase.mode === "flat_fee" ? "Flat fee used" : "Budget used"}</span>
                <span>
                  {money(m.spent)}{" "}
                  <span className="case-budget-muted">of {money(m.budget ?? 0)}</span> ·{" "}
                  {percent(m.budgetPercent)}
                </span>
              </div>
              <div className="bar">
                <span style={{ width: `${Math.min(m.budgetPercent, 100)}%` }} />
              </div>
              {m.budgetPercent >= 85 && (
                <span className="flag">
                  <Icon name="alert" small />
                  Above 85%. Let the client know.
                </span>
              )}
            </div>
          )}
        </section>
        <section className="card cases-fill case-detail-list">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Case sections">
              <button role="tab" aria-selected={tab === "time"} onClick={() => setTab("time")}>
                Time ({lines.length})
              </button>
              <button
                role="tab"
                aria-selected={tab === "markers"}
                onClick={() => setTab("markers")}
              >
                Markers ({markerCount})
              </button>
            </div>
            <div className="case-toolbar-actions">
              {tab === "time" && m.pending > 0 && (
                <button
                  className="btn sm attn"
                  disabled={validating}
                  onClick={() =>
                    void validatePeriods(
                      m.periods
                        .filter((period) => !period.timeValidated)
                        .map((period) => period.id),
                    )
                  }
                >
                  {validatingIds.length === m.pending
                    ? "Validating…"
                    : `Validate all (${m.pending})`}
                </button>
              )}
              {tab === "markers" && (
                <button className="btn sm" onClick={() => setShowMarkerForm((value) => !value)}>
                  <Icon name="plus" small />
                  Add marker
                </button>
              )}
            </div>
          </div>
          {tab === "time" ? (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    {sortedHeading("Date", 0, true)}
                    {sortedHeading("Work performed", 1)}
                    {sortedHeading("Duration", 2, true, true)}
                    {sortedHeading("Amount", 3, true, true)}
                    {sortedHeading("Status", 4)}
                    {sortedHeading("Billing", 5)}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.id}
                      className={
                        workspaceState.sources.some((record) => record.workPeriodId === line.id)
                          ? "click"
                          : ""
                      }
                      tabIndex={
                        workspaceState.sources.some((record) => record.workPeriodId === line.id)
                          ? 0
                          : undefined
                      }
                      onClick={() => {
                        if (
                          workspaceState.sources.some((record) => record.workPeriodId === line.id)
                        )
                          openPeriodActivity(line.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (
                          (event.key === "Enter" || event.key === " ") &&
                          workspaceState.sources.some((record) => record.workPeriodId === line.id)
                        ) {
                          event.preventDefault();
                          openPeriodActivity(line.id);
                        }
                      }}
                    >
                      <td>{shortDate(calendarDay(line.startedAt))}</td>
                      <td className="wrap">
                        {periodLabel(line.label, currentCase.reference)}
                        <span className="sub">
                          {catalogState.taskTypes.find((task) => task.id === line.taskTypeId)
                            ?.label ?? "Work period"}
                        </span>
                      </td>
                      <td className="r num">{formatPreciseDuration(effectiveMs(line))}</td>
                      <td className="r num">
                        {line.billingStatus === "billed"
                          ? line.invoiceId != null
                            ? "In invoice"
                            : "Billed"
                          : currentCase.mode === "flat_fee"
                            ? "Flat fee"
                            : line.billable && effectiveMs(line) !== null
                              ? money(Math.round((effectiveMs(line)! * m.rate.rateCents) / 3600000))
                              : "—"}
                      </td>
                      <td>
                        {line.timeValidated ? (
                          <span className="st ok">
                            <i />
                            Validated
                          </span>
                        ) : (
                          <span className="st warn">
                            <i />
                            To validate
                          </span>
                        )}
                      </td>
                      <td>
                        {line.billable ? (
                          line.billingStatus === "billed" ? (
                            <span className="st billed">
                              <i />
                              Billed
                            </span>
                          ) : (
                            <span className="st">
                              <i />
                              Unbilled
                            </span>
                          )
                        ) : (
                          <span className="st">
                            <i />
                            Not billable
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="case-rowact">
                          {openPeriodReview && (
                            <button
                              className="btn sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                openPeriodReview(line.id);
                              }}
                            >
                              Review
                            </button>
                          )}
                          {!line.timeValidated && (
                            <button
                              className="btn sm attn"
                              disabled={validating}
                              onClick={(event) => {
                                event.stopPropagation();
                                void validatePeriods([line.id]);
                              }}
                            >
                              {validatingIds.includes(line.id) ? "Validating…" : "Validate"}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!lines.length && (
                    <tr>
                      <td colSpan={7} className="case-empty">
                        No time recorded yet.{" "}
                        <button onClick={() => navigate("myDay")}>Open My day</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="card-b muted marker-intro">
                Names, files and words that tell TimeKeeper this work belongs to this case.
              </div>
              <div className="tbl case-marker-table">
                <table>
                  <thead>
                    <tr>
                      {sortedHeading("Marker", 0)}
                      {sortedHeading("Type", 1)}
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {builtInMarkers.map((marker) => (
                      <tr key={`builtin-${marker.type}`}>
                        <td>
                          {marker.badge ? (
                            <span className="case-ref-badge">{marker.value}</span>
                          ) : (
                            marker.value
                          )}
                        </td>
                        <td>{marker.type}</td>
                        <td />
                      </tr>
                    ))}
                    {markers.map((marker) => (
                      <tr key={marker.id}>
                        <td title={marker.value}>{marker.value}</td>
                        <td>
                          {marker.type === "opposing_party"
                            ? "Opposing party"
                            : marker.type
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                          {marker.learned ? " · learned from you" : ""}
                        </td>
                        <td>
                          <span className="case-rowact">
                            <button
                              className="btn sm"
                              disabled={savingMarker}
                              aria-label={`Remove ${marker.value}`}
                              onClick={async () => {
                                setSavingMarker(true);
                                showNotice("Removing marker…");
                                try {
                                  const response = await api.DELETE("/api/catalog/markers/{id}", {
                                    params: { path: { id: marker.id } },
                                  });
                                  if (response.error) showNotice("Could not remove marker.");
                                  else {
                                    await refresh();
                                    showNotice("Marker removed");
                                  }
                                } catch {
                                  showNotice("Could not remove marker.");
                                } finally {
                                  setSavingMarker(false);
                                }
                              }}
                            >
                              Remove
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!markerCount && (
                      <tr>
                        <td colSpan={3} className="case-empty">
                          No markers yet.{" "}
                          <button onClick={() => setShowMarkerForm(true)}>Add a marker</button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {showMarkerForm && (
                <div className="card-b row">
                  <select
                    className="field"
                    aria-label="Marker type"
                    value={markerType}
                    onChange={(event) => setMarkerType(event.target.value as typeof markerType)}
                  >
                    {(
                      [
                        "case_number",
                        "opposing_party",
                        "file",
                        "email",
                        "domain",
                        "keyword",
                      ] as const
                    ).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field grow"
                    aria-label="New marker"
                    placeholder="Name, file, keyword…"
                    value={markerValue}
                    onChange={(event) => setMarkerValue(event.target.value)}
                  />
                  <button
                    className="btn sm"
                    disabled={savingMarker || !markerValue.trim()}
                    onClick={async () => {
                      if (markerValue.trim()) {
                        setSavingMarker(true);
                        showNotice("Adding marker…");
                        try {
                          const response = await api.POST("/api/catalog/markers", {
                            body: {
                              caseId: currentCase.id,
                              type: markerType,
                              value: markerValue.trim(),
                            },
                          });
                          if (response.error) showNotice("Could not add marker.");
                          else {
                            await refresh();
                            setMarkerValue("");
                            setShowMarkerForm(false);
                            showNotice("Marker added");
                          }
                        } catch {
                          showNotice("Could not add marker.");
                        } finally {
                          setSavingMarker(false);
                        }
                      }
                    }}
                  >
                    {savingMarker ? "Adding…" : "Add marker"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </>
    );
  }
  return (
    <>
      {!summarizeWork(workspaceState.periods, workspaceState.sources).complete && (
        <p role="status">Partial totals · some durations or sources are unavailable.</p>
      )}
      {body}
      {notice && (
        <div role="status" className="toast case-toast">
          <span>{notice.message}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => {
                notice.undo?.();
                setNotice(null);
                window.clearTimeout(noticeTimer.current);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {pack && currentCase && (
        <SourcePackDialog
          catalogState={catalogState}
          workspaceState={workspaceState}
          caseId={currentCase.id}
          action={packAction}
          close={() => setPack(false)}
        />
      )}
      <NewCaseDialog
        catalogState={catalogState}
        action={action}
        open={adding}
        close={() => setAdding(false)}
        onCreated={openCase}
        showNotice={showNotice}
      />
    </>
  );
}
