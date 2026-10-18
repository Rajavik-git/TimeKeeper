import { isBudgetWarning, budgetWarningMessage } from "../../../../calculations/case-budget";
import { budgetPercent } from "../../../../shared/presentation/budget";
import { caseBillingModeLabels } from "../../../../shared/presentation/catalog";
import { rateOriginLabels } from "../../../../shared/presentation/billing";
import { MarkerType } from "../../../../../contracts/states.generated";
import { CaseBillingMode } from "../../../../../contracts/states.generated";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sameId, type Case, type Client, type ScreenProps } from "../../../../api/client";
import { caseMetrics } from "../../../../calculations/cases";
import { formatRoundedMinutes } from "../../../../calculations/billing";
import { money as formatMoney, rate as displayRate, shortDate } from "../../../../shared/format";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";
import { CaseStats } from "../CaseStats/CaseStats";
import { CaseMarkers } from "../CaseMarkers/CaseMarkers";
import { CaseTimeTable } from "../CaseTimeTable/CaseTimeTable";
import { visibleValue } from "../../lib/casePresentation";
import { DownIcon, MoreIcon } from "../CaseIcons/CaseIcons";
type Props = Pick<
  ScreenProps,
  | "catalogState"
  | "workspaceState"
  | "navigate"
  | "refresh"
  | "openPeriodActivity"
  | "openPeriodReview"
> & {
  currentCase: Case;
  currentClient: Client;
  breadcrumb: ReactNode;
  tab: "time" | "markers";
  setTab: (tab: "time" | "markers") => void;
  showNotice: (message: string, undo?: () => void) => void;
  validatingIds: string[];
  validatePeriods: (ids: string[]) => Promise<void>;
  onExport: () => void;
};
export function CaseDetail({
  catalogState,
  workspaceState,
  currentCase,
  currentClient,
  breadcrumb,
  tab,
  setTab,
  showNotice,
  validatingIds,
  validatePeriods,
  onExport,
  navigate,
  refresh,
  openPeriodActivity,
  openPeriodReview,
}: Props) {
  const validating = validatingIds.length > 0;
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const formatRate = (cents: number) => displayRate(cents, catalogState.settings.currency ?? "USD");
  const [showMarkerForm, setShowMarkerForm] = useState(false);
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const caseMenuRef = useRef<HTMLDivElement>(null);
  const [sorts, setSorts] = useState<Record<string, { column: number; direction: 1 | -1 }>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("timekeeper-case-sorts") ?? "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    sessionStorage.setItem("timekeeper-case-sorts", JSON.stringify(sorts));
  }, [sorts]);
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
  const markerTypeOrder: Partial<Record<MarkerType, number>> = {
    [MarkerType.OpposingParty]: 0,
    [MarkerType.CaseNumber]: 1,
    [MarkerType.File]: 2,
    [MarkerType.Email]: 3,
    [MarkerType.Domain]: 4,
    [MarkerType.Keyword]: 5,
  };
  const markers = catalogState.markers
    .filter(
      (item) =>
        sameId(item.caseId, currentCase.id) &&
        item.type !== MarkerType.ClientName &&
        visibleValue(item.value),
    )
    .sort((a, b) =>
      sorting && tab === "markers"
        ? sorting.direction *
          (sorting.column === 1 ? a.type.localeCompare(b.type) : a.value.localeCompare(b.value))
        : (markerTypeOrder[a.type] ?? 9) - (markerTypeOrder[b.type] ?? 9) ||
          a.value.localeCompare(b.value),
    );
  const builtInMarkers: { value: string; type: MarkerType; badge: boolean }[] = [
    {
      value: currentCase.reference.split("-").slice(0, 2).join("-"),
      type: MarkerType.Reference,
      badge: true,
    },
    ...(visibleValue(currentCase.opposingParty) &&
    !markers.some(
      (marker) =>
        marker.value.toLocaleLowerCase() === currentCase.opposingParty.toLocaleLowerCase(),
    )
      ? [{ value: currentCase.opposingParty, type: MarkerType.OpposingParty, badge: false }]
      : []),
  ];
  const clientNameMarker = visibleValue(currentClient.name)
    ? { value: currentClient.name, type: MarkerType.ClientName, badge: false }
    : null;
  if (clientNameMarker) builtInMarkers.push(clientNameMarker);
  const markerCount = builtInMarkers.length + markers.length;
  return (
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
          <button className="btn" onClick={() => showNotice("Case editing is not available yet.")}>
            <Icon name="edit" small />
            Edit case
          </button>
          <div className="case-overflow" ref={caseMenuRef}>
            <button
              type="button"
              className="btn iconbtn case-overflow-trigger"
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
                  className="btn ghost"
                  onClick={() => {
                    setCaseMenuOpen(false);
                    onExport();
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
      {
        <CaseStats
          items={[
            [
              "Time recorded",
              `${formatRoundedMinutes(m.time)}${m.complete ? "" : " · partial"}`,
              `${m.periods.length} periods`,
            ],
            [
              "To bill",
              currentCase.mode === CaseBillingMode.FlatFee
                ? caseBillingModeLabels[CaseBillingMode.FlatFee]
                : money(m.toBill),
              "Before expenses",
            ],
            [
              "Not billable",
              formatRoundedMinutes(m.nonBillable),
              `Value ${money(Math.round((m.nonBillable * m.rate.rateCents) / 60))}`,
            ],
            [
              currentCase.mode === CaseBillingMode.FlatFee
                ? "Estimated work / flat fee"
                : "Budget used",
              m.budgetPercent === null
                ? m.budget !== null && !m.budgetComplete
                  ? "Unavailable"
                  : "—"
                : budgetPercent(m.budgetPercent),
              m.budget !== null
                ? m.spent === null
                  ? "Comparison unavailable · incomplete work value"
                  : `${money(m.spent)} of ${money(m.budget)}${currentCase.mode === CaseBillingMode.FlatFee ? " · estimated hourly work value" : ""}`
                : "No budget set",
            ],
          ]}
        />
      }
      <section className="card case-facts-card">
        <dl className="facts case-facts">
          <div>
            <dt>Pricing</dt>
            <dd>
              {currentCase.mode === CaseBillingMode.FlatFee
                ? `${caseBillingModeLabels[currentCase.mode]} ${money(currentCase.flatFeeCents ?? 0)}`
                : `${formatRate(m.rate.rateCents)} · ${rateOriginLabels[m.rate.origin]}`}
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
            className={`card-b budget${m.budgetPercent >= 100 ? " case-budget-danger" : isBudgetWarning(m.budgetPercent) ? " case-budget-warn" : ""}`}
          >
            <div className="row between">
              <span>
                {currentCase.mode === CaseBillingMode.FlatFee
                  ? "Estimated work / flat fee"
                  : "Budget used"}
              </span>
              <span>
                {m.spent === null ? "Unknown" : money(m.spent)}{" "}
                <span className="case-budget-muted">of {money(m.budget ?? 0)}</span> ·{" "}
                {budgetPercent(m.budgetPercent)}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(m.budgetPercent, 100)}%` }} />
            </div>
            {isBudgetWarning(m.budgetPercent) && (
              <span className="flag">
                <Icon name="alert" small />
                {budgetWarningMessage(currentCase.mode)}
              </span>
            )}
          </div>
        )}
      </section>
      <section className="card cases-fill case-detail-list">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Case sections">
            <button role="tab" aria-selected={tab === "time"} onClick={() => setTab("time")}>
              Time ({m.periods.length})
            </button>
            <button role="tab" aria-selected={tab === "markers"} onClick={() => setTab("markers")}>
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
                    m.periods.filter((period) => !period.timeValidated).map((period) => period.id),
                  )
                }
              >
                {validatingIds.length === m.pending ? "Validating…" : `Validate all (${m.pending})`}
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
          <CaseTimeTable
            catalogState={catalogState}
            caseItem={currentCase}
            periods={m.periods}
            sources={workspaceState.sources}
            rateCents={m.rate.rateCents}
            sorting={sorting}
            onSort={changeSort}
            validatingIds={validatingIds}
            onValidate={validatePeriods}
            openPeriodActivity={openPeriodActivity}
            openPeriodReview={openPeriodReview}
            navigate={navigate}
          />
        ) : (
          <CaseMarkers
            key={currentCase.id}
            currentCase={currentCase}
            markers={markers}
            builtInMarkers={builtInMarkers}
            markerCount={markerCount}
            sortedHeading={sortedHeading}
            showMarkerForm={showMarkerForm}
            setShowMarkerForm={setShowMarkerForm}
            showNotice={showNotice}
            refresh={refresh}
          />
        )}
      </section>
    </>
  );
}
