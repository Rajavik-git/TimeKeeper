// "Start TimeKeeper" logic shared by the MCP tool and the CLI fallback.
// Calls only the application API (docs/API.md D6, D7). Never claims a start that the API did not confirm.
import type { StartCommand } from '../contracts/index.js';
import type { TabDetectionResult } from './tab-detection.js';

export const PRODUCER_ID = 'screenpipe-start-button';

export interface SessionInfo { id: string; startedAt: string; endedAt: string | null }

export type StatusResult =
  | { timekeeper: 'running'; activeSession: SessionInfo | null }
  | { timekeeper: 'not_running'; activeSession: null };

export type StartResult =
  | { status: 'already_active'; started: false; session: SessionInfo; tab_detection?: TabDetectionResult }
  | { status: 'started'; started: true; session: SessionInfo; commandId: string; launched: boolean; tab_detection?: TabDetectionResult }
  | { status: 'pending'; started: false; commandId: string }
  | { status: 'timekeeper_not_running'; started: false; message: string }
  | { status: 'unconfirmed'; started: false; commandId: string; message: string }
  | { status: 'error'; started: false; error: string; message: string };

export interface SessionDeps {
  /** Base URL of the application API, including `/api`. */
  apiBase: string;
  fetch: typeof fetch;
  now: () => Date;
  newId: () => string;
  /** Starts the desktop app; undefined when no launch command is configured. */
  launch?: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Starts JEV tab-change detection once a session is running; undefined disables it. */
  startTabDetection?: () => Promise<TabDetectionResult>;
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
}

class Unreachable extends Error {}

async function call(deps: SessionDeps, path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.requestTimeoutMs ?? 5000);
  try {
    return await deps.fetch(`${deps.apiBase}${path}`, { ...init, signal: ctrl.signal, redirect: 'error' });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function healthy(deps: SessionDeps): Promise<boolean> {
  try {
    const r = await call(deps, '/health');
    return r.ok && (await r.json() as { status?: string })?.status === 'ok';
  } catch (error) {
    if (error instanceof Unreachable) return false;
    throw error;
  }
}

function session(value: unknown): SessionInfo | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.startedAt !== 'string') return null;
  return { id: s.id, startedAt: s.startedAt, endedAt: typeof s.endedAt === 'string' ? s.endedAt : null };
}

async function activeSession(deps: SessionDeps): Promise<SessionInfo | null> {
  const r = await call(deps, '/sessions/active');
  if (!r.ok) throw new Error(`GET /sessions/active returned ${r.status}`);
  return session(await r.json());
}

export async function getStatus(deps: SessionDeps): Promise<StatusResult> {
  if (!(await healthy(deps))) return { timekeeper: 'not_running', activeSession: null };
  return { timekeeper: 'running', activeSession: await activeSession(deps) };
}

async function waitUntilReady(deps: SessionDeps): Promise<boolean> {
  const deadline = deps.now().getTime() + (deps.readyTimeoutMs ?? 60_000);
  while (deps.now().getTime() < deadline) {
    if (await healthy(deps)) return true;
    await deps.sleep(1000);
  }
  return false;
}

/**
 * Does nothing when a session is active; otherwise starts one, launching TimeKeeper first when configured.
 * Whenever a session is running afterwards, tab-change detection is started too (or left running).
 */
export async function ensureSession(deps: SessionDeps): Promise<StartResult> {
  const result = await ensureSessionOnly(deps);
  if ((result.status === 'started' || result.status === 'already_active') && deps.startTabDetection) {
    try {
      result.tab_detection = await deps.startTabDetection();
    } catch (error) {
      result.tab_detection = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}

async function ensureSessionOnly(deps: SessionDeps): Promise<StartResult> {
  // The press time is the session start boundary, even if TimeKeeper needs launching first.
  const pressedAt = deps.now().toISOString();
  let launched = false;
  try {
    if (!(await healthy(deps))) {
      if (!deps.launch) {
        return { status: 'timekeeper_not_running', started: false,
          message: 'TimeKeeper is not running and no launch command is configured. Open TimeKeeper, then press Start again.' };
      }
      await deps.launch();
      launched = true;
      if (!(await waitUntilReady(deps))) {
        return { status: 'timekeeper_not_running', started: false,
          message: 'TimeKeeper was launched but its API did not become ready. No session was started.' };
      }
    }

    const current = await activeSession(deps);
    if (current) return { status: 'already_active', started: false, session: current };

    const id = deps.newId();
    const command: StartCommand = {
      producerId: PRODUCER_ID,
      commandId: `start-${id}`,
      sessionId: `session-${id}`,
      occurredAt: pressedAt,
    };
    let r: Response;
    try {
      r = await call(deps, '/commands/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      });
    } catch (error) {
      if (error instanceof Unreachable) {
        return { status: 'unconfirmed', started: false, commandId: command.commandId,
          message: 'The start command was sent but TimeKeeper did not answer. Check TimeKeeper before pressing Start again.' };
      }
      throw error;
    }
    const body = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (r.status === 202) return { status: 'pending', started: false, commandId: command.commandId };
    if (!r.ok) {
      return { status: 'error', started: false, error: String(body?.error ?? `http-${r.status}`), message: String(body?.message ?? '') };
    }
    const started = session({ id: body?.sessionId, startedAt: body?.startedAt, endedAt: body?.endedAt });
    if (!started) return { status: 'error', started: false, error: 'malformed-response', message: 'start returned no session' };
    // Another start won the race: the API returned the session that was already active.
    if (started.id !== command.sessionId) return { status: 'already_active', started: false, session: started };
    return { status: 'started', started: true, session: started, commandId: command.commandId, launched };
  } catch (error) {
    return { status: 'error', started: false, error: 'unexpected', message: error instanceof Error ? error.message : String(error) };
  }
}
