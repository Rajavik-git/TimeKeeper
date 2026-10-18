import { useEffect, useRef, useState } from "react";
import { api, type CoreState } from "../../../api/client";
import type { ScreenpipeFrames } from "../lib/screenpipeFrames";

type Period = Pick<CoreState["periods"][number], "id" | "startedAt" | "endedAt">;
export type FramesState = { status: "idle" | "loading" } | ScreenpipeFrames;

/** Screenpipe serves at most one day per request; longer periods show their latest day. */
const maxRangeMs = 24 * 60 * 60_000;
const failure: ScreenpipeFrames = {
  status: "unavailable",
  message: "TimeKeeper could not read Screenpipe.",
};

function frameRange(period: Period): { start: string; end: string } {
  const end = period.endedAt ? Date.parse(period.endedAt) : Date.now();
  const start = Math.max(Date.parse(period.startedAt), end - maxRangeMs);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/**
 * Loads the Screenpipe captures of the previewed period once. Successful lists are cached per
 * period for the screen's lifetime; a failed read is retried on the next preview.
 */
export function useScreenpipeFrames(period: Period | undefined): FramesState {
  const cache = useRef(new Map<string, ScreenpipeFrames>());
  const [state, setState] = useState<FramesState>({ status: "idle" });
  const key = period ? `${period.id}|${period.endedAt ?? "open"}` : null;
  // The key identifies the range; the period object itself changes on every refresh.
  const latest = useRef(period);
  latest.current = period;

  useEffect(() => {
    const period = latest.current;
    if (!period || !key) {
      setState({ status: "idle" });
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setState(cached);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const { start, end } = frameRange(period);
    api
      .GET("/api/screenpipe/frames", {
        params: { query: { start, end, limit: 200 } },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const result = data ?? failure;
        if (result.status === "ok") cache.current.set(key, result);
        setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(failure);
      });
    return () => controller.abort();
  }, [key]);

  return state;
}
