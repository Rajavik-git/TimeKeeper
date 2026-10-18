import { systemTimeZone } from "../../shared/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client";
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
  enabled = true,
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
    if (!enabled) return;
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
  }, [resource, pollInterval, enabled]);
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

export async function loadCatalog(signal: AbortSignal) {
  return requireData(await api.GET("/api/catalog", { signal }));
}

/** Summary inputs share one SQLite read transaction. Auxiliary logs cannot block them. */
export async function loadApplication(signal: AbortSignal) {
  return requireData(
    await api.GET("/api/workspace", {
      signal,
      params: { query: { timeZone: systemTimeZone() } },
    }),
  );
}
