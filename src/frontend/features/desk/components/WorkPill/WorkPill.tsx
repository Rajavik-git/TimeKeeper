import { calendarTime } from "../../../../../shared/dates";
import { Logo } from "../../../../shared/components/Logo/Logo";
import { rate } from "../../../../shared/format";
import { effectiveMs, formatNearestMinuteDuration } from "../../../../calculations/billing";
import { timeValidationUnavailable } from "../../../../shared/lib/timeValidation";
import { rateOriginLabels } from "../../../../shared/presentation/billing";
import type { usePillController } from "../../hooks/usePillController";
export function WorkPill({
  native,
  above,
  rootStyle,
  beginDrag,
  dragMove,
  endDrag,
  dragKey,
  moveBy,
  offline,
  togglePanel,
  expanded,
  active,
  feedback,
  owner,
  caseItem,
  setting,
  barValue,
  pending,
  busy,
  undo,
  hourlyRate,
  currency,
  current,
  periodMs,
  amount,
  todayAmount,
  readyPending,
  today,
  validate,
  showQuestion,
  questionPeriod,
  selectedCase,
  setSelectedCase,
  assign,
  error,
  excludeQuestion,
  openDay,
  openCases,
  recent,
  recentPeriod,
  dismiss,
  showQuestionNotice,
  caseById,
}: ReturnType<typeof usePillController>) {
  const time = (value: string | null | undefined) => (value ? calendarTime(value) : "…");
  const caseOptions = openCases.map((item) => (
    <option key={item.id} value={item.id}>
      {item.title}
    </option>
  ));
  const questionSelect = (
    <>
      <select
        aria-label="Choose a case for this period"
        value={selectedCase}
        disabled={busy}
        onChange={(event) => {
          setSelectedCase(event.target.value);
          if (event.target.value && questionPeriod)
            void assign(questionPeriod.id, event.target.value);
        }}
      >
        <option value="">Choose a case</option>
        {caseOptions}
      </select>
      {selectedCase && error && questionPeriod && (
        <button
          className="pill-button action"
          disabled={busy}
          onClick={() => void assign(questionPeriod.id, selectedCase)}
        >
          Retry assignment
        </button>
      )}
    </>
  );
  const barLabel = feedback?.showText
    ? feedback.text
    : (caseItem?.title ?? (active ? "Which case?" : "No active session"));

  return (
    <main
      className={"pill-root" + (above ? (native ? " native-above" : " browser-above") : "")}
      style={rootStyle}
    >
      <div className={"pill-bar" + (offline ? " offline" : "")}>
        <span
          className="pill-drag"
          role="button"
          tabIndex={0}
          aria-label="Move pill"
          title="Drag to move · double-click to reset · Alt+arrows to move"
          onPointerDown={beginDrag}
          onPointerMove={dragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => moveBy(0, 0, true)}
          onKeyDown={dragKey}
        >
          <span className="pill-mark">
            <Logo compact wordmark={false} />
          </span>
        </span>
        <button
          className="pill-main"
          onClick={togglePanel}
          aria-expanded={expanded}
          aria-label={offline ? "TimeKeeper disconnected, retry" : "TimeKeeper, toggle panel"}
        >
          {offline ? (
            <>
              <span className="pill-who">TimeKeeper is not running</span>
              <span className="pill-retry">Retry</span>
            </>
          ) : (
            <>
              <span className={"pill-rec" + (!active ? " paused" : "")} />
              <span
                className={"pill-who" + (feedback?.showText ? " confirming" : "")}
                title={
                  feedback?.showText
                    ? feedback.text
                    : owner && caseItem
                      ? `${owner.name} · ${caseItem.title}`
                      : undefined
                }
              >
                {barLabel}
              </span>
              {!feedback?.showText && setting?.pillDisplay !== "case" && barValue !== "—" && (
                <strong className="pill-amount">{barValue}</strong>
              )}
              {!feedback?.showText && pending.length > 0 && (
                <span className="pill-badge" aria-label={`${pending.length} periods to validate`}>
                  {pending.length}
                </span>
              )}
            </>
          )}
        </button>
        {feedback?.undoToken && (
          <button
            className="pill-undo"
            disabled={busy}
            onClick={() => void undo()}
            aria-label="Undo last choice"
            title="Undo last choice"
          >
            Undo
          </button>
        )}
        {!offline && (
          <button
            className="pill-chevron"
            onClick={togglePanel}
            aria-label="Toggle pill panel"
            title="Toggle panel"
          >
            ⌄
          </button>
        )}
      </div>
      {expanded && !offline && (
        <section className="pill-panel" aria-label="TimeKeeper panel">
          <header>
            <div className="pill-heading">
              <strong>{caseItem?.title ?? (active ? "Which case?" : "No active session")}</strong>
              <span>{caseItem?.reference ?? ""}</span>
            </div>
            <small>
              {owner?.name ?? "Unassigned"}
              {hourlyRate && hourlyRate.origin !== "flat_fee"
                ? ` · ${rateOriginLabels[hourlyRate.origin]} ${rate(hourlyRate.rateCents, currency)}`
                : ""}
            </small>
            <small>
              Session since {active ? calendarTime(active.startedAt) : "—"} · this period since{" "}
              {current ? calendarTime(current.startedAt) : "—"}
            </small>
          </header>
          <div className="pill-kpis">
            <div>
              <small>This period</small>
              <strong>{formatNearestMinuteDuration(periodMs)}</strong>
            </div>
            <div>
              <small>Amount</small>
              <strong>{amount}</strong>
            </div>
            <div>
              <small>Today</small>
              <strong>{todayAmount}</strong>
            </div>
          </div>
          <div className="pill-review">
            <div className="pill-row">
              <small>To validate · {pending.length}</small>
            </div>
            {pending.slice(0, 2).map((period) => (
              <div className="pill-row" key={period.id}>
                <div>
                  <strong>{period.label || caseById(period.caseId)?.title || "Which case?"}</strong>
                  <small>
                    {time(period.startedAt)}–{time(period.endedAt)} ·{" "}
                    {formatNearestMinuteDuration(effectiveMs(period))}
                  </small>
                </div>
                {period.caseId && (
                  <button
                    className="pill-button action"
                    disabled={busy || timeValidationUnavailable(period, today) !== null}
                    title={timeValidationUnavailable(period, today) ?? undefined}
                    onClick={() => void validate([period])}
                  >
                    Validate
                  </button>
                )}
              </div>
            ))}
            {(pending.length > 2 || readyPending.length > 0) && (
              <div className="pill-row">
                <small>
                  {pending.length > 2
                    ? `+ ${pending.length - 2} more`
                    : pending.length - readyPending.length > 0
                      ? `${pending.length - readyPending.length} need case or duration`
                      : ""}
                </small>
                {readyPending.length > 0 && (
                  <button
                    className="pill-button action"
                    disabled={busy}
                    title={
                      pending.length > readyPending.length
                        ? `${pending.length - readyPending.length} periods still need a case or duration`
                        : undefined
                    }
                    onClick={() => void validate(readyPending)}
                  >
                    Validate all {readyPending.length}
                  </button>
                )}
              </div>
            )}
          </div>
          {showQuestion && (
            <div className="pill-question">
              <strong>Which case was this? · {questionPeriod?.label}</strong>
              {questionSelect}
              <button
                className="pill-button"
                disabled={busy}
                onClick={() => void excludeQuestion()}
              >
                Not client work
              </button>
            </div>
          )}
          <footer>
            <select
              aria-label="Change case"
              value=""
              disabled={!current || current.billingStatus === "billed" || busy}
              onChange={(event) => void assign(current!.id, event.target.value)}
            >
              <option value="">Change case</option>
              {caseOptions}
            </select>
            <button className="pill-button" onClick={openDay}>
              Open TimeKeeper
            </button>
          </footer>
        </section>
      )}
      {recent && !expanded && !offline && (
        <section className="pill-notice" role="status" aria-label="New work period">
          <button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
          <span className="pill-note-icon">
            <Logo compact wordmark={false} />
          </span>
          <div className="pill-note-body">
            <strong>New period recognized</strong>
            <small>{recent.title} · review the new period in My day</small>
            <div className="pill-note-actions">
              <button
                className="pill-button action"
                disabled={
                  !recentPeriod?.caseId ||
                  !recentPeriod ||
                  timeValidationUnavailable(recentPeriod, today) !== null ||
                  busy
                }
                title={
                  recentPeriod
                    ? (timeValidationUnavailable(recentPeriod, today) ?? undefined)
                    : undefined
                }
                onClick={() => recentPeriod && void validate([recentPeriod])}
              >
                Validate
              </button>
              <select
                aria-label="Change new period case"
                value=""
                disabled={!recentPeriod || busy}
                onChange={(event) => {
                  if (event.target.value) void assign(recent.id, event.target.value);
                }}
              >
                <option value="">Change case…</option>
                {caseOptions}
              </select>
            </div>
            <div className="pill-note-actions">
              <button className="pill-button text" onClick={openDay}>
                Open TimeKeeper
              </button>
              <button className="pill-button text" onClick={dismiss}>
                Later
              </button>
            </div>
          </div>
        </section>
      )}
      {showQuestionNotice && !recent && !expanded && !offline && (
        <section className="pill-notice" role="status" aria-label="Which case">
          <button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
          <span className="pill-note-icon">!</span>
          <div className="pill-note-body">
            <strong>Which case was this?</strong>
            <small>
              {time(questionPeriod?.startedAt)}–{time(questionPeriod?.endedAt)} ·{" "}
              {questionPeriod?.label}
            </small>
            <div className="pill-note-actions">{questionSelect}</div>
            <div className="pill-note-actions">
              <button
                className="pill-button text"
                disabled={busy}
                onClick={() => void excludeQuestion()}
              >
                Not client work
              </button>
              <button className="pill-button text" onClick={dismiss}>
                Later
              </button>
            </div>
          </div>
        </section>
      )}
      {error && (
        <p className="pill-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
