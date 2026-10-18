import { isBudgetWarning } from "../../../../calculations/case-budget";
import { budgetPercent } from "../../../../shared/presentation/budget";
import { caseBillingModeLabels, clientTypeLabels } from "../../../../shared/presentation/catalog";
import {
  BillingStatus,
  CaseBillingMode,
  CaseStatus,
} from "../../../../../contracts/states.generated";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { calendarDay } from "../../../../../shared/dates";
import { sameId, type Case, type EntityId, type ScreenProps } from "../../../../api/client";
import { summarizeWork, formatRoundedMinutes } from "../../../../calculations/billing";
import { caseMetrics, clientMetrics } from "../../../../calculations/cases";
import { money as formatMoney, rate as displayRate, shortDate } from "../../../../shared/format";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";
import { MetricComparison } from "../../../../shared/components/MetricComparison/MetricComparison";
import { monthlyRecordedTime } from "../../../../calculations/comparison";
import { RecordedTimeComparison } from "../RecordedTimeComparison/RecordedTimeComparison";
import { CaseStats } from "../CaseStats/CaseStats";
import { ChevronIcon } from "../CaseIcons/CaseIcons";
type ClientSort = "toBill" | "name" | "lastActivity" | "cases" | "rate";
const comparisonClientStorageKey = "timekeeper-comparison-client";
const clientSortStorageKey = "timekeeper-client-sort";
function storedClientSort(): ClientSort {
  const value = sessionStorage.getItem(clientSortStorageKey);
  return value === "name" || value === "lastActivity" || value === "cases" || value === "rate"
    ? value
    : "toBill";
}

type Props = Pick<ScreenProps, "catalogState" | "workspaceState" | "navigate"> & {
  today: string;
  validatingIds: string[];
  validatePeriods: (ids: string[]) => Promise<void>;
  header: (title: string, description: string, overview?: boolean) => ReactNode;
  openClient: (id: EntityId) => void;
  openCase: (item: Case) => void;
  attentionRows: { item: Case; metrics: ReturnType<typeof caseMetrics> }[];
  showNotice: (message: string, undo?: () => void) => void;
};
export function CasesOverview({
  catalogState,
  workspaceState,
  today,
  header,
  openClient,
  openCase,
  attentionRows,
  showNotice,
  navigate,
  validatingIds,
  validatePeriods,
}: Props) {
  const validating = validatingIds.length > 0;
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const formatRate = (cents: number) => displayRate(cents, catalogState.settings.currency ?? "USD");
  const [clientSort, setClientSort] = useState<ClientSort>(storedClientSort);
  const [comparisonClientId, setComparisonClientId] = useState<string | null>(() =>
    sessionStorage.getItem(comparisonClientStorageKey),
  );
  const [expandedBillingClients, setExpandedBillingClients] = useState<Set<EntityId>>(
    () => new Set(),
  );
  useEffect(() => {
    sessionStorage.setItem(clientSortStorageKey, clientSort);
  }, [clientSort]);
  const clientsCardRef = useRef<HTMLElement>(null);
  const attentionCardRef = useRef<HTMLElement>(null);
  const focusCard = (target: HTMLElement | null) => {
    target?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
    target?.focus({ preventScroll: true });
  };
  const reasons = (item: Case, metrics: ReturnType<typeof caseMetrics>) =>
    [
      isBudgetWarning(metrics.budgetPercent)
        ? `${item.mode === CaseBillingMode.FlatFee ? "Estimated work value / agreed flat fee" : "Budget"} at ${budgetPercent(metrics.budgetPercent!)}`
        : null,
      metrics.pending
        ? `${metrics.pending} period${metrics.pending === 1 ? "" : "s"} to validate`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const timeComparison = monthlyRecordedTime(
    catalogState,
    workspaceState,
    today,
    comparisonClientId,
  );
  useEffect(() => {
    if (timeComparison.clientId === null) sessionStorage.removeItem(comparisonClientStorageKey);
    else sessionStorage.setItem(comparisonClientStorageKey, String(timeComparison.clientId));
    if (comparisonClientId !== null && timeComparison.clientId === null)
      setComparisonClientId(null);
  }, [comparisonClientId, timeComparison.clientId]);
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
  const budgetAlerts = attentionRows.filter((row) => isBudgetWarning(row.metrics.budgetPercent));
  const pendingAlerts = attentionRows.reduce((sum, row) => sum + row.metrics.pending, 0);
  const attentionCount = budgetAlerts.length + pendingAlerts;
  const openCases = catalogState.cases.filter((item) => item.status === CaseStatus.Active).length;
  return (
    <>
      {header("Cases", "Review clients, cases, and work that needs attention.", true)}
      <details className="comparison-method">
        <summary>About these figures</summary>
        <p>
          Balances and case counts describe the current workspace. Historical comparisons are
          unavailable because earlier balances and counts are not stored. Recorded time compares{" "}
          {timeComparison.ranges} for {timeComparison.scopeLabel} using current corrected records.
          The client selector changes only recorded time. Other figures and billing bars cover all
          clients. Missing durations or sources in the selected scope prevent a percentage
          comparison.
        </p>
      </details>
      <RecordedTimeComparison
        clients={catalogState.clients}
        comparison={timeComparison}
        workspace={workspaceState}
        onChange={setComparisonClientId}
      />
      {
        <CaseStats
          items={[
            [
              "Needs attention",
              attentionCount,
              `${budgetAlerts.length} budget${budgetAlerts.length === 1 ? "" : "s"} · ${pendingAlerts} period${pendingAlerts === 1 ? "" : "s"} to validate`,
              undefined,
              () => focusCard(attentionCardRef.current),
            ],
            ["To bill", money(toBill), "All cases", undefined, () => navigate("preInvoices")],
            [
              "Cases",
              catalogState.cases.length,
              `${catalogState.clients.length} client${catalogState.clients.length === 1 ? "" : "s"} · ${openCases} active`,
              undefined,
              () => focusCard(clientsCardRef.current),
            ],
            [
              `Time in ${format(parseISO(today), "MMMM")}`,
              formatRoundedMinutes(timeComparison.current.roundedMinutes),
              `${timeComparison.scopeLabel} · ${timeComparison.currentStart}–${today}${timeComparison.current.complete ? "" : " · Partial total"}`,
              <MetricComparison comparison={timeComparison.comparison} />,
              () => navigate("source"),
            ],
          ]}
        />
      }
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
          <div className="case-scroll cases-client-scroll">
            <div className="client-grid">
              {sortedClients.map(({ item, metrics }) => (
                <button
                  className="card card-padded client-tile"
                  key={item.id}
                  title={item.name}
                  onClick={() => openClient(item.id)}
                >
                  <div className="case-tile-top">
                    <strong>{item.name}</strong>
                    <span className="muted">{clientTypeLabels[item.type]}</span>
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
                        {isBudgetWarning(metrics.budgetPercent) && (
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
                        caseItem.mode === CaseBillingMode.FlatFee
                          ? []
                          : workspaceState.periods.filter(
                              (period) =>
                                period.caseId === String(caseItem.id) &&
                                period.billable &&
                                !period.excluded &&
                                period.billingStatus === BillingStatus.Unbilled,
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
                          <span className={`bar-amount${metrics.toBill === 0 ? " case-zero" : ""}`}>
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
                                {caseItem.mode === CaseBillingMode.FlatFee
                                  ? caseBillingModeLabels[CaseBillingMode.FlatFee]
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
}
