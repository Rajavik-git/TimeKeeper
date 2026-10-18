// Screenpipe session link (docs/REQUIREMENTS.md#sessions-and-desktop-lifecycle): the TimeKeeper session follows
// Screenpipe's recording session. When Screenpipe starts recording, a session starts unless one is active; when it
// stops, the session ends at the last time Screenpipe was seen running. Uses the button logic through the API only.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { readActiveSession } from "./api-client.js";
import { ensureSession, type SessionDeps } from "./session.js";
import { activePeriod, endSession } from "./workflow.js";

export const LINK_PRODUCER_ID = "screenpipe-session-link";

export type ScreenpipeState =
  { running: true; engineStartedAt: string | null } | { running: false } | { running: null };

/**
 * Screenpipe runs while its /health answers (no key needed) and capture is not stopped. Pauses (schedule, DRM) and
 * degraded health keep it running; only an unreachable engine or a stopped capture count as stopped.
 */
export async function readScreenpipe(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<ScreenpipeState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetcher(`${url}/health`, { signal: ctrl.signal, redirect: "error" });
    const h = (await r.json().catch(() => null)) as {
      status?: string;
      capture_status?: { status?: string };
      startup?: { engine_started_at?: number };
    } | null;
    if (h?.capture_status?.status === "stopped") return { running: false };
    if (!h || (typeof h.status !== "string" && typeof h.capture_status?.status !== "string"))
      return { running: null };
    if (!r.ok && h.status !== "unhealthy") return { running: null };
    const started = Number(h?.startup?.engine_started_at);
    const startedAt = new Date(started * 1000);
    return {
      running: true,
      engineStartedAt:
        started > 0 && Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : null,
    };
  } catch {
    return { running: false };
  } finally {
    clearTimeout(timer);
  }
}

interface EndAttempt {
  commandId: string;
  occurredAt: string;
  sessionId?: string;
  boundaryPrepared?: boolean;
}

export interface LinkState {
  /** Engine start of the Screenpipe run last seen (null when Screenpipe does not report it). */
  engineStartedAt: string | null;
  sessionId?: string;
  startAttempt?: { id: string; occurredAt: string };
  endCommandId?: string;
  endAttempt?: EndAttempt;
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
  /** Persist prepared command identities and boundaries before attempting delivery. */
  persistState?: (state: LinkState) => void;
}

/** Ends the prior run at its prepared boundary. Returns false when delivery must be retried. */
async function endRun(deps: LinkDeps, state: LinkState): Promise<boolean> {
  const attempt = state.endAttempt!;
  let active;
  try {
    active = await readActiveSession(deps.session);
  } catch {
    deps.log("Screenpipe stopped; TimeKeeper is not running, so the end will be retried.");
    return false;
  }
  // A session started after Screenpipe was last seen belongs to a later run (for example the Start button): keep it.
  if (
    !active ||
    (attempt.sessionId && active.id !== attempt.sessionId) ||
    Date.parse(active.startedAt) > Date.parse(attempt.occurredAt)
  )
    return true;
  if (!attempt.boundaryPrepared) {
    try {
      const open = await activePeriod(deps.session, active.id);
      const floor = [active.startedAt, open?.startedAt]
        .filter((timestamp): timestamp is string => !!timestamp)
        .map(Date.parse);
      attempt.occurredAt = new Date(
        Math.max(Date.parse(attempt.occurredAt), ...floor),
      ).toISOString();
      attempt.sessionId = active.id;
      attempt.boundaryPrepared = true;
    } catch {
      deps.log("The session end boundary could not be prepared; delivery will be retried.");
      return false;
    }
  }
  deps.persistState?.(state);
  const r = await endSession(deps.session, undefined, {
    producerId: LINK_PRODUCER_ID,
    at: attempt.occurredAt,
    sessionId: attempt.sessionId,
    commandId: attempt.commandId,
    preserveBoundary: true,
  });
  deps.log(
    `Screenpipe stopped: end_session -> ${r.status}${r.status === "ended" ? ` ${r.session.id} at ${r.session.endedAt}` : ""}`,
  );
  return r.status === "ended" || r.status === "no_active_session";
}

/** One observation of Screenpipe. Returns the next state; a command that was not delivered is retried next time. */
export async function linkTick(deps: LinkDeps, previous: LinkState): Promise<LinkState> {
  let state = { ...previous };
  const now = deps.session.now();
  const sp = await deps.readScreenpipe();

  if (sp.running === null) return state;

  // Retain the original target and end boundary until the API confirms completion, even if capture resumes.
  if (state.endAttempt && !state.ended) {
    state.endAttempt = { ...state.endAttempt };
    if (!(await endRun(deps, state))) return state;
    state = { ...state, ended: true, started: false };
  }

  if (!sp.running) {
    if (
      state.lastRunningAt &&
      !state.ended &&
      now.getTime() - Date.parse(state.lastRunningAt) >= deps.graceMs
    ) {
      state.endAttempt = {
        occurredAt: state.lastRunningAt,
        sessionId: state.sessionId,
        commandId:
          state.endCommandId ??
          `link-end-${state.sessionId ?? "legacy"}-${Date.parse(state.lastRunningAt)}`,
      };
      if (await endRun(deps, state)) state = { ...state, ended: true, started: false };
    }
    return state;
  }

  if (state.ended || sp.engineStartedAt !== state.engineStartedAt) {
    // A new Screenpipe run. If the previous one stopped longer ago than the grace period and its end was not
    // delivered (the link itself was stopped, for example by a reboot), end that session first.
    const runStart = sp.engineStartedAt ? Date.parse(sp.engineStartedAt) : now.getTime();
    const continues =
      state.lastRunningAt !== null &&
      !state.ended &&
      runStart - Date.parse(state.lastRunningAt) <= deps.graceMs;
    if (!continues && state.lastRunningAt && !state.ended) {
      state.endAttempt = {
        occurredAt: state.lastRunningAt,
        sessionId: state.sessionId,
        commandId:
          state.endCommandId ??
          `link-end-${state.sessionId ?? "legacy"}-${Date.parse(state.lastRunningAt)}`,
      };
      if (!(await endRun(deps, state))) return state;
    }
    state = {
      ...(continues ? state : {}),
      engineStartedAt: sp.engineStartedAt,
      started: continues && state.started,
      lastRunningAt: state.lastRunningAt,
      ended: false,
    };
  }
  state.lastRunningAt = now.toISOString();
  state.ended = false;

  if (!state.started) {
    // Same rule as the Start button: does nothing when a session is active.
    state.startAttempt ??= {
      // Capture can stop and resume within the same engine. Allocate an identity for each capture run.
      id: `link-${deps.session.newId()}`,
      occurredAt: state.lastRunningAt!,
    };
    deps.persistState?.(state);
    const r = await ensureSession(deps.session, LINK_PRODUCER_ID, state.startAttempt);
    const tab =
      "tab_detection" in r && r.tab_detection ? `; tab detection ${r.tab_detection.status}` : "";
    deps.log(
      `Screenpipe running: start_session -> ${r.status}${"session" in r ? ` ${r.session.id}` : ""}${tab}`,
    );
    if (r.status === "started" || r.status === "already_active") {
      state.started = true;
      state.sessionId = r.session.id;
    }
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

interface StoredLinkState {
  state: LinkState;
  revision: number;
}

function readStoredLinkState(path: string): StoredLinkState {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid state");
  const data = value as Record<string, unknown>;
  const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const optionalId = (v: unknown) => v === undefined || (typeof v === "string" && v.length > 0);
  if (
    !(data.engineStartedAt === null || timestamp(data.engineStartedAt)) ||
    !(data.lastRunningAt === null || timestamp(data.lastRunningAt)) ||
    typeof data.started !== "boolean" ||
    typeof data.ended !== "boolean" ||
    !optionalId(data.sessionId) ||
    !optionalId(data.endCommandId)
  )
    throw new Error("Invalid state");
  if (data.startAttempt !== undefined) {
    const attempt = data.startAttempt as LinkState["startAttempt"];
    if (!attempt || typeof attempt.id !== "string" || !attempt.id || !timestamp(attempt.occurredAt))
      throw new Error("Invalid state");
  }
  if (data.endAttempt !== undefined) {
    const attempt = data.endAttempt as EndAttempt;
    if (
      !attempt ||
      typeof attempt.commandId !== "string" ||
      !attempt.commandId ||
      !timestamp(attempt.occurredAt) ||
      !optionalId(attempt.sessionId) ||
      !(attempt.boundaryPrepared === undefined || typeof attempt.boundaryPrepared === "boolean") ||
      (attempt.boundaryPrepared === true && !attempt.sessionId)
    )
      throw new Error("Invalid state");
  }
  const revision = data.persistenceRevision ?? 0;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error("Invalid state");
  const { persistenceRevision: _, ...state } = data;
  return { state: state as unknown as LinkState, revision: revision as number };
}

function recoverLinkState(path: string): StoredLinkState | null {
  const candidates: StoredLinkState[] = [];
  let found = false;
  for (const candidate of [path, `${path}.backup`]) {
    try {
      candidates.push(readStoredLinkState(candidate));
      found = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") found = true;
    }
  }
  if (candidates.length) return candidates.sort((a, b) => b.revision - a.revision)[0]!;
  if (found)
    throw new Error(
      "Screenpipe link state cannot be recovered. Restore a valid state copy before restarting the link.",
    );
  return null;
}

export function loadLinkState(path: string): LinkState {
  return recoverLinkState(path)?.state ?? initialLinkState();
}

function replaceStateFile(path: string, contents: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function saveLinkState(path: string, state: LinkState): void {
  const revision = (recoverLinkState(path)?.revision ?? 0) + 1;
  const contents = JSON.stringify({ ...state, persistenceRevision: revision }, null, 2);
  mkdirSync(dirname(path), { recursive: true });
  // The higher revision wins if the process exits between these replacements.
  replaceStateFile(`${path}.backup`, contents);
  replaceStateFile(path, contents);
}

/** Polls Screenpipe until stopped. The state file keeps the last observation across restarts of this process. */
export function runScreenpipeLink(
  deps: LinkDeps,
  statePath: string,
  pollMs = 10_000,
): { stop: () => void } {
  let stopped = false;
  let state = loadLinkState(statePath);
  const durableDeps: LinkDeps = {
    ...deps,
    persistState: (prepared) => {
      saveLinkState(statePath, prepared);
      state = structuredClone(prepared);
    },
  };
  void (async () => {
    while (!stopped) {
      try {
        state = await linkTick(durableDeps, state);
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
