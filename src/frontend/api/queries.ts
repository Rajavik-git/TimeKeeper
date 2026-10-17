import { systemTimeZone } from "../../shared/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CoreState } from "./client";
import { Resource, type ResourceState } from "./resource";

const refreshers = new Set<() => Promise<void>>();
export async function refreshApplication() {
  await Promise.all([...refreshers].map((refresh) => refresh()));
}

/** Fetch lifecycle shared by the application, filtered views, and the pill. */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  pollInterval = 5000,
) {
  const loader = useRef(load);
  loader.current = load;
  const [snapshot, setSnapshot] = useState<{ key: string; state: ResourceState<T> }>();
  const resource = useMemo(
    () =>
      new Resource<T>(
        (signal) => loader.current(signal),
        (state) => setSnapshot({ key, state }),
      ),
    [key],
  );
  useEffect(() => {
    const refresh = () => resource.refresh();
    refreshers.add(refresh);
    void refresh().catch(() => undefined);
    const resume = () => {
      if (document.visibilityState !== "hidden") void resource.poll().catch(() => undefined);
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = pollInterval ? window.setInterval(resume, pollInterval) : undefined;
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      refreshers.delete(refresh);
      window.clearInterval(timer);
      resource.dispose();
    };
  }, [resource, pollInterval]);
  const state = snapshot?.key === key ? snapshot.state : resource.state;
  return {
    ...state,
    isError: state.error !== null,
    refetch: () => resource.refresh().catch(() => undefined),
  };
}

export function requireData<T>(result: { data?: T; error?: unknown }): T {
  if (result.error || result.data === undefined) throw Error("Local data could not be loaded.");
  return result.data;
}

export async function loadApplication(signal: AbortSignal) {
  const [
    catalog,
    active,
    sessions,
    periods,
    sources,
    questions,
    billing,
    auditEvents,
    coverageGaps,
  ] = await Promise.all([
    api.GET("/api/catalog", { signal }),
    api.GET("/api/sessions/active", { signal }),
    api.GET("/api/sessions", { signal }),
    api.GET("/api/work-periods", { signal, params: { query: { timeZone: systemTimeZone() } } }),
    api.GET("/api/sources", { signal }),
    api.GET("/api/questions", { signal, params: { query: { timeZone: systemTimeZone() } } }),
    api.GET("/api/billing/state", { signal }),
    api.GET("/api/audit-events", { signal }),
    api.GET("/api/coverage-gaps", { signal, params: { query: { timeZone: systemTimeZone() } } }),
  ]);
  const workspaceState: CoreState = {
    activeSession: requireData(active),
    sessions: requireData(sessions),
    periods: requireData(periods),
    sources: requireData(sources),
    questions: requireData(questions),
    coverageGaps: requireData(coverageGaps),
    billing: requireData(billing),
    auditEvents: requireData(auditEvents),
  };
  return { catalogState: requireData(catalog), workspaceState };
}
