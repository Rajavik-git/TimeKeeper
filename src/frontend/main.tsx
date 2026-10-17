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
import { showToast, ToastHost } from "./shared/components/Toast";
import { Logo } from "./shared/brand/Logo";
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
  const [s, setS] = useState<State>();
  const [core, setCore] = useState<CoreState>();
  const [view, setView] = useState<View>(new URLSearchParams(window.location.search).get('view')==='desk'?'desk':'myDay');
  const [sourceId, setSourceId] = useState('');
  const [selectedCase, setSelectedCase] = useState<number>();
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
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
    refresh().catch((e) => showToast(String(e)));
  }, []);
  const action = async <T,>(
    promise: Promise<{ data?: T; error?: unknown }>,
  ): Promise<T | undefined> => {
    try {
      const r = await promise;
      if (r.error)
        throw Error(
          typeof r.error === "object" && r.error && "message" in r.error
            ? String(r.error.message)
            : JSON.stringify(r.error),
        );
      await refresh();
      return r.data;
    } catch (e) {
      showToast(String(e));
      return undefined;
    }
  };
  const navigate = (v: View, matterId?: number) => {
    if (view === 'source' && v === 'myDay' && sourceId) setReturnFocusId(sourceId);
    if (matterId) setSelectedCase(matterId);
    else if (v === 'matters' || v === 'preInvoices') setSelectedCase(undefined);
    setView(v);
    if(v==='desk') window.history.replaceState(null,'','?view=desk');
    else if(window.location.search.includes('view=desk')) window.history.replaceState(null,'',window.location.pathname);
    document.querySelector(".shell-main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };
  const source = (id: string) => {
    setSourceId(id);
    setReturnFocusId(null);
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
  const pending = core?.periods.filter(p=>p.startedAt.startsWith(today) && !p.excluded && !p.timeValidated).length ?? 0;
  return (
    <div className="app floating-shell">
      <div className="shell-main">
        <header className="floating-nav">
          <Logo compact />
          <nav className="floating-tabs" aria-label="Screens">
            {primaryViews.map(([key,title,icon]) => <button key={key} aria-current={view===key?'page':undefined} aria-label={title} onClick={()=>navigate(key)}>
              <Icon name={icon}/><span className="tab-label">{title}</span>
              {key==='myDay'&&<span className="cnt">{pending}</span>}
              {key==='matters'&&<span className="cnt">{s?.matter.length??0}</span>}
            </button>)}
          </nav>
          <div className="floating-tools">
            <span className="session-chip" title={core?.activeSession?`Started from Screenpipe at ${core.activeSession.startedAt.slice(11,16)}. Closing TimeKeeper keeps the session open.`:'Start from Screenpipe to begin a session.'}>
              <span className="live" aria-hidden="true"/>{core?.activeSession?`Session since ${core.activeSession.startedAt.slice(11,16)}`:'No active session'}
            </span>
            <ThemeSwitch />
          </div>
        </header>
        <ToastHost />
        <main id="main" className="page">
          {!props ? (
            <p>Loading local data…</p>
          ) : view === "desk" ? (
            <Desk {...props} />
          ) : view === "myDay" ? (
            <MyDay {...props} returnFocusId={returnFocusId} onFocusReturned={() => setReturnFocusId(null)} />
          ) : view === "matters" ? (
            <Cases {...props} />
          ) : view === "preInvoices" ? (
            <PreInvoices {...props} />
          ) : view === "source" ? (
            <Source {...props} selected={sourceId} />
          ) : (
            <Settings {...props} />
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
