import { timeValidationUnavailable } from "../../shared/lib/timeValidation";
import { csvCell } from "../../../shared/csv";
import { PageHeader } from "../../shared/components/PageHeader/PageHeader";
import { rateOriginLabels } from "../../shared/presentation/billing";
import { timeValidationLabels } from "../../shared/presentation/work-period";
import { LeftOutPeriods } from "./components/LeftOutPeriods/LeftOutPeriods";
import { DaySortHeader } from "./components/DaySortHeader/DaySortHeader";
import { DayFilters } from "./components/DayFilters/DayFilters";
import { DayCaseQuestion } from "./components/DayCaseQuestion/DayCaseQuestion";
import { DayPeriodRow } from "./components/DayPeriodRow/DayPeriodRow";
import { useDayCommands } from "./hooks/useDayCommands";
import { BillingStatus, RateOrigin, ValidationStatus } from "../../../contracts/states.generated";
import { useDayResources } from "./hooks/useDayResources";
import { calendarTime } from "../../../shared/dates";
import { DayCalendar } from "./components/DayCalendar/DayCalendar";
import {
  buildDayView,
  type DayFilter as Filter,
  type SortState,
  type MainSortKey as MainKey,
  type LeftSortKey as LeftKey,
} from "./lib/dayView";
import { useToday } from "../../shared/hooks/useToday";
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
  type ScreenProps,
} from "../../api/client";
import {
  dayFees,
  configuredRate,
  effectiveMs,
  formatNearestMinuteDuration,
  formatRoundedMinutes,
  summarizeWork,
  type Period,
} from "../../calculations/billing";
import { Kpi } from "../../shared/components/Kpi/Kpi";
import { Icon } from "../../shared/components/Icon/Icon";
import { showToast } from "../../shared/components/Toast/Toast";
import { longDate, rate as formatRate } from "../../shared/format";

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
  resources,
}: ScreenProps & {
  resources?: ReturnType<typeof useDayResources>;
  returnFocusId?: string | null;
  onFocusReturned?: () => void;
  viewState: MyDayViewState;
  setViewState: Dispatch<SetStateAction<MyDayViewState>>;
}) {
  const today = useToday();

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

  const [recentlyAssigned, setRecentlyAssigned] = useState<string | null>(null);
  const [focusQuestionAfterValidation, setFocusQuestionAfterValidation] = useState(false);
  const questionCard = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  const changeMainSort = (key: MainKey, numeric: boolean) =>
    setViewState((current) => ({ ...current, mainSort: sortNext(current.mainSort, key, numeric) }));
  const changeLeftSort = (key: LeftKey, numeric: boolean) =>
    setViewState((current) => ({ ...current, leftSort: sortNext(current.leftSort, key, numeric) }));
  const localResources = useDayResources(selectedDate, month, !resources);
  const { data, recorded, pending, dayQuery, monthQuery } = resources ?? localResources;
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
    assignedToValidate,
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
  const summary = summarizeWork(included, data?.sources ?? workspaceState.sources);
  const fees = dayFees(data?.state ?? catalogState, included);
  const feeValue =
    fees.cents !== null && fees.currency ? formatMoney(fees.cents, fees.currency) : null;
  const feeDetail = !data
    ? "Estimate unavailable"
    : !fees.complete
      ? fees.currency && fees.knownCents > 0
        ? `Incomplete estimate · ${formatMoney(fees.knownCents, fees.currency)} known; some pricing is unavailable`
        : "Estimate unavailable · some pricing or currencies cannot be combined"
      : "Hourly estimate · excludes flat fees and expenses";
  const completed = Boolean(data && included.length && !review.length);
  const coverageGapMs = coverageGaps.reduce(
    (total, gap) => total + Math.max(0, Date.parse(gap.endedAt) - Date.parse(gap.startedAt)),
    0,
  );
  const eligibleToValidate = assignedToValidate.filter(
    (period) => timeValidationUnavailable(period, today) === null,
  );
  const { assign, validate, validating } = useDayCommands({
    data,
    action,
    refresh,
    onValidatedQuestion: () => setFocusQuestionAfterValidation(true),
  });
  useEffect(() => {
    if (!validating && focusQuestionAfterValidation) {
      questionCard.current?.focus();
      setFocusQuestionAfterValidation(false);
    }
  }, [validating, focusQuestionAfterValidation]);
  const tabs: [Filter, string, number][] = [
    ["all", "All", included.length],
    ["review", timeValidationLabels[ValidationStatus.Unvalidated], review.length],
    ["validated", timeValidationLabels[ValidationStatus.Validated], validated.length],
    ["left", "Excluded from totals", excluded.length],
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
  const caseRate = (period: Period) => {
    if (period.billingStatus === BillingStatus.Billed) {
      if (period.appliedHourlyRateCents == null || !period.appliedCurrency)
        return "Historical rate unavailable";
      return `Applied ${formatRate(period.appliedHourlyRateCents, period.appliedCurrency)}`;
    }
    const caseId = period.caseId;
    if (!caseId)
      return `${rateOriginLabels[RateOrigin.Base]} ${formatRate(catalogState.settings.globalHourlyRateCents, catalogState.settings.currency)}`;
    const { rateCents, origin } = configuredRate(catalogState, caseId);
    if (origin === RateOrigin.FlatFee) return rateOriginLabels[origin];
    const label = rateOriginLabels[origin];
    return `${label} ${formatRate(rateCents, catalogState.settings.currency)}`;
  };
  return (
    <>
      <PageHeader
        className="ph"
        title={<>My day</>}
        description={
          <>
            {longDate(selectedDate).replace(" ", ", ")}
            {selectedDate === today ? " · today" : ""}
          </>
        }
        actions={
          <div className="actions">
            <DayCalendar
              selected={selectedDate}
              recorded={recorded}
              pending={pending}
              indicatorsAvailable={Boolean(monthQuery.data)}
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
        }
      />
      <p id="manual-time-unavailable" className="sr-only">
        Manual time entry is not available yet.
      </p>
      {dayQuery.error && (
        <p className="day-load-error" role="alert">
          {data
            ? "Could not refresh this day. Displayed data may be out of date."
            : "Could not load this day. Work periods and totals are unavailable."}{" "}
          <button className="btn sm" onClick={() => void dayQuery.refetch()}>
            Retry day
          </button>
        </p>
      )}
      {monthQuery.error && (
        <p className="day-load-error" role="alert">
          {monthQuery.data
            ? "Could not refresh the calendar. Its day indicators may be out of date."
            : "Could not load the calendar's work-day indicators."}{" "}
          <button className="btn sm" onClick={() => void monthQuery.refetch()}>
            Retry calendar
          </button>
        </p>
      )}
      <div className="grid4">
        <Kpi
          title="Recorded time"
          value={
            summary.roundedMinutes ? (
              formatRoundedMinutes(summary.roundedMinutes)
            ) : (
              <span className="zero">—</span>
            )
          }
          detail={
            !data
              ? dayQuery.error
                ? "Time unavailable"
                : "Loading time…"
              : !summary.complete
                ? "Partial total · some durations or sources are unavailable"
                : "Included work periods, after corrections"
          }
        />
        <Kpi
          title="Estimated fees"
          value={data && feeValue ? feeValue : <span className="zero">—</span>}
          detail={feeDetail}
        />
        <Kpi
          title="Coverage gaps"
          value={
            coverageGapMs ? (
              formatRoundedMinutes(Math.ceil(coverageGapMs / 60000))
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
          title={timeValidationLabels[ValidationStatus.Unvalidated]}
          value={review.length || <span className="zero">—</span>}
          detail={!data ? "Work periods unavailable" : "Work periods"}
        />
      </div>
      <div className={`day-prompts${unresolved.length ? "" : " day-prompts-single"}`}>
        <section className={`card day-ready${completed ? " day-complete" : ""}`}>
          <div>
            <h2>
              {!data
                ? dayQuery.error
                  ? "Day unavailable"
                  : "Loading day…"
                : !included.length
                  ? "No included work periods"
                  : review.length
                    ? "Review time for this day"
                    : "Time validated for this day"}
            </h2>
            <p>
              {!data
                ? dayQuery.error
                  ? "Retry to load work periods and totals."
                  : "Loading work periods and totals."
                : !included.length
                  ? "Choose another day or check periods excluded from totals."
                  : review.length
                    ? assignedToValidate.length
                      ? `${assignedToValidate.length} assigned ${assignedToValidate.length === 1 ? "period needs" : "periods need"} time validation. ${unresolved.length ? `${unresolved.length} ${unresolved.length === 1 ? "period needs" : "periods need"} a case assignment.` : "Nothing needs your answer."} Review them below, then validate their time.`
                      : "Review the periods below and answer any open case question."
                    : `${included.length} ${included.length === 1 ? "period" : "periods"} · ${formatRoundedMinutes(summary.roundedMinutes)} · ${feeValue ?? "fees unavailable"}`}
            </p>
          </div>
          {assignedToValidate.length > 0 ? (
            <button
              className="btn attn"
              disabled={validating || !eligibleToValidate.length}
              title={
                eligibleToValidate.length > 0
                  ? undefined
                  : "Only finished periods from past local calendar days can be validated."
              }
              aria-busy={validating}
              onClick={() => void validate(eligibleToValidate, true)}
            >
              {validating
                ? "Validating…"
                : eligibleToValidate.length === 1
                  ? "Validate assigned time"
                  : `Validate time for ${eligibleToValidate.length} eligible periods`}
            </button>
          ) : included.length > 0 && !review.length ? (
            <button className="btn ghost sm" onClick={() => navigate("preInvoices")}>
              View in Billing
            </button>
          ) : null}
        </section>
        {unresolved[0] && (
          <DayCaseQuestion
            key={unresolved[0].id}
            period={unresolved[0]}
            sectionRef={questionCard}
            catalogState={catalogState}
            action={action}
            assign={assign}
            onAssigned={(periodId) => {
              setRecentlyAssigned(periodId);
              window.setTimeout(
                () => setRecentlyAssigned((current) => (current === periodId ? null : current)),
                600,
              );
            }}
          />
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
            <DayFilters
              clients={catalogState.clients}
              cases={catalogState.cases}
              clientFilter={clientFilter}
              caseFilter={caseFilter}
              setClientFilter={setClientFilter}
              setCaseFilter={setCaseFilter}
            />
            <button
              className="btn ghost sm"
              onClick={() => {
                const rows = exportedPeriods.map((period) => [
                  selectedDate,
                  `${calendarTime(period.startedAt)}–${(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}`,
                  clientForCase(catalogState, period.caseId)?.name ?? "",
                  caseById(catalogState, period.caseId)?.title ?? "",
                  period.label,
                  formatNearestMinuteDuration(effectiveMs(period)),
                  period.excluded
                    ? "Excluded from totals"
                    : timeValidationLabels[
                        period.timeValidated
                          ? ValidationStatus.Validated
                          : ValidationStatus.Unvalidated
                      ],
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
        {!data ? (
          <div className="empty" role={dayQuery.error ? undefined : "status"}>
            <b>{dayQuery.error ? "Work periods unavailable" : "Loading work periods…"}</b>
          </div>
        ) : filter === "left" ? (
          <LeftOutPeriods
            periods={leftRows}
            sort={leftSort}
            onSort={changeLeftSort}
            tableRef={tableRef}
            hasMoreRows={hasMoreRows}
            onRestore={(period) =>
              action(
                api.PATCH("/api/work-periods/{id}/details", {
                  params: { path: { id: period.id } },
                  body: { excluded: false, expectedRevision: period.revision },
                }),
              )
            }
            onShowAll={() => {
              setFilter("all");
              setClientFilter("");
              setCaseFilter("");
            }}
          />
        ) : (
          <div className="tbl day-table" ref={tableRef} data-has-more={hasMoreRows}>
            <table className="data-table">
              <thead>
                <tr>
                  <DaySortHeader
                    label="Period"
                    sort={mainSort}
                    sortKey="period"
                    numeric
                    onSort={changeMainSort}
                  />
                  <DaySortHeader
                    label="Client · case"
                    sort={mainSort}
                    sortKey="case"
                    onSort={changeMainSort}
                  />
                  <DaySortHeader
                    label="Work performed"
                    sort={mainSort}
                    sortKey="work"
                    onSort={changeMainSort}
                  />
                  <DaySortHeader
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
                            · coverage gap for{" "}
                            {Math.round(
                              (Date.parse(row.gap.endedAt) - Date.parse(row.gap.startedAt)) / 60000,
                            )}{" "}
                            min. Excluded from work totals. This does not establish inactivity.
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
                  const item = caseById(catalogState, period.caseId);
                  return (
                    <DayPeriodRow
                      key={period.id}
                      period={period}
                      item={item}
                      clientName={clientForCase(catalogState, period.caseId)?.name}
                      taskLabel={
                        catalogState.taskTypes.find((task) => task.id === period.taskTypeId)
                          ?.label ?? "Work period"
                      }
                      rateLabel={caseRate(period)}
                      sourceCount={
                        (data?.sources ?? workspaceState.sources).filter(
                          (source) => source.workPeriodId === period.id,
                        ).length
                      }
                      highlighted={recentlyAssigned === period.id}
                      validating={validating}
                      onValidate={() => validate([period])}
                      openPeriodReview={
                        openPeriodReview ? () => openPeriodReview(period.id) : undefined
                      }
                      openPeriodActivity={() => openPeriodActivity(period.id)}
                    />
                  );
                })}
              </tbody>
            </table>
            {!mainRows.length && (
              <div className="empty">
                <b>
                  {!included.length && !coverageGaps.length
                    ? "No work periods"
                    : "No matching periods"}
                </b>
                <p>
                  {!included.length && !coverageGaps.length
                    ? "No included work periods are available for this day."
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
