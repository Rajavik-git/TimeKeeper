// Screenpipe session link: the TimeKeeper session follows Screenpipe's recording. When Screenpipe starts
// recording, a session starts unless one is active; when it stops for longer than the grace period, the
// session ends at the last time Screenpipe was seen running. Only Screenpipe's public /health is read.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { endSession, getStatus, startSession, type SessionDeps } from "./session.js";

export const LINK_PRODUCER_ID = "screenpipe-session-link";

export type ScreenpipeState =
  { running: true; engineStartedAt: string | null } | { running: false };

interface ScreenpipeHealth {
  capture_status?: { status?: string };
  startup?: { engine_started_at?: number };
}

/**
 * Screenpipe runs while /health answers and capture is not stopped. Pauses and degraded health
 * keep it running; only an unreachable engine or a stopped capture count as stopped.
 */
export async function readScreenpipe(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<ScreenpipeState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${url}/health`, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return { running: false };
    const health = (await response.json().catch(() => null)) as ScreenpipeHealth | null;
    if (health?.capture_status?.status === "stopped") return { running: false };
    const started = Number(health?.startup?.engine_started_at);
    return {
      running: true,
      engineStartedAt:
        Number.isFinite(started) && started > 0 ? new Date(started * 1000).toISOString() : null,
    };
  } catch {
    return { running: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface LinkState {
  /** Engine start of the Screenpipe run last seen (null when Screenpipe does not report it). */
  engineStartedAt: string | null;
  /** The session start for the current Screenpipe run was delivered. */
  started: boolean;
  /** Last time Screenpipe was seen running: the end boundary once it stops. */
  lastRunningAt: string | null;
  /** The end for the last Screenpipe run was delivered, or there was nothing to end. */
  ended: boolean;
}

export const initialLinkState = (): LinkState => ({
  engineStartedAt: null,
  started: false,
  lastRunningAt: null,
  ended: false,
});

export interface LinkDeps {
  session: SessionDeps;
  readScreenpipe: () => Promise<ScreenpipeState>;
  /** A shorter stop (restart, update) keeps the session. */
  graceMs: number;
  log: (message: string) => void;
}

/** Ends the session of Screenpipe's last run at `at`. Returns false when it must be retried. */
async function endRun(deps: LinkDeps, at: string): Promise<boolean> {
  const status = await getStatus(deps.session).catch(() => null);
  if (status?.timekeeper !== "running") {
    deps.log("Screenpipe stopped; TimeKeeper is not running, so the end will be retried.");
    return false;
  }
  // A session started after Screenpipe was last seen belongs to a later run (for example the Start button).
  if (!status.activeSession || Date.parse(status.activeSession.startedAt) > Date.parse(at))
    return true;
  const result = await endSession(deps.session, LINK_PRODUCER_ID, at);
  deps.log(
    `Screenpipe stopped: end_session -> ${result.status}${result.status === "ended" ? ` ${result.session.id} at ${result.session.endedAt}` : ""}`,
  );
  return ["ended", "no_active_session", "pending"].includes(result.status);
}

/** One observation of Screenpipe. Returns the next state; an undelivered command is retried next time. */
export async function linkTick(deps: LinkDeps, previous: LinkState): Promise<LinkState> {
  let state = { ...previous };
  const now = deps.session.now();
  const screenpipe = await deps.readScreenpipe();

  if (!screenpipe.running) {
    const stoppedLongEnough =
      state.lastRunningAt !== null &&
      now.getTime() - Date.parse(state.lastRunningAt) >= deps.graceMs;
    if (stoppedLongEnough && !state.ended && (await endRun(deps, state.lastRunningAt!)))
      state = { ...state, ended: true, started: false };
    return state;
  }

  if (screenpipe.engineStartedAt !== state.engineStartedAt) {
    // A new Screenpipe run. If the previous run stopped longer ago than the grace period and its end was
    // never delivered (for example after a reboot), end that session before starting another one.
    const runStart = screenpipe.engineStartedAt
      ? Date.parse(screenpipe.engineStartedAt)
      : now.getTime();
    const continues =
      state.lastRunningAt !== null &&
      !state.ended &&
      runStart - Date.parse(state.lastRunningAt) <= deps.graceMs;
    if (
      !continues &&
      state.lastRunningAt &&
      !state.ended &&
      !(await endRun(deps, state.lastRunningAt))
    )
      return state;
    state = {
      engineStartedAt: screenpipe.engineStartedAt,
      started: continues && state.started,
      lastRunningAt: state.lastRunningAt,
      ended: false,
    };
  }
  state.lastRunningAt = now.toISOString();
  state.ended = false;

  if (!state.started) {
    const result = await startSession(deps.session, LINK_PRODUCER_ID);
    deps.log(
      `Screenpipe running: start_session -> ${result.status}${"session" in result ? ` ${result.session.id}` : ""}`,
    );
    if (["started", "already_active", "pending"].includes(result.status)) state.started = true;
  }
  return state;
}

export interface LinkStatus {
  /** The link rewrites its state at every check; a recent write means it is running. */
  running: boolean;
  lastCheckAt: string | null;
  screenpipeLastSeenRunningAt: string | null;
  sessionStartDelivered: boolean;
  sessionEndDelivered: boolean;
  statePath: string;
}

const isTimeOrNull = (value: unknown) =>
  value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));

function isLinkState(value: unknown): value is LinkState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    isTimeOrNull(state.engineStartedAt) &&
    isTimeOrNull(state.lastRunningAt) &&
    typeof state.started === "boolean" &&
    typeof state.ended === "boolean"
  );
}

/** A missing, unreadable or malformed state file starts over. */
export function loadLinkState(path: string): LinkState {
  try {
    if (existsSync(path)) {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (isLinkState(parsed)) {
        const { engineStartedAt, started, lastRunningAt, ended } = parsed;
        return { engineStartedAt, started, lastRunningAt, ended };
      }
    }
  } catch {
    // Falls through to a fresh state.
  }
  return initialLinkState();
}

export function saveLinkState(path: string, state: LinkState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function linkStatus(statePath: string, now: Date, pollMs = 10_000): LinkStatus {
  const lastCheck = existsSync(statePath) ? statSync(statePath).mtime : null;
  const state = loadLinkState(statePath);
  return {
    running: lastCheck !== null && now.getTime() - lastCheck.getTime() <= 3 * pollMs,
    lastCheckAt: lastCheck?.toISOString() ?? null,
    screenpipeLastSeenRunningAt: state.lastRunningAt,
    sessionStartDelivered: state.started,
    sessionEndDelivered: state.ended,
    statePath,
  };
}

/** Polls Screenpipe until stopped. The state file keeps the last observation across restarts. */
export function runScreenpipeLink(
  deps: LinkDeps,
  statePath: string,
  pollMs = 10_000,
): { stop: () => void } {
  let stopped = false;
  let state = loadLinkState(statePath);
  void (async () => {
    while (!stopped) {
      try {
        state = await linkTick(deps, state);
        saveLinkState(statePath, state);
      } catch (error) {
        deps.log(
          `Screenpipe link failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await deps.session.sleep(pollMs);
    }
  })();
  return {
    stop: () => {
      stopped = true;
    },
  };
}
