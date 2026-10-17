import { calendarTime } from "../shared/dates";
import { useToday } from "./shared/hooks/useToday";
import { performAction } from "./api/actions";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type View, type EntityId } from "./api/client";
import { loadApplication, useResource, refreshApplication } from "./api/queries";
import { Desk } from "./features/desk/Desk";
import { MyDay } from "./features/workday/MyDay";
import { Cases } from "./features/cases/Cases";
import { PreInvoices } from "./features/billing-status/PreInvoices";
import { PeriodActivity } from "./features/workday/PeriodActivity";
import { Settings } from "./features/settings/Settings";
import { ThemeSwitch, restoreTheme } from "./shared/components/ThemeSwitch";
import { Icon } from "./shared/components/Icon";
import { showToast, ToastHost } from "./shared/components/Toast";
import { Logo } from "./shared/brand/Logo";
import { fitViewport } from "./shared/fitViewport";
import "./shared/theme.css";

restoreTheme();
const primaryViews = [
  ["myDay", "My day", "day", "1"],
  ["matters", "Cases", "cases", "2"],
  ["preInvoices", "Billing", "pre", "3"],
  ["source", "Activity", "source", "4"],
  ["settings", "Settings", "settings", "5"],
] as const;

function App() {
  const today = useToday();
  const application = useResource("application", loadApplication, 5000);
  const catalogState = application.data?.catalogState;
  const workspaceState = application.data?.workspaceState;
  const [view, setView] = useState<View>(
    new URLSearchParams(window.location.search).get("view") === "desk" ? "desk" : "myDay",
  );
  const [activityPeriodId, setActivityPeriodId] = useState("");
  const [selectedCase, setSelectedCase] = useState<EntityId>();
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const refresh = refreshApplication;
  const action = <T,>(promise: Promise<{ data?: T; error?: unknown }>) =>
    performAction(promise, refresh, showToast);
  const navigate = useCallback(
    (v: View, caseId?: EntityId) => {
      if (view === "source" && v === "myDay" && activityPeriodId)
        setReturnFocusId(activityPeriodId);
      if (caseId) setSelectedCase(caseId);
      else if (v === "matters" || v === "preInvoices") setSelectedCase(undefined);
      setView(v);
      if (v === "desk") window.history.replaceState(null, "", "?view=desk");
      else if (window.location.search.includes("view=desk"))
        window.history.replaceState(null, "", window.location.pathname);
      document.querySelector(".shell-main")?.scrollTo(0, 0);
      window.scrollTo(0, 0);
    },
    [view, activityPeriodId],
  );
  const openPeriodActivity = (periodId: string) => {
    setActivityPeriodId(periodId);
    setReturnFocusId(null);
    navigate("source");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target instanceof HTMLElement && event.target.closest("dialog[open]")) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      const next = primaryViews.find((item) => item[3] === event.key);
      if (next) navigate(next[0]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
  const props =
    catalogState && workspaceState
      ? {
          catalogState,
          workspaceState,
          refresh,
          action,
          navigate,
          openPeriodActivity,
          selectedCase,
        }
      : undefined;
  const pending =
    workspaceState?.periods.filter(
      (p) => p.startedAt.startsWith(today) && !p.excluded && !p.timeValidated,
    ).length ?? 0;
  return (
    <div className="app floating-shell">
      <div className="shell-main">
        <header className="floating-nav">
          <Logo compact />
          <nav className="floating-tabs" aria-label="Screens">
            {primaryViews.map(([key, title, icon]) => (
              <button
                key={key}
                aria-current={view === key ? "page" : undefined}
                aria-label={title}
                onClick={() => navigate(key)}
              >
                <Icon name={icon} />
                <span className="tab-label">{title}</span>
                {key === "myDay" && <span className="cnt">{pending}</span>}
                {key === "matters" && (
                  <span className="cnt">{catalogState?.cases.length ?? 0}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="floating-tools">
            <span
              className="session-chip"
              title={
                workspaceState?.activeSession
                  ? `Started from Screenpipe at ${calendarTime(workspaceState.activeSession.startedAt)}. Closing TimeKeeper keeps the session open.`
                  : "Start from Screenpipe to begin a session."
              }
            >
              <span className="live" aria-hidden="true" />
              {workspaceState?.activeSession
                ? `Session since ${calendarTime(workspaceState.activeSession.startedAt)}`
                : "No active session"}
            </span>
            <ThemeSwitch />
          </div>
        </header>
        <ToastHost />
        <main id="main" className="page">
          {props && application.isError && (
            <p role="alert">
              Could not refresh local data. Displayed data may be out of date.{" "}
              <button className="btn" onClick={() => void application.refetch()}>
                Refresh
              </button>
            </p>
          )}
          {!props ? (
            <p role={application.isError ? "alert" : "status"}>
              {application.isError ? "Could not load local data." : "Loading local data…"}
              {application.isError && (
                <button className="btn" onClick={() => void application.refetch()}>
                  Retry
                </button>
              )}
            </p>
          ) : view === "desk" ? (
            <Desk {...props} />
          ) : view === "myDay" ? (
            <MyDay
              {...props}
              returnFocusId={returnFocusId}
              onFocusReturned={() => setReturnFocusId(null)}
            />
          ) : view === "matters" ? (
            <Cases {...props} />
          ) : view === "preInvoices" ? (
            <PreInvoices {...props} />
          ) : view === "source" ? (
            <PeriodActivity {...props} selected={activityPeriodId} />
          ) : (
            <Settings {...props} />
          )}
        </main>
      </div>
    </div>
  );
}

fitViewport();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
