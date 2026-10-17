import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, today, type State, type CoreState, type View } from "./api/client";
import { Desk } from "./features/desk/Desk";
import { MyDay } from "./features/workday/MyDay";
import { Cases } from "./features/cases/Cases";
import { PreInvoices } from "./features/billing-status/PreInvoices";
import { Source } from "./features/workday/Source";
import { Settings } from "./features/settings/Settings";
import { ThemeSwitch, restoreTheme } from "./shared/components/ThemeSwitch";
import { Icon } from "./shared/components/Icon";
import "./shared/theme.css";

restoreTheme();
const primaryViews = [
  ["myDay", "My day", "day", "1"],
  ["matters", "Cases", "cases", "2"],
  ["preInvoices", "Pre-invoices", "pre", "3"],
  ["source", "Source", "source", "4"],
] as const;
const workspaceViews = [
  ["settings", "Settings", "settings"],
  ["desk", "Desk pill", "desk"],
] as const;

function App() {
  const [s, setS] = useState<State>();
  const [core, setCore] = useState<CoreState>();
  const [view, setView] = useState<View>("myDay");
  const [sourceId, setSourceId] = useState('');
  const [selectedCase, setSelectedCase] = useState<number>();
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const [legacy, active, sessions, periods, sources, questions, billing, coverageGaps] = await Promise.all([
      api.GET('/api/state'), api.GET('/api/sessions/active'), api.GET('/api/sessions'),
      api.GET('/api/work-periods'), api.GET('/api/sources'), api.GET('/api/questions'),api.GET('/api/billing/state'),api.GET('/api/coverage-gaps'),
    ]);
    for (const response of [legacy,active,sessions,periods,sources,questions,billing,coverageGaps])
      if (response.error) throw Error(JSON.stringify(response.error));
    setS(legacy.data);
    setCore({activeSession:active.data ?? null,sessions:sessions.data ?? [],periods:periods.data ?? [],
      sources:sources.data ?? [],questions:questions.data ?? [],coverageGaps:coverageGaps.data ?? [],billing:billing.data ?? {invoices:[],lines:[],expenses:[]}});
  };
  useEffect(() => {
    refresh().catch((e) => setMessage(String(e)));
  }, []);
  const action = async <T,>(
    promise: Promise<{ data?: T; error?: unknown }>,
  ): Promise<T | undefined> => {
    try {
      const r = await promise;
      if (r.error)
        throw Error(
          typeof r.error === "object" && r.error && "error" in r.error
            ? String(r.error.error)
            : JSON.stringify(r.error),
        );
      await refresh();
      return r.data;
    } catch (e) {
      setMessage(String(e));
      return undefined;
    }
  };
  const navigate = (v: View, matterId?: number) => {
    if (matterId) setSelectedCase(matterId);
    setView(v);
    document.querySelector(".shell-main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };
  const source = (id: string) => {
    setSourceId(id);
    navigate("source");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
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
  }, []);
  const props = s && core
    ? { s, core, refresh, action, navigate, source, selectedCase }
    : undefined;
  const lawyer = s?.firm[0]?.lawyer_name ?? "TimeKeepr";
  const initials = lawyer
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const pending = core?.periods.filter(p=>p.startedAt.startsWith(today) && !p.excluded && !p.timeValidated).length ?? 0;
  const activePeriod = core?.periods.find(p=>p.sessionId === core.activeSession?.id && p.endedAt === null);
  const currentCase = s?.matter.find(m=>String(m.id) === activePeriod?.caseId);
  const viewName =
    [...primaryViews, ...workspaceViews].find(
      (item) => item[0] === view,
    )?.[1] ?? "My day";
  return (
    <div className="app">
      <aside className="shell-side">
        <div className="ws">
          <span className="logo" aria-hidden="true">
            T
          </span>
          <span className="t">
            <b>TimeKeepr</b>
            <span>{lawyer}</span>
          </span>
        </div>
        <nav className="nav" aria-label="Screens">
          {primaryViews.map(([key, title, icon, shortcut]) => (
            <button
              key={key}
              aria-current={view === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <Icon name={icon} />
              <span>{title}</span>
              {key === "myDay" && <span className="cnt">{pending}</span>}
              {key === "matters" && (
                <span className="cnt">{s?.matter.length ?? 0}</span>
              )}
              {key !== "myDay" && key !== "matters" && <kbd>{shortcut}</kbd>}
            </button>
          ))}
          <div className="sect">Workspace</div>
          {workspaceViews.map(([key, title, icon]) => (
            <button
              key={key}
              aria-current={view === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <Icon name={icon} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <div className="shell-bottom">
          <div className="capture">
            <div className="row1">
              <span className="live" aria-hidden="true" />
              {core?.activeSession ? 'Session active' : 'No active session'}
            </div>
            <p>{core?.activeSession ? `Started from Screenpipe at ${core.activeSession.startedAt.slice(11,16)}. Closing TimeKeepr keeps it open.` : 'Start from Screenpipe to begin a session.'}</p>
            {core?.activeSession&&<p className="num tiny">session {core.activeSession.id} · revision {core.activeSession.revision}{currentCase?` · ${currentCase.reference}`:''}</p>}
            <button
              className="btn sm"
              disabled
              title="Capture control is unavailable"
            >
              Pause capture
            </button>
          </div>
          <ThemeSwitch />
          <div className="user">
            <span className="avatar">{initials}</span>
            <span className="t">
              {lawyer}
              <span>Attorney at law</span>
            </span>
            <Icon name="more" small />
          </div>
        </div>
      </aside>
      <div className="shell-main">
        <header className="top">
          <div className="crumbs">
            <b>{viewName}</b>
          </div>
          <div className="right">
            <button className="cmdk" disabled title="Search is unavailable">
              <Icon name="search" small />
              <span>Search or jump to…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="iconbtn"
              disabled
              aria-label="Help"
              title="Help is unavailable"
            >
              <Icon name="help" />
            </button>
          </div>
        </header>
        {message && (
          <div className="toast" role="status" onClick={() => setMessage("")}>
            {message} ×
          </div>
        )}
        <div className="page">
          {!props ? (
            <p>Loading local data…</p>
          ) : view === "desk" ? (
            <Desk {...props} />
          ) : view === "myDay" ? (
            <MyDay {...props} />
          ) : view === "matters" ? (
            <Cases {...props} />
          ) : view === "preInvoices" ? (
            <PreInvoices {...props} />
          ) : view === "source" ? (
            <Source {...props} selected={sourceId} />
          ) : (
            <Settings {...props} />
          )}
          <footer className="tiny muted">
            Fictional demo data · everything stays on this device ·{" "}
            <button
              className="link"
              onClick={async () => {
                if (confirm("Reset the demo?"))
                  await action(api.POST("/api/demo/reset"));
              }}
            >
              Reset demo
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
