// End button, case catalogue, and case transitions from the Screenpipe JEV workflow.
// Each operation uses existing application endpoints; none writes SQLite or invents IDs (docs/API.md D6, D7).
import { runningWatcher } from '../../integrations/screenpipe/jev-check/session-bound.js';
import type { SessionDeps, SessionInfo } from './session.js';

export const END_PRODUCER_ID = 'screenpipe-end-button';

export interface PeriodInfo { id: string; caseId: string | null; startedAt: string; endedAt: string | null; assignmentOrigin?: string }
export interface CaseInfo { id: string; clientId: string; clientName: string; reference: string; title: string }

export type EndResult =
  | { status: 'ended'; ended: true; session: SessionInfo; commandId: string; tab_detection: 'stopping' | 'not_running' }
  | { status: 'no_active_session'; ended: false; message: string }
  | { status: 'pending'; ended: false; commandId: string }
  | { status: 'timekeeper_not_running'; ended: false; message: string }
  | { status: 'unconfirmed'; ended: false; commandId: string; message: string }
  | { status: 'error'; ended: false; error: string; message: string };

export type TransitionInput = { sessionId: string; transitionAt: string; caseId: string | null };
export type TransitionResult =
  | { status: 'applied'; period: PeriodInfo; questionId: string | null }
  | { status: 'no_change'; reason: 'same_case' | 'already_unresolved'; period: PeriodInfo }
  | { status: 'stale'; reason: 'session_not_active' | 'newer_period'; message: string }
  | { status: 'pending'; conflictId: string }
  | { status: 'timekeeper_not_running'; message: string }
  | { status: 'unconfirmed'; periodId: string; message: string }
  | { status: 'error'; error: string; message: string };

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

async function getJson<T>(deps: SessionDeps, path: string): Promise<T> {
  const r = await call(deps, path);
  if (!r.ok) throw new Error(`GET ${path} returned ${r.status}`);
  return await r.json() as T;
}

const postJson = (deps: SessionDeps, path: string, body: unknown) =>
  call(deps, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const asSession = (s: any): SessionInfo | null =>
  s && typeof s.id === 'string' && typeof s.startedAt === 'string' ? { id: s.id, startedAt: s.startedAt, endedAt: s.endedAt ?? null } : null;

const asPeriod = (p: any): PeriodInfo => ({ id: p.id, caseId: p.caseId ?? null, startedAt: p.startedAt, endedAt: p.endedAt ?? null,
  ...(p.assignmentOrigin ? { assignmentOrigin: p.assignmentOrigin } : {}) });

export async function activePeriod(deps: SessionDeps, sessionId: string): Promise<PeriodInfo | null> {
  const periods = await getJson<any[]>(deps, '/work-periods');
  const open = periods.filter(p => p.sessionId === sessionId && p.endedAt === null).map(asPeriod);
  return open.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
}

export async function listCases(deps: SessionDeps): Promise<CaseInfo[]> {
  return getJson<CaseInfo[]>(deps, '/cases');
}

export async function endSession(deps: SessionDeps, lockPath?: string): Promise<EndResult> {
  const pressedAt = deps.now().toISOString();
  let session: SessionInfo | null;
  try {
    session = asSession(await getJson(deps, '/sessions/active'));
  } catch (error) {
    if (error instanceof Unreachable) {
      return { status: 'timekeeper_not_running', ended: false,
        message: 'TimeKeeper is not running, so the end command could not be delivered. The session is still active; open TimeKeeper and press End again.' };
    }
    return { status: 'error', ended: false, error: 'unexpected', message: error instanceof Error ? error.message : String(error) };
  }
  if (!session) return { status: 'no_active_session', ended: false, message: 'No TimeKeeper session is active.' };

  const id = deps.newId();
  const commandId = `end-${id}`;
  let r: Response;
  try {
    r = await postJson(deps, '/commands/end', { producerId: END_PRODUCER_ID, commandId, sessionId: session.id, occurredAt: pressedAt });
  } catch (error) {
    if (error instanceof Unreachable) {
      return { status: 'unconfirmed', ended: false, commandId,
        message: 'The end command was sent but TimeKeeper did not answer. Check TimeKeeper before pressing End again.' };
    }
    throw error;
  }
  const body = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (r.status === 202) return { status: 'pending', ended: false, commandId };
  if (!r.ok) return { status: 'error', ended: false, error: String(body?.error ?? `http-${r.status}`), message: String(body?.message ?? '') };
  const ended = asSession({ id: body?.sessionId, startedAt: body?.startedAt, endedAt: body?.endedAt });
  if (!ended?.endedAt) return { status: 'error', ended: false, error: 'malformed-response', message: 'end returned no end boundary' };
  // The watcher checks the session every 10 seconds and stops by itself.
  return { status: 'ended', ended: true, session: ended, commandId,
    tab_detection: runningWatcher(lockPath) !== null ? 'stopping' : 'not_running' };
}

function validTransition(input: unknown): TransitionInput | string {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i.sessionId !== 'string' || !i.sessionId) return 'sessionId required';
  if (typeof i.transitionAt !== 'string' || Number.isNaN(Date.parse(i.transitionAt))) return 'transitionAt must be an ISO timestamp';
  if (i.caseId !== null && (typeof i.caseId !== 'string' || !i.caseId)) return 'caseId must be an existing case ID or null';
  return { sessionId: i.sessionId, transitionAt: new Date(i.transitionAt).toISOString(), caseId: i.caseId as string | null };
}

/**
 * Records a confirmed case transition at the capture time of the new context:
 * an existing case opens an automatic period; null opens an unresolved period, which asks the lawyer.
 * Validation of the case, session boundaries, and protected periods stays in the application service.
 */
export async function recordCaseTransition(deps: SessionDeps, input: unknown): Promise<TransitionResult> {
  const t = validTransition(input);
  if (typeof t === 'string') return { status: 'error', error: 'invalid-request', message: t };
  // Same transition, same ID: a retried call has no further effect.
  const periodId = `auto-${t.sessionId}-${Date.parse(t.transitionAt)}`;
  try {
    const session = asSession(await getJson(deps, '/sessions/active'));
    if (!session || session.id !== t.sessionId) {
      return { status: 'stale', reason: 'session_not_active', message: 'The target session is no longer active. Nothing was recorded.' };
    }
    const current = await activePeriod(deps, t.sessionId);
    if (current && current.id !== periodId) {
      if (Date.parse(current.startedAt) >= Date.parse(t.transitionAt)) {
        return { status: 'stale', reason: 'newer_period', message: 'A newer period already started. Nothing was recorded.' };
      }
      if (t.caseId !== null && current.caseId === t.caseId) return { status: 'no_change', reason: 'same_case', period: current };
      if (t.caseId === null && current.caseId === null) return { status: 'no_change', reason: 'already_unresolved', period: current };
    }
    let r: Response;
    try {
      r = await postJson(deps, '/work-periods', {
        id: periodId, sessionId: t.sessionId, caseId: t.caseId, startedAt: t.transitionAt,
        origin: t.caseId === null ? 'unresolved' : 'automatic', mode: 'current',
      });
    } catch (error) {
      if (error instanceof Unreachable) return { status: 'unconfirmed', periodId, message: 'TimeKeeper did not answer after the transition was sent.' };
      throw error;
    }
    const body = await r.json().catch(() => null) as any;
    if (r.status === 202) return { status: 'pending', conflictId: String(body?.conflictId ?? periodId) };
    if (!r.ok) return { status: 'error', error: String(body?.error ?? `http-${r.status}`), message: String(body?.message ?? '') };
    const period = asPeriod(body);
    return { status: 'applied', period, questionId: period.caseId === null ? `period:${period.id}` : null };
  } catch (error) {
    if (error instanceof Unreachable) return { status: 'timekeeper_not_running', message: 'TimeKeeper is not running. Nothing was recorded.' };
    return { status: 'error', error: 'unexpected', message: error instanceof Error ? error.message : String(error) };
  }
}
