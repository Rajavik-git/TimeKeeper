import { calendarTime } from "../../../../shared/dates";
import { loadApplication, useResource, refreshApplication } from "../../../api/queries";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../../api/client";
import { effectiveMs, formatPreciseDuration } from "../../../calculations/billing";
import { configuredRate } from "../../../calculations/billing";
import { money } from "../../../shared/format";
import { Logo } from "../../../shared/brand/Logo";
import "./pill.css";

const tauri = "__TAURI_INTERNALS__" in window;
function Pill() {
  const application = useResource("pill", loadApplication, 5000);
  const state = application.data?.catalogState;
  const workspaceState = application.data?.workspaceState;
  const offline = application.isError;
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const refresh = refreshApplication;
  const active = workspaceState?.activeSession;
  const current = workspaceState?.periods.find(
    (p) => p.sessionId === active?.id && p.endedAt === null,
  );
  const item = state?.cases.find((m) => String(m.id) === current?.caseId);
  const owner = item ? state?.clients.find((c) => String(c.id) === String(item.clientId)) : null;
  const setting = state?.settings;
  const alwaysOnTop = setting?.pillAlwaysOnTop;
  const durationMs = current ? effectiveMs(current) : null;
  const hourlyRate = state && item ? configuredRate(state, item.id) : null;
  const amount =
    durationMs !== null &&
    durationMs !== undefined &&
    hourlyRate &&
    hourlyRate.origin !== "flat_fee"
      ? money(
          Math.round((durationMs * hourlyRate.rateCents) / 3600000),
          current?.appliedCurrency ?? state?.settings.currency ?? "USD",
        )
      : "—";
  useEffect(() => {
    if (tauri && alwaysOnTop !== undefined)
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => setError("Unable to apply pill position"));
  }, [alwaysOnTop]);
  const pending =
    workspaceState?.periods.filter(
      (p) => p.sessionId === active?.id && !p.excluded && !p.timeValidated,
    ).length ?? 0;
  const question = workspaceState?.questions.find(
    (q) => q.sessionId === active?.id && q.status === "pending",
  );
  const duringCall = Boolean(current && /call|phone|video/i.test(current.label));
  const notice =
    setting?.notifications && question && !dismissed && (!setting.pillWithholdCalls || !duringCall)
      ? "A period needs a case answer"
      : null;
  useEffect(() => {
    if (tauri)
      void invoke("set_pill_expanded", { expanded, notification: Boolean(notice && !expanded) });
  }, [expanded, notice]);
  const toggle = async () => {
    const next = !expanded;
    if (tauri)
      try {
        await invoke("set_pill_expanded", {
          expanded: next,
          notification: Boolean(notice && !next),
        });
      } catch {
        setError("Unable to resize the pill");
        return;
      }
    setExpanded(next);
  };
  const openDay = () => {
    if (tauri) void invoke("open_my_day").catch(() => setError("Unable to open TimeKeeper"));
    else window.open("/", "_blank");
  };
  const assign = async (caseId: string) => {
    if (!current) return;
    const targetQuestion = workspaceState?.questions.find(
      (q) => q.periodId === current.id && q.status === "pending",
    );
    const response = targetQuestion
      ? await api.POST("/api/questions/answer", {
          body: {
            questionId: targetQuestion.questionId,
            sessionId: targetQuestion.sessionId,
            periodId: current.id,
            expectedAssignmentRevision: targetQuestion.expectedAssignmentRevision,
            caseId,
            responseCommandId: crypto.randomUUID(),
          },
        })
      : await api.POST("/api/work-periods/{id}/assignment", {
          params: { path: { id: current.id } },
          body: {
            caseId,
            expectedAssignmentRevision: current.assignmentRevision,
            origin: "lawyer",
          },
        });
    if (response.error) setError(JSON.stringify(response.error));
    else {
      try {
        await refresh();
      } catch {
        setError("Saved. Displayed data could not refresh.");
      }
    }
  };
  return (
    <main className="pill-root">
      <button
        className="pill-bar"
        onClick={() => void toggle()}
        aria-expanded={expanded}
        aria-label="TimeKeeper, toggle panel"
      >
        <span className="pill-logo">
          <Logo compact wordmark={false} />
        </span>
        <span className={`status-dot ${active ? "" : "paused"}`} />
        <span className="pill-client">
          {offline
            ? "Server not running"
            : active
              ? (owner?.name ?? "Session active")
              : "No active session"}
        </span>
        <strong className="pill-amount">
          {offline
            ? "—"
            : setting?.pillDisplay === "case"
              ? ""
              : setting?.pillDisplay === "time"
                ? current
                  ? formatPreciseDuration(effectiveMs(current))
                  : "—"
                : amount}
        </strong>
        {pending > 0 && (
          <span className="pill-badge" aria-label={`${pending} periods to validate`}>
            {pending}
          </span>
        )}
      </button>
      {expanded && (
        <section className="pill-panel" aria-label="Current work period">
          {offline ? (
            <p className="pill-error" role="status">
              Server not running. Start the local API and this panel will reconnect.
            </p>
          ) : (
            <>
              <div className="pill-case">
                <strong>{active ? (item?.title ?? "No current case") : "No active session"}</strong>
                <small>{active ? `Session ${active.id}` : "Start from Screenpipe"}</small>
                {active && (
                  <small>
                    Session since {calendarTime(active.startedAt)} · this period since{" "}
                    {current ? calendarTime(current.startedAt) : "—"}
                  </small>
                )}
              </div>
              <p className="pill-subtitle">
                {owner?.name ?? "Unassigned"} · Screenpipe connection not verified
              </p>
              <div className="pill-totals">
                <div>
                  <small>This period</small>
                  <strong>
                    {current ? formatPreciseDuration(effectiveMs(current)) : "Unknown"}
                  </strong>
                </div>
                <div>
                  <small>Review</small>
                  <strong>{pending} pending</strong>
                </div>
              </div>
              <div className="pill-actions">
                <button disabled title="Screenpipe owns recording">
                  Pause
                </button>
                <button disabled title="A period boundary requires a confirmed transition">
                  Close period
                </button>
              </div>
              <label className="pill-select">
                Other case
                <select
                  disabled={!current || current.billingStatus === "billed"}
                  value={current?.caseId ?? ""}
                  onChange={(event) => void assign(event.target.value)}
                >
                  <option value="" disabled>
                    Choose a case
                  </option>
                  {state?.cases
                    .filter((m) => m.status === "active")
                    .map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.title}
                      </option>
                    ))}
                </select>
              </label>
              <button className="pill-open" onClick={openDay}>
                Open my day
              </button>
              {notice && (
                <div className="pill-notice" role="status">
                  <div>
                    <strong>Question pending</strong>
                    <small>{notice}</small>
                  </div>
                  <button aria-label="Dismiss notification" onClick={() => setDismissed(true)}>
                    ×
                  </button>
                </div>
              )}
              {error && (
                <p className="pill-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      )}
      {!expanded && notice && (
        <div className="pill-floating-notice" role="status">
          <div>
            <strong>Question pending</strong>
            <small>{notice}</small>
          </div>
          <button aria-label="Dismiss notification" onClick={() => setDismissed(true)}>
            ×
          </button>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Pill />);
