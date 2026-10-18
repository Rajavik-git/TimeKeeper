import { calendarDay, calendarTime } from "../shared/dates";
import { useToday } from "./shared/hooks/useToday";
import { performAction } from "./api/actions";
import { useCallback, useEffect, useState } from "react";
import { api, type CoreState, type View, type EntityId, type ScreenProps } from "./api/client";
import {
  loadApplication,
  loadCatalog,
  requireData,
  useResource,
  refreshApplication,
} from "./api/queries";
import { Desk } from "./features/desk/Desk";
import { useDayResources } from "./features/workday/hooks/useDayResources";
import { useDesktopNavigation } from "./shared/hooks/useDesktopNavigation";
import { MyDay, initialMyDayView } from "./features/workday/MyDay";
import { Cases, type CasesNavigation } from "./features/cases/Cases";
import { PreInvoices } from "./features/billing-status/PreInvoices";
import { PeriodActivity } from "./features/workday/PeriodActivity";
import { PeriodReviewDialog } from "./features/workday/components/PeriodReviewDialog/PeriodReviewDialog";
import { Settings } from "./features/settings/Settings";
import { ThemeSwitch } from "./shared/components/ThemeSwitch/ThemeSwitch";
import { Icon } from "./shared/components/Icon/Icon";
import { showToast, ToastHost } from "./shared/components/Toast/Toast";
import { Modal } from "./shared/components/Modal/Modal";
import { Logo } from "./shared/components/Logo/Logo";

const primaryViews = [
  ["myDay", "My day", "day", "1"],
  ["matters", "Cases", "cases", "2"],
  ["preInvoices", "Billing", "pre", "3"],
  ["source", "Activity", "source", "4"],
  ["settings", "Settings", "settings", "5"],
] as const;

export function App() {
  const today = useToday();
  const [myDayView, setMyDayView] = useState(() => initialMyDayView(today));
  const [casesNavigation, setCasesNavigation] = useState<CasesNavigation>({
    clientId: null,
    caseId: null,
    tab: "time",
  });
  const [billingSelection, setBillingSelection] = useState<EntityId | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState<string | null>(null);
  const [reviewPeriodId, setReviewPeriodId] = useState<string | null>(null);
  const [reviewSource, setReviewSource] = useState<"day" | "application">("application");
  const [view, setView] = useState<View>(
    new URLSearchParams(window.location.search).get("view") === "desk" ? "desk" : "myDay",
  );
  const application = useResource(
    "application",
    loadApplication,
    5000,
    (view !== "settings" && view !== "myDay") ||
      (reviewPeriodId !== null && reviewSource === "application"),
  );
  const dayResources = useDayResources(
    myDayView.selectedDate,
    myDayView.month,
    view === "myDay" || (reviewPeriodId !== null && reviewSource === "day"),
  );
  const catalog = useResource("catalog", loadCatalog, 0, view === "settings" || view === "myDay");
  const audit = useResource(
    "audit",
    async (signal) => requireData(await api.GET("/api/audit-events", { signal })),
    0,
    view === "source",
  );
  const conflicts = useResource(
    "conflicts",
    async (signal) => requireData(await api.GET("/api/reconstruction-conflicts", { signal })),
    0,
    reviewPeriodId !== null,
  );
  const activeSession = useResource(
    "active-session",
    async (signal) => requireData(await api.GET("/api/sessions/active", { signal })),
    5000,
  );
  const day = dayResources.data;
  const daySnapshot = day ? { catalogState: day.state, workspaceState: day } : undefined;
  const screenSnapshot = view === "myDay" ? daySnapshot : application.data;
  const catalogState =
    screenSnapshot?.catalogState ?? (view === "myDay" ? catalog.data : undefined);
  const withReviewData = (core: Omit<CoreState, "auditEvents">): CoreState => ({
    ...core,
    auditEvents: audit.data ?? [],
    auditUnavailable: !audit.data || audit.isError,
    reconstructionConflicts: conflicts.data,
    reconstructionUnavailable: !conflicts.data || conflicts.isError,
  });
  const emptyDayState: CoreState = {
    activeSession: activeSession.data ?? null,
    sessions: [],
    periods: [],
    sources: [],
    questions: [],
    coverageGaps: [],
    billing: { invoices: [], lines: [], expenses: [] },
    auditEvents: [],
  };
  const workspaceState = screenSnapshot
    ? withReviewData(screenSnapshot.workspaceState)
    : view === "myDay" && catalogState
      ? emptyDayState
      : undefined;
  const reviewSnapshot = reviewSource === "day" ? daySnapshot : application.data;
  const reviewWorkspace = reviewSnapshot
    ? withReviewData(reviewSnapshot.workspaceState)
    : undefined;
  const [activityOrigin, setActivityOrigin] = useState<{
    view: View;
    caseId?: EntityId;
    label: string;
  }>({ view: "myDay", label: "My day" });
  const [activityPeriodId, setActivityPeriodId] = useState("");
  const [selectedCase, setSelectedCase] = useState<EntityId>();
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const refresh = refreshApplication;
  const action: ScreenProps["action"] = (promise, notify = showToast) =>
    performAction(promise, refresh, notify);
  const navigate = useCallback(
    (v: View, caseId?: EntityId) => {
      if (view === "source" && v !== "source" && activityPeriodId)
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
  useDesktopNavigation(() => navigate("myDay"));
  const openPeriodActivity = (periodId: string) => {
    if (view !== "source")
      setActivityOrigin({
        view,
        caseId:
          view === "matters"
            ? (casesNavigation.caseId ?? undefined)
            : view === "preInvoices"
              ? (billingSelection ?? undefined)
              : selectedCase,
        label: primaryViews.find((item) => item[0] === view)?.[1] ?? "My day",
      });
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
      if (next) {
        if (next[0] === "source") setActivityPeriodId("");
        navigate(next[0]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
  useEffect(() => {
    if (!returnFocusId || (view !== "matters" && view !== "preInvoices")) return;
    const timer = window.requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>("[data-work-period-id]")].find(
        (item) => item.dataset.workPeriodId === returnFocusId,
      );
      const target = row?.querySelector<HTMLElement>("button") ?? row;
      if (target) {
        target.focus({ preventScroll: true });
        setReturnFocusId(null);
      }
    });
    return () => window.cancelAnimationFrame(timer);
  }, [view, returnFocusId, casesNavigation, billingSelection, application.data]);
  const openPeriodReview = (id: string) => {
    if (reviewDirty && reviewPeriodId && id !== reviewPeriodId) {
      setPendingReviewId(id);
      return;
    }
    setReviewSource(view === "myDay" ? "day" : "application");
    setReviewPeriodId(id);
    if (view === "source") navigate(activityOrigin.view, activityOrigin.caseId);
  };
  const commonProps = {
    refresh,
    action,
    navigate,
    openPeriodActivity,
    selectedCase,
    openPeriodReview,
  };
  const props =
    catalogState && workspaceState ? { ...commonProps, catalogState, workspaceState } : undefined;
  const pendingPeriods =
    myDayView.month === today.slice(0, 7)
      ? (dayResources.monthQuery.data ?? application.data?.workspaceState.periods)
      : application.data?.workspaceState.periods;
  const pending = pendingPeriods?.filter(
    (p) => calendarDay(p.startedAt) === today && !p.excluded && !p.timeValidated,
  ).length;
  const reviewPeriod = reviewWorkspace?.periods.find((item) => item.id === reviewPeriodId);
  const reviewProps =
    reviewSnapshot && reviewWorkspace
      ? {
          ...commonProps,
          catalogState: reviewSnapshot.catalogState,
          workspaceState: reviewWorkspace,
        }
      : undefined;
  const initialLoadFailed =
    view === "myDay" ? catalog.isError || dayResources.dayQuery.isError : application.isError;
  const retryInitialLoad = () =>
    view === "myDay"
      ? Promise.all([catalog.refetch(), dayResources.dayQuery.refetch()])
      : application.refetch();
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
                onClick={() => {
                  if (key === "source") setActivityPeriodId("");
                  navigate(key);
                }}
              >
                <Icon name={icon} />
                <span className="tab-label">{title}</span>
                {key === "myDay" && <span className="cnt">{pending ?? "—"}</span>}
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
                activeSession.data
                  ? `Started from Screenpipe at ${calendarTime(activeSession.data.startedAt)}. Closing TimeKeeper keeps the session open.`
                  : "Start from Screenpipe to begin a session."
              }
            >
              <span className="live" aria-hidden="true" />
              {activeSession.data
                ? `Session since ${calendarTime(activeSession.data.startedAt)}`
                : activeSession.isError || activeSession.data === undefined
                  ? "Session status unavailable"
                  : "No active session"}
            </span>
            <ThemeSwitch />
          </div>
        </header>
        <ToastHost />
        <main id="main" className={`page${view === "settings" ? " settings-page" : ""}`}>
          {view !== "myDay" && props && application.isError && (
            <p role="alert">
              Could not refresh local data. Displayed data may be out of date.{" "}
              <button className="btn" onClick={() => void application.refetch()}>
                Refresh
              </button>
            </p>
          )}
          {view === "settings" ? (
            catalog.data ? (
              <>
                <Settings catalogState={catalog.data} action={action} navigate={navigate} />
                {catalog.isError && (
                  <p role="alert">
                    Could not refresh settings. Displayed values may be out of date.
                  </p>
                )}
              </>
            ) : (
              <p role={catalog.isError ? "alert" : "status"}>
                {catalog.isError ? "Could not load settings." : "Loading settings…"}
                <button className="btn" onClick={() => void catalog.refetch()}>
                  Retry
                </button>
              </p>
            )
          ) : !props ? (
            <p role={initialLoadFailed ? "alert" : "status"}>
              {initialLoadFailed ? "Could not load local data." : "Loading local data…"}
              {initialLoadFailed && (
                <button className="btn" onClick={() => void retryInitialLoad()}>
                  Retry
                </button>
              )}
            </p>
          ) : view === "desk" ? (
            <Desk {...props} />
          ) : view === "myDay" ? (
            <MyDay
              {...props}
              viewState={myDayView}
              setViewState={setMyDayView}
              returnFocusId={returnFocusId}
              onFocusReturned={() => setReturnFocusId(null)}
              resources={dayResources}
            />
          ) : view === "matters" ? (
            <Cases
              {...props}
              navigationState={casesNavigation}
              setNavigationState={setCasesNavigation}
            />
          ) : view === "preInvoices" ? (
            <PreInvoices
              {...props}
              selection={billingSelection}
              setSelection={setBillingSelection}
            />
          ) : view === "source" ? (
            <PeriodActivity
              {...props}
              selected={activityPeriodId}
              returnLabel={activityOrigin.label}
              returnToOrigin={() => {
                navigate(activityOrigin.view, activityOrigin.caseId);
              }}
            />
          ) : (
            <Settings {...props} />
          )}
        </main>
        {pendingReviewId && (
          <Modal label="Unsaved period corrections" close={() => setPendingReviewId(null)}>
            <div className="modal">
              <h2>Unsaved period corrections</h2>
              <p>
                Your previous period has unsaved corrections. Resume it or discard its corrections
                before reviewing another period.
              </p>
              <button
                className="btn"
                onClick={() => {
                  setPendingReviewId(null);
                  navigate(activityOrigin.view, activityOrigin.caseId);
                }}
              >
                Resume previous review
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReviewSource("application");
                  setReviewPeriodId(pendingReviewId);
                  setReviewDirty(false);
                  setPendingReviewId(null);
                  navigate(activityOrigin.view, activityOrigin.caseId);
                }}
              >
                Discard and review selected period
              </button>
              <button className="btn" onClick={() => setPendingReviewId(null)}>
                Keep reviewing sources
              </button>
            </div>
          </Modal>
        )}
        {reviewProps &&
          reviewPeriodId &&
          (reviewPeriod ? (
            <PeriodReviewDialog
              key={reviewPeriod.id}
              {...reviewProps}
              period={reviewPeriod}
              hidden={view === "source"}
              onDraftChange={setReviewDirty}
              close={() => {
                setReviewPeriodId(null);
                setReviewDirty(false);
              }}
            />
          ) : (
            <p role="alert">
              This period is no longer available.{" "}
              <button className="btn" onClick={() => setReviewPeriodId(null)}>
                Close review
              </button>
            </p>
          ))}
      </div>
    </div>
  );
}
