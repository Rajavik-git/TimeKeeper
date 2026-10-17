import { calendarDay, calendarTime, systemTimeZone } from "../../../shared/dates";
import { validatePeriods as runValidation, validationMessage } from "../../api/validatePeriods";
import { DayCalendar, monthEnd } from "./DayCalendar";
import {
  buildDayView,
  type DayFilter as Filter,
  type SortState,
  type MainSortKey as MainKey,
  type LeftSortKey as LeftKey,
} from "./dayView";
import { useToday } from "../../shared/hooks/useToday";
import { useResource, requireData } from "../../api/queries";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  api,
  clientForCase,
  caseById,
  money as formatMoney,
  type CoreState,
  type EntityId,
  type ScreenProps,
  type State,
} from "../../api/client";
import {
  dayFees,
  configuredRate,
  effectiveMs,
  formatPreciseDuration,
  formatRoundedMinutes,
  summarizeWork,
} from "../../calculations/billing";
import { CaseSelect } from "../../shared/components/CaseSelect";
import { Kpi } from "../../shared/components/Kpi";
import { Icon } from "../../shared/components/Icon";
import { CaseReference } from "../../shared/components/CaseReference";
import { showToast } from "../../shared/components/Toast";
import { longDate } from "../../shared/format";
import "./MyDay.css";

type DayData = Pick<CoreState, "periods" | "coverageGaps" | "questions"> & {
  date: string;
  state: State;
};
type Period = CoreState["periods"][number];
export type MyDayViewState = {
  selectedDate: string;
  month: string;
  filter: Filter;
  clientFilter: string;
  caseFilter: string;
  mainSort: SortState<MainKey>;
  leftSort: SortState<LeftKey>;
};
export const initialMyDayView = (today: string): MyDayViewState => ({
  selectedDate: today,
  month: today.slice(0, 7),
  filter: "all",
  clientFilter: "",
  caseFilter: "",
  mainSort: null,
  leftSort: null,
});

const sortNext = <Key extends string>(
  current: SortState<Key>,
  key: Key,
  numeric: boolean,
): SortState<Key> => ({
  key,
  direction:
    current?.key === key && current.direction === "ascending"
      ? "descending"
      : current?.key === key && current.direction === "descending"
        ? "ascending"
        : numeric
          ? "descending"
          : "ascending",
});
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

function SortHeader<Key extends string>({
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

export function MyDay({
  catalogState,
  workspaceState,
  action,
  openPeriodActivity,
  refresh,
  navigate,
  returnFocusId,
  onFocusReturned,
  viewState,
  setViewState,
  openPeriodReview,
}: ScreenProps & {
  returnFocusId?: string | null;
  onFocusReturned?: () => void;
  viewState: MyDayViewState;
  setViewState: Dispatch<SetStateAction<MyDayViewState>>;
}) {
  const today = useToday();
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");

  const { selectedDate, month, filter, mainSort, leftSort, clientFilter, caseFilter } = viewState;
  const setSelectedDate = (date: string) =>
    setViewState((current) => ({
      ...current,
      selectedDate: date,
      month: date.slice(0, 7),
      filter: "all",
    }));
  const setMonth = useCallback(
    (value: string) =>
      setViewState((current) => (current.month === value ? current : { ...current, month: value })),
    [setViewState],
  );
  const setFilter = (value: Filter) => setViewState((current) => ({ ...current, filter: value }));
  const setClientFilter = (value: string) =>
    setViewState((current) => ({ ...current, clientFilter: value }));
  const setCaseFilter = (value: string) =>
    setViewState((current) => ({ ...current, caseFilter: value }));

  const pendingDays = new Set(
    workspaceState.periods
      .filter(
        (period) =>
          !period.excluded && !period.timeValidated && calendarDay(period.startedAt) <= today,
      )
      .map((period) => calendarDay(period.startedAt)),
  );

  const [editing, setEditing] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [minutes, setMinutes] = useState("");
  const [durationSaving, setDurationSaving] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [recentlyAssigned, setRecentlyAssigned] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterWrap = useRef<HTMLDivElement>(null);
  const [answerCase, setAnswerCase] = useState<EntityId | null>(null);
  const [validating, setValidating] = useState(false);
  const [focusQuestionAfterValidation, setFocusQuestionAfterValidation] = useState(false);
  const [answering, setAnswering] = useState(false);
  const questionCard = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  useEffect(() => {
    if (!validating && focusQuestionAfterValidation) {
      questionCard.current?.focus();
      setFocusQuestionAfterValidation(false);
    }
  }, [validating, focusQuestionAfterValidation]);
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
  const changeMainSort = (key: MainKey, numeric: boolean) =>
    setViewState((current) => ({ ...current, mainSort: sortNext(current.mainSort, key, numeric) }));
  const changeLeftSort = (key: LeftKey, numeric: boolean) =>
    setViewState((current) => ({ ...current, leftSort: sortNext(current.leftSort, key, numeric) }));
  const dayQuery = useResource(`day:${selectedDate}`, async (signal): Promise<DayData> => {
    const [state, periods, coverageGaps, questions] = await Promise.all([
      api.GET("/api/catalog", { signal }),
      api.GET("/api/work-periods", {
        signal,
        params: { query: { date: selectedDate, timeZone: systemTimeZone() } },
      }),
      api.GET("/api/coverage-gaps", {
        signal,
        params: { query: { date: selectedDate, timeZone: systemTimeZone() } },
      }),
      api.GET("/api/questions", {
        signal,
        params: { query: { date: selectedDate, timeZone: systemTimeZone() } },
      }),
    ]);
    return {
      date: selectedDate,
      state: requireData(state),
      periods: requireData(periods),
      coverageGaps: requireData(coverageGaps),
      questions: requireData(questions),
    };
  });
  const monthQuery = useResource(`month:${month}`, async (signal) =>
    requireData(
      await api.GET("/api/work-periods", {
        signal,
        params: { query: { from: `${month}-01`, to: monthEnd(month), timeZone: systemTimeZone() } },
      }),
    ),
  );
  const recorded = new Set(
    (monthQuery.data ?? [])
      .filter((period) => !period.excluded)
      .map((period) => calendarDay(period.startedAt)),
  );
  const loadError = dayQuery.error
    ? "Could not refresh this day. Displayed data may be out of date."
    : monthQuery.error
      ? "Could not load the calendar's recorded days."
      : "";
  const data: DayData | null = dayQuery.data ?? null;
  useEffect(() => {
    if (!data || !returnFocusId) return;
    const button = document.querySelector<HTMLButtonElement>(
      `[data-source-period-id="${CSS.escape(returnFocusId)}"]:not(:disabled), [data-review-period-id="${CSS.escape(returnFocusId)}"]`,
    );
    if (!button) return;
    button.focus();
    onFocusReturned?.();
  }, [data, returnFocusId, onFocusReturned]);
  const periods = data?.periods ?? [];
  const coverageGaps = data?.coverageGaps ?? [];
  const {
    included,
    excluded,
    review,
    validated,
    unresolved,
    recognized,
    mainRows,
    leftRows,
    exportedPeriods,
  } = buildDayView({
    periods,
    coverageGaps,
    filter,
    clientFilter,
    caseFilter,
    mainSort,
    leftSort,
    caseDetails: (caseId) => {
      const item = caseById(catalogState, caseId);
      const owner = clientForCase(catalogState, caseId);
      return {
        title: item?.title ?? "",
        clientName: owner?.name ?? "",
        clientId: owner?.id ?? null,
      };
    },
  });
  const summary = summarizeWork(included, workspaceState.sources);
  const fees = dayFees(catalogState, workspaceState, included);
  const notRecordedMs = coverageGaps.reduce(
    (total, gap) => total + Math.max(0, Date.parse(gap.endedAt) - Date.parse(gap.startedAt)),
    0,
  );
  const questionFor = (periodId: string) =>
    data?.questions.find(
      (question) => question.periodId === periodId && question.status === "pending",
    );
  const assign = (periodId: string, caseId: EntityId) => {
    const period = periods.find((item) => item.id === periodId);
    if (!period) return;
    const question = questionFor(periodId);
    if (question)
      return action(
        api.POST("/api/questions/answer", {
          body: {
            questionId: question.questionId,
            sessionId: question.sessionId,
            periodId,
            expectedAssignmentRevision: question.expectedAssignmentRevision,
            caseId: String(caseId),
            responseCommandId: crypto.randomUUID(),
          },
        }),
      );
    return action(
      api.POST("/api/work-periods/{id}/assignment", {
        params: { path: { id: periodId } },
        body: {
          caseId: String(caseId),
          expectedAssignmentRevision: period.assignmentRevision,
          origin: "lawyer",
        },
      }),
    );
  };
  const saveDuration = async (periodId: string) => {
    const parsed = minutes.trim() ? Number(minutes) : NaN;
    const durationMs = Math.round(parsed * 60000);
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      showToast("Enter a non-negative duration in minutes.");
      return;
    }
    setDurationSaving(true);
    const result = await action(
      api.POST("/api/work-periods/{id}/duration-override", {
        params: { path: { id: periodId } },
        body: { durationMs, expectedRevision: editingRevision! },
      }),
    );
    setDurationSaving(false);
    if (result) setEditing(null);
  };
  const validate = async (target: Period[], focusQuestion = false) => {
    if (validating || !target.length) return;
    setValidating(true);
    showToast(`Validating ${target.length} period${target.length === 1 ? "" : "s"}…`);
    try {
      const result = await runValidation(target, refresh);
      showToast(
        validationMessage(result.successful, target.length, result.refreshFailed, result.stale),
      );
      if (focusQuestion && result.successful) setFocusQuestionAfterValidation(true);
    } finally {
      setValidating(false);
    }
  };
  const tabs: [Filter, string, number][] = [
    ["all", "All", included.length],
    ["review", "To validate", review.length],
    ["validated", "Validated", validated.length],
    ["left", "Left out", excluded.length],
  ];
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const update = () =>
      setHasMoreRows(element.scrollTop + element.clientHeight < element.scrollHeight - 2);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    requestAnimationFrame(update);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [filter, data, included.length, excluded.length]);
  const caseRate = (caseId: EntityId | null) => {
    if (!caseId)
      return `base rate ${money(catalogState.settings.globalHourlyRateCents ?? 0).replace(/\.00$/, "")}/h`;
    const { rateCents, origin } = configuredRate(catalogState, caseId);
    if (origin === "flat_fee") return "flat fee";
    const label =
      origin === "matter" ? "case rate" : origin === "client" ? "client rate" : "base rate";
    return `${label} ${money(rateCents).replace(/\.00$/, "")}/h`;
  };
  return (
    <>
      <div className="ph">
        <div className="t">
          <h1>My day</h1>
          <p>
            {longDate(selectedDate).replace(" ", ", ")}
            {selectedDate === today ? " · today" : ""}
          </p>
        </div>
        <div className="actions">
          <DayCalendar
            selected={selectedDate}
            recorded={recorded}
            pending={pendingDays}
            onSelect={setSelectedDate}
            onMonthChange={setMonth}
          />
          <button
            className="btn"
            disabled
            title="Manual time entry is not available yet."
            aria-describedby="manual-time-unavailable"
          >
            <Icon name="plus" small />
            Add a hearing or meeting
          </button>
        </div>
      </div>
      <p id="manual-time-unavailable" className="sr-only">
        Manual time entry is not available yet.
      </p>
      {loadError && (
        <p className="day-load-error" role="alert">
          {loadError}
        </p>
      )}
      <div className="grid4">
        <Kpi
          title="Time today"
          value={
            summary.roundedMinutes ? (
              formatRoundedMinutes(summary.roundedMinutes)
            ) : (
              <span className="zero">—</span>
            )
          }
          detail={
            !data
              ? "Loading time…"
              : !summary.complete
                ? "Partial total · some durations or sources are unavailable"
                : "Worked and recorded, after corrections"
          }
        />
        <Kpi
          title="Fees today"
          value={fees ? money(fees) : <span className="zero">—</span>}
          detail={!summary.complete ? "Partial estimate · before expenses" : "Before expenses"}
        />
        <Kpi
          title="Not recorded"
          value={
            notRecordedMs ? (
              formatRoundedMinutes(Math.ceil(notRecordedMs / 60000))
            ) : (
              <span className="zero">—</span>
            )
          }
          detail={
            coverageGaps.length
              ? `${calendarTime(coverageGaps[0]!.startedAt)}–${calendarTime(coverageGaps[0]!.endedAt)}, not counted`
              : !data
                ? "Coverage not loaded"
                : !summary.complete
                  ? "Coverage incomplete · check periods and sources"
                  : "No known coverage gap"
          }
        />
        <Kpi
          title="To validate"
          value={review.length || <span className="zero">—</span>}
          detail="Periods"
        />
      </div>
      <div className={`day-prompts${unresolved.length ? "" : " day-prompts-single"}`}>
        <section className="card day-ready">
          <div>
            <h2>
              {!included.length
                ? "No work recorded"
                : review.length
                  ? "Your day is ready."
                  : "Day validated"}
            </h2>
            <p>
              {!included.length
                ? "Choose another day to review recorded work."
                : review.length
                  ? recognized.length
                    ? `TimeKeeper recognized ${recognized.length} ${recognized.length === 1 ? "period" : "periods"} on their own. ${unresolved.length ? `${unresolved.length} needs one answer from you.` : "Nothing needs your answer."} Check them below, then validate in one click.`
                    : "Review the periods below and answer any open case question."
                  : `${included.length} periods · ${formatRoundedMinutes(summary.roundedMinutes)} · ${money(fees)}`}
            </p>
          </div>
          {recognized.length > 0 ? (
            <button
              className="btn attn"
              disabled={validating}
              aria-busy={validating}
              onClick={() => void validate(recognized, true)}
            >
              {validating
                ? "Validating…"
                : recognized.length === 1
                  ? "Validate the recognized period"
                  : `Validate the ${recognized.length} recognized periods`}
            </button>
          ) : included.length > 0 && !review.length ? (
            <button className="btn ghost sm" onClick={() => navigate("preInvoices")}>
              View in Billing
            </button>
          ) : null}
        </section>
        {unresolved.length > 0 && (
          <section className="card day-question" ref={questionCard} tabIndex={-1}>
            <div>
              <h2>
                <Icon name="alert" small /> Which case was this?
              </h2>
              {unresolved[0] ? (
                <p>
                  {calendarTime(unresolved[0].startedAt)}–
                  {unresolved[0].endedAt ? calendarTime(unresolved[0].endedAt) : undefined} ·{" "}
                  {unresolved[0].demoWindowTitle ?? unresolved[0].label}
                </p>
              ) : (
                <p>Every period has a case. You can review the list below.</p>
              )}
            </div>
            {unresolved[0] && (
              <div className="row">
                <CaseSelect
                  catalogState={catalogState}
                  value={answerCase}
                  allowEmpty
                  onChange={setAnswerCase}
                />
                <button
                  className="btn primary"
                  aria-disabled={!answerCase}
                  disabled={answering}
                  aria-busy={answering}
                  onClick={async () => {
                    if (!answerCase) {
                      showToast("Choose a case first");
                      return;
                    }
                    setAnswering(true);
                    showToast("Assigning case…");
                    const periodId = unresolved[0]!.id;
                    const result = await assign(periodId, answerCase);
                    setAnswering(false);
                    if (result) {
                      showToast(
                        `Assigned to ${caseById(catalogState, answerCase)?.title ?? "case"}`,
                      );
                      setRecentlyAssigned(periodId);
                      window.setTimeout(
                        () =>
                          setRecentlyAssigned((current) => (current === periodId ? null : current)),
                        600,
                      );
                    } else showToast("Could not assign this case");
                  }}
                >
                  {answering ? "Answering…" : "Answer"}
                </button>
                <button
                  className="btn"
                  disabled={excluding}
                  aria-busy={excluding}
                  onClick={async () => {
                    const periodId = unresolved[0]!.id;
                    setExcluding(true);
                    const result = await action(
                      api.PATCH("/api/work-periods/{id}/details", {
                        params: { path: { id: periodId } },
                        body: { excluded: true, expectedRevision: unresolved[0]!.revision },
                      }),
                    );
                    setExcluding(false);
                    if (result)
                      showToast(
                        "Period left out",
                        "Undo",
                        () =>
                          void action(
                            api.PATCH("/api/work-periods/{id}/details", {
                              params: { path: { id: periodId } },
                              body: { excluded: false, expectedRevision: result.revision },
                            }),
                          ),
                      );
                  }}
                >
                  Not client work
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      <section className="card day-periods">
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Work periods filter">
            {tabs.map(([key, title, count]) => (
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {title}
                <span className="c">{count}</span>
              </button>
            ))}
          </div>
          <div className="right">
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
                      {catalogState.clients.map((item) => (
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
                      {catalogState.cases
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
            <button
              className="btn ghost sm"
              onClick={() => {
                const rows = exportedPeriods.map((period) => [
                  selectedDate,
                  `${calendarTime(period.startedAt)}–${(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}`,
                  clientForCase(catalogState, period.caseId)?.name ?? "",
                  caseById(catalogState, period.caseId)?.title ?? "",
                  period.label,
                  formatPreciseDuration(effectiveMs(period)),
                  period.excluded ? "Left out" : period.timeValidated ? "Validated" : "To validate",
                ]);
                const csv =
                  "\uFEFF" +
                  [
                    ["Date", "Period", "Client", "Case", "Work performed", "Duration", "Status"],
                    ...rows,
                  ]
                    .map((row) => row.map(csvCell).join(","))
                    .join("\r\n");
                const link = document.createElement("a");
                link.href = URL.createObjectURL(
                  new Blob([csv], { type: "text/csv;charset=utf-8" }),
                );
                link.download = `timekeeper-${selectedDate}.csv`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                showToast("Day exported");
              }}
            >
              <Icon name="down" small />
              Export
            </button>
          </div>
        </div>
        {!data && !loadError ? (
          <div className="empty" role="status">
            <b>Loading day…</b>
          </div>
        ) : filter === "left" ? (
          <div className="tbl" ref={tableRef} data-has-more={hasMoreRows}>
            <table>
              <thead>
                <tr>
                  <SortHeader
                    label="Time"
                    sort={leftSort}
                    sortKey="time"
                    numeric
                    onSort={changeLeftSort}
                  />
                  <SortHeader
                    label="Application"
                    sort={leftSort}
                    sortKey="application"
                    onSort={changeLeftSort}
                  />
                  <SortHeader
                    label="Work observed"
                    sort={leftSort}
                    sortKey="work"
                    onSort={changeLeftSort}
                  />
                  <SortHeader
                    label="Duration"
                    sort={leftSort}
                    sortKey="duration"
                    numeric
                    className="r"
                    onSort={changeLeftSort}
                  />
                  <th scope="col" className="r">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {leftRows.map((period) => (
                  <tr key={period.id}>
                    <td className="num">
                      {calendarTime(period.startedAt)}–
                      {(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}
                    </td>
                    <td>{period.demoApp ?? "—"}</td>
                    <td>{period.demoWindowTitle ?? period.label}</td>
                    <td className="r num">{formatPreciseDuration(effectiveMs(period))}</td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() =>
                          void action(
                            api.PATCH("/api/work-periods/{id}/details", {
                              params: { path: { id: period.id } },
                              body: { excluded: false, expectedRevision: period.revision },
                            }),
                          )
                        }
                      >
                        Count as work
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!leftRows.length && (
              <div className="empty">
                <b>No matching periods left out</b>
                <button
                  className="btn sm"
                  onClick={() => {
                    setFilter("all");
                    setClientFilter("");
                    setCaseFilter("");
                  }}
                >
                  Show all periods
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="tbl day-table" ref={tableRef} data-has-more={hasMoreRows}>
            <table>
              <thead>
                <tr>
                  <SortHeader
                    label="Period"
                    sort={mainSort}
                    sortKey="period"
                    numeric
                    onSort={changeMainSort}
                  />
                  <SortHeader
                    label="Client · case"
                    sort={mainSort}
                    sortKey="case"
                    onSort={changeMainSort}
                  />
                  <SortHeader
                    label="Work performed"
                    sort={mainSort}
                    sortKey="work"
                    onSort={changeMainSort}
                  />
                  <SortHeader
                    label="Duration"
                    sort={mainSort}
                    sortKey="duration"
                    numeric
                    className="r"
                    onSort={changeMainSort}
                  />
                  <th scope="col" className="r">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {mainRows.map((row) => {
                  if (row.kind === "gap")
                    return (
                      <tr className="gap-row" key={row.gap.id}>
                        <td className="num muted">
                          {calendarTime(row.gap.startedAt)}–{calendarTime(row.gap.endedAt)}
                        </td>
                        <td colSpan={4}>
                          <span className="flag">
                            <Icon name="alert" small />
                            Coverage gap
                          </span>{" "}
                          <span className="muted">
                            · no recording for{" "}
                            {Math.round(
                              (Date.parse(row.gap.endedAt) - Date.parse(row.gap.startedAt)) / 60000,
                            )}{" "}
                            min. Not counted as work, not counted as idle.
                          </span>
                          <button
                            className="btn sm gap-add"
                            disabled
                            title="Manual time entry is not available yet."
                            aria-describedby="manual-time-unavailable"
                          >
                            Add time
                          </button>
                        </td>
                      </tr>
                    );
                  const period = row.period;
                  const caseId = period.caseId ? period.caseId : null;
                  const item = caseById(catalogState, caseId),
                    owner = clientForCase(catalogState, caseId);
                  const linked = workspaceState.sources.filter(
                    (record) => record.workPeriodId === period.id,
                  );
                  return (
                    <tr
                      key={period.id}
                      className={recentlyAssigned === period.id ? "recently-assigned" : undefined}
                    >
                      <td className="num">
                        {calendarTime(period.startedAt)}–
                        {(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}
                        <span className="sub">{period.demoApp ?? "Application unavailable"}</span>
                      </td>
                      <td>
                        {item ? (
                          <>
                            <span className="day-client" title={owner?.name}>
                              {owner?.name}
                            </span>
                            <span className="sub" title={`${item.title} · ${item.reference}`}>
                              {item.title} · <CaseReference value={item.reference} />
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="flag">
                              <Icon name="alert" small />
                              Unresolved
                            </span>
                            <span className="sub">Waiting for your answer above</span>
                          </>
                        )}
                      </td>
                      <td className="wrap">
                        {period.label}
                        <span className="sub">
                          {catalogState.taskTypes.find((task) => task.id === period.taskTypeId)
                            ?.label ?? "Work period"}{" "}
                          · {caseRate(caseId)}
                        </span>
                      </td>
                      <td className="r num">
                        {editing === period.id ? (
                          <span className="row">
                            <input
                              className="field"
                              type="number"
                              min="0"
                              step="0.001"
                              aria-label="Corrected minutes"
                              value={minutes}
                              onChange={(event) => setMinutes(event.target.value)}
                            />
                            <button
                              className="btn sm primary"
                              disabled={durationSaving}
                              aria-busy={durationSaving}
                              onClick={() => void saveDuration(period.id)}
                            >
                              Save
                            </button>
                            <button
                              className="btn sm"
                              disabled={durationSaving}
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className={`day-duration${period.durationOverrideMs !== null ? " corrected" : ""}`}
                            disabled={period.billingStatus === "billed"}
                            aria-label={`Correct duration for ${period.label}`}
                            title="Correct duration"
                            onClick={() => {
                              setEditing(period.id);
                              setEditingRevision(period.revision);
                              setMinutes(String((effectiveMs(period) ?? 0) / 60000));
                            }}
                          >
                            {formatPreciseDuration(effectiveMs(period))}
                            <Icon name="edit" small />
                          </button>
                        )}
                        {period.durationOverrideMs !== null && (
                          <span className="sub">
                            was {formatPreciseDuration(period.detectedDurationMs)}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="day-actions">
                          {openPeriodReview && (
                            <button
                              className="btn sm"
                              data-review-period-id={period.id}
                              onClick={() => openPeriodReview(period.id)}
                            >
                              Review
                            </button>
                          )}
                          {period.timeValidated ? (
                            <span className="day-validated">✓ Validated</span>
                          ) : period.caseId ? (
                            <button
                              className="btn sm attn"
                              disabled={validating}
                              aria-busy={validating}
                              onClick={() => void validate([period])}
                            >
                              Validate
                            </button>
                          ) : null}
                          <button
                            className="btn sm"
                            data-source-period-id={period.id}
                            disabled={!linked.length}
                            onClick={() => openPeriodActivity(period.id)}
                          >
                            Sources
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!mainRows.length && (
              <div className="empty">
                <b>
                  {!included.length && !coverageGaps.length
                    ? "No work recorded"
                    : "No matching periods"}
                </b>
                <p>
                  {!included.length && !coverageGaps.length
                    ? "Nothing was recorded on this day."
                    : "Adjust the filters or choose another day."}
                </p>
                {included.length > 0 && (
                  <button
                    className="btn sm"
                    disabled
                    title="Manual time entry is not available yet."
                    aria-describedby="manual-time-unavailable"
                  >
                    Add a hearing or meeting
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
