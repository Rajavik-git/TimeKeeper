// Screenpipe session link (docs/REQUIREMENTS.md#sessions-and-desktop-lifecycle): the TimeKeeper session follows
// Screenpipe's recording session. When Screenpipe starts recording, a session starts unless one is active; when it
// stops, the session ends at the last time Screenpipe was seen running. Uses the button logic through the API only.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureSession, getStatus, type SessionDeps } from './session.js';
import { endSession } from './workflow.js';

export const LINK_PRODUCER_ID = 'screenpipe-session-link';

export type ScreenpipeState = { running: true; engineStartedAt: string | null } | { running: false };

/**
 * Screenpipe runs while its /health answers (no key needed) and capture is not stopped. Pauses (schedule, DRM) and
 * degraded health keep it running; only an unreachable engine or a stopped capture count as stopped.
 */
export async function readScreenpipe(url: string, fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<ScreenpipeState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetcher(`${url}/health`, { signal: ctrl.signal, redirect: 'error' });
    const h = await r.json().catch(() => null) as { capture_status?: { status?: string }; startup?: { engine_started_at?: number } } | null;
    if (h?.capture_status?.status === 'stopped') return { running: false };
    const started = Number(h?.startup?.engine_started_at);
    return { running: true, engineStartedAt: Number.isFinite(started) && started > 0 ? new Date(started * 1000).toISOString() : null };
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

export const initialLinkState = (): LinkState => ({ engineStartedAt: null, started: false, lastRunningAt: null, ended: false });

export interface LinkDeps {
  session: SessionDeps;
  readScreenpipe: () => Promise<ScreenpipeState>;
  /** A shorter stop (restart, update) keeps the session. */
  graceMs: number;
  log: (message: string) => void;
}

/** Ends the session that Screenpipe's last run belonged to, at `at`. Returns false when it must be retried. */
async function endRun(deps: LinkDeps, at: string): Promise<boolean> {
  const status = await getStatus(deps.session).catch(() => null);
  if (!status || status.timekeeper !== 'running') {
    deps.log('Screenpipe stopped; TimeKeeper is not running, so the end will be retried.');
    return false;
  }
  // A session started after Screenpipe was last seen belongs to a later run (for example the Start button): keep it.
  if (!status.activeSession || Date.parse(status.activeSession.startedAt) > Date.parse(at)) return true;
  const r = await endSession(deps.session, undefined, { producerId: LINK_PRODUCER_ID, at });
  deps.log(`Screenpipe stopped: end_session -> ${r.status}${r.status === 'ended' ? ` ${r.session.id} at ${r.session.endedAt}` : ''}`);
  return r.status === 'ended' || r.status === 'no_active_session' || r.status === 'pending';
}

/** One observation of Screenpipe. Returns the next state; a command that was not delivered is retried next time. */
export async function linkTick(deps: LinkDeps, previous: LinkState): Promise<LinkState> {
  let state = { ...previous };
  const now = deps.session.now();
  const sp = await deps.readScreenpipe();

  if (!sp.running) {
    if (state.lastRunningAt && !state.ended && now.getTime() - Date.parse(state.lastRunningAt) >= deps.graceMs) {
      if (await endRun(deps, state.lastRunningAt)) state = { ...state, ended: true, started: false };
    }
    return state;
  }

  if (sp.engineStartedAt !== state.engineStartedAt) {
    // A new Screenpipe run. If the previous one stopped longer ago than the grace period and its end was not
    // delivered (the link itself was stopped, for example by a reboot), end that session first.
    const runStart = sp.engineStartedAt ? Date.parse(sp.engineStartedAt) : now.getTime();
    const continues = state.lastRunningAt !== null && !state.ended && runStart - Date.parse(state.lastRunningAt) <= deps.graceMs;
    if (!continues && state.lastRunningAt && !state.ended && !(await endRun(deps, state.lastRunningAt))) return state;
    state = { engineStartedAt: sp.engineStartedAt, started: continues && state.started, lastRunningAt: state.lastRunningAt, ended: false };
  }
  state.lastRunningAt = now.toISOString();
  state.ended = false;

  if (!state.started) {
    // Same rule as the Start button: does nothing when a session is active.
    const r = await ensureSession(deps.session, LINK_PRODUCER_ID);
    const tab = 'tab_detection' in r && r.tab_detection ? `; tab detection ${r.tab_detection.status}` : '';
    deps.log(`Screenpipe running: start_session -> ${r.status}${'session' in r ? ` ${r.session.id}` : ''}${tab}`);
    if (r.status === 'started' || r.status === 'already_active' || r.status === 'pending') state.started = true;
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

export function loadLinkState(path: string): LinkState {
  try {
    if (existsSync(path)) return { ...initialLinkState(), ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch { /* unreadable state starts over */ }
  return initialLinkState();
}

export function saveLinkState(path: string, state: LinkState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

/** Polls Screenpipe until stopped. The state file keeps the last observation across restarts of this process. */
export function runScreenpipeLink(deps: LinkDeps, statePath: string, pollMs = 10_000): { stop: () => void } {
  let stopped = false;
  let state = loadLinkState(statePath);
  void (async () => {
    while (!stopped) {
      try {
        state = await linkTick(deps, state);
        saveLinkState(statePath, state);
      } catch (error) {
        deps.log(`Screenpipe link failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await deps.session.sleep(pollMs);
    }
  })();
  return { stop: () => { stopped = true; } };
}
