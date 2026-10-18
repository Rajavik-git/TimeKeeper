import { Logo } from "../../../../shared/components/Logo/Logo";
import type { PillView } from "../../lib/pillView";

type Props = {
  view: PillView;
  expanded: boolean;
  onToggle: () => void;
  onAssign: (caseId: string) => void;
  onOpenDay: () => void;
  onDismiss: () => void;
  notice: string | null;
  error?: string;
};

/** Presentation shared by the Settings preview and native floating window. */
export function WorkPill({
  view,
  expanded,
  onToggle,
  onAssign,
  onOpenDay,
  onDismiss,
  notice,
  error,
}: Props) {
  const notification = (floating: boolean) => (
    <div className={floating ? "pill-floating-notice" : "pill-notice"} role="status">
      <div>
        <strong>Question pending</strong>
        <small>{notice}</small>
      </div>
      <button className="iconbtn sm" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
  return (
    <div className="work-pill">
      <button
        className="pill-bar"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label="TimeKeeper, toggle panel"
      >
        <span className="pill-logo">
          <Logo compact wordmark={false} />
        </span>
        <span className={`status-dot ${view.active ? "" : "paused"}`} />
        <span className="pill-client" title={view.clientLabel}>
          {view.clientLabel}
        </span>
        <strong className="pill-amount" title={view.metricTitle}>
          {view.metricValue}
        </strong>
        {view.pending > 0 && (
          <span
            className="pill-badge"
            aria-label={`${view.pending} period${view.pending === 1 ? "" : "s"} with time to validate`}
          >
            {view.pending}
          </span>
        )}
      </button>
      {expanded && (
        <section className="pill-panel" aria-label="Current work period">
          {view.offline ? (
            <p className="pill-error" role="status">
              Cannot reach TimeKeeper. This panel will reconnect when the application is available.
            </p>
          ) : (
            <>
              <div className="pill-case">
                <strong>{view.caseTitle}</strong>
                <small>{view.active ? "Session active" : "Start from Screenpipe"}</small>
              </div>
              {view.sessionTime && (
                <p className="pill-subtitle">
                  Session since {view.sessionTime} · this period since {view.periodTime}
                </p>
              )}
              <p className="pill-subtitle">
                {view.ownerLabel} · Screenpipe connection not verified
              </p>
              <div className="pill-totals">
                <div>
                  <small>This period</small>
                  <strong>{view.periodDuration}</strong>
                </div>
                <div>
                  <small>Review</small>
                  <strong>{view.pending} pending</strong>
                </div>
              </div>
              <div className="pill-actions">
                <button className="btn sm" disabled title="Screenpipe owns recording">
                  Pause
                </button>
                <button
                  className="btn sm"
                  disabled
                  title="A period boundary requires a confirmed transition"
                >
                  Close period
                </button>
              </div>
              <label className="pill-select">
                Change case
                <select
                  className="select sm"
                  disabled={view.assignmentDisabled}
                  value={view.caseId}
                  onChange={(event) => onAssign(event.target.value)}
                >
                  <option value="" disabled>
                    Choose a case
                  </option>
                  {view.cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn sm primary pill-open" onClick={onOpenDay}>
                Open My day
              </button>
              {notice && notification(false)}
              {error && (
                <p className="pill-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      )}
      {!expanded && notice && notification(true)}
    </div>
  );
}
