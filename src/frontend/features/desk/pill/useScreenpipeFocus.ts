import { useEffect, useRef, useState } from "react";
import type { components } from "../../../../contracts/generated";
import { api } from "../../../api/client";

export type WindowFocus = components["schemas"]["WindowFocus"];
type ScreenpipeIssue = Exclude<components["schemas"]["ScreenpipeFocus"], { status: "ok" }>;
export type ScreenpipeState = { status: "connecting" | "ok" } | ScreenpipeIssue;

export const focusPollMs = 2000;
const unreachable: ScreenpipeIssue = {
  status: "unavailable",
  message: "TimeKeeper could not read Screenpipe.",
};

/** A state worth showing the lawyer: Screenpipe is stopped, unconfigured or refused the key. */
export function screenpipeIssue(state: ScreenpipeState): ScreenpipeIssue | null {
  return "message" in state ? state : null;
}

const timeKeeperTitles = new Set(["TimeKeeper", "TimeKeeper pill"]);

/**
 * Screenpipe also records TimeKeeper's own windows; they never start a file switch. Only the
 * TimeKeeper executable and its window titles match, so a client document about "timekeeper" still counts.
 */
export function isTimeKeeperWindow(focus: WindowFocus): boolean {
  return /^timekeeper/i.test(focus.appName) || timeKeeperTitles.has(focus.windowTitle.trim());
}

/**
 * Polls the window Screenpipe last recorded while `enabled`. A window is reported once it is
 * seen on two consecutive polls, so windows passed through on the way are ignored.
 */
export function useScreenpipeFocus(
  enabled: boolean,
  onStable: (focus: WindowFocus) => void,
): ScreenpipeState {
  const [state, setState] = useState<ScreenpipeState>({ status: "connecting" });
  const onStableRef = useRef(onStable);
  onStableRef.current = onStable;

  useEffect(() => {
    if (!enabled) {
      // A stopped watch has no current Screenpipe state; never show a stale problem.
      setState({ status: "connecting" });
      return;
    }
    const controller = new AbortController();
    let timer = 0;
    let candidate = "";
    let reported = "";
    const poll = async () => {
      try {
        const { data } = await api.GET("/api/screenpipe/focus", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!data) setState(unreachable);
        else if (data.status !== "ok") setState(data);
        else {
          setState({ status: "ok" });
          if (data.focus && !isTimeKeeperWindow(data.focus)) {
            const key = `${data.focus.appName}:${data.focus.windowTitle}`;
            if (key === candidate && key !== reported) {
              reported = key;
              onStableRef.current(data.focus);
            }
            candidate = key;
          }
        }
      } catch {
        if (!controller.signal.aborted) setState(unreachable);
      } finally {
        // Polls run one after another, so a slow reply can never overtake a newer one.
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), focusPollMs);
      }
    };
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}
