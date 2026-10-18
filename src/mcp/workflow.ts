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
  // Only active cases are candidates; the API also returns archived ones without the filter (docs/API.md A13).
  // Keep only the matching fields: the API also returns client information such as opposingParty and caseNumber.
  const cases = await getJson<CaseInfo[]>(deps, '/cases?status=active');
  return cases.map(({ id, clientId, clientName, reference, title }) => ({ id, clientId, clientName, reference, title }));
}

/**
 * Ends the active session at the press time, or at `options.at` for a known earlier end (the Screenpipe session link).
 * An earlier end never goes before the open period's start, which the API would refuse.
 */
export async function endSession(deps: SessionDeps, lockPath?: string,
  options: { producerId?: string; at?: string } = {}): Promise<EndResult> {
  let pressedAt = options.at ?? deps.now().toISOString();
  let session: SessionInfo | null;
  try {
    session = asSession(await getJson(deps, '/sessions/active'));
    if (session && options.at) {
      const open = await activePeriod(deps, session.id);
      const floor = [session.startedAt, open?.startedAt].filter((t): t is string => !!t).map(Date.parse);
      pressedAt = new Date(Math.max(Date.parse(options.at), ...floor)).toISOString();
    }
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
    r = await postJson(deps, '/commands/end', { producerId: options.producerId ?? END_PRODUCER_ID, commandId, sessionId: session.id, occurredAt: pressedAt });
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

// --- Read-only checks and the lawyer's answer, for testing and asking from the Screenpipe chat ---

export interface PeriodSummary {
  id: string; caseId: string | null; case: string | null; startedAt: string; endedAt: string | null;
  /** Increases with each change of the period's case, for example the lawyer's answer. */
  assignmentRevision: number; timeValidated: boolean;
}
export type SessionPeriods = { status: 'ok'; session: SessionInfo | null; periods: PeriodSummary[] };
export interface QuestionSummary { questionId: string; periodId: string; status: string; startedAt: string | null; endedAt: string | null }
export type SessionQuestions = { status: 'ok'; session: SessionInfo | null; questions: QuestionSummary[] };
export type ApiFailure = { status: 'timekeeper_not_running'; message: string } | { status: 'error'; error: string; message: string };
export type AnswerResult = { status: 'answered'; period: PeriodSummary } | ApiFailure;

const failure = (error: unknown): ApiFailure => error instanceof Unreachable
  ? { status: 'timekeeper_not_running', message: 'TimeKeeper is not running.' }
  : { status: 'error', error: 'unexpected', message: error instanceof Error ? error.message : String(error) };

/** The given session, else the active one, else the most recent one. */
async function targetSession(deps: SessionDeps, sessionId?: unknown): Promise<SessionInfo | null> {
  if (typeof sessionId === 'string' && sessionId) return asSession(await getJson(deps, `/sessions/${encodeURIComponent(sessionId)}`));
  const active = asSession(await getJson(deps, '/sessions/active'));
  if (active) return active;
  const all = (await getJson<any[]>(deps, '/sessions')).map(asSession).filter((s): s is SessionInfo => s !== null);
  return all.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
}

async function caseNames(deps: SessionDeps): Promise<Map<string, string>> {
  const cases = await getJson<CaseInfo[]>(deps, '/cases');
  return new Map(cases.map(c => [c.id, `${c.reference} - ${c.title}`]));
}

const summary = (p: any, names: Map<string, string>): PeriodSummary => ({
  id: p.id, caseId: p.caseId ?? null, case: p.caseId ? names.get(p.caseId) ?? null : null, startedAt: p.startedAt, endedAt: p.endedAt ?? null,
  assignmentRevision: Number(p.assignmentRevision ?? 0), timeValidated: p.timeValidated === true,
});

/** Work periods of a session, oldest first, with the case reference. */
export async function listWorkPeriods(deps: SessionDeps, input?: { sessionId?: unknown }): Promise<SessionPeriods | ApiFailure> {
  try {
    const session = await targetSession(deps, input?.sessionId);
    if (!session) return { status: 'ok', session: null, periods: [] };
    const [periods, names] = await Promise.all([getJson<any[]>(deps, `/work-periods?sessionId=${encodeURIComponent(session.id)}`), caseNames(deps)]);
    return { status: 'ok', session, periods: periods.map(p => summary(p, names)).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)) };
  } catch (error) { return failure(error); }
}

/** Questions of a session (pending by default) with their period's times. */
export async function listQuestions(deps: SessionDeps, input?: { sessionId?: unknown; status?: unknown }): Promise<SessionQuestions | ApiFailure> {
  try {
    const session = await targetSession(deps, input?.sessionId);
    if (!session) return { status: 'ok', session: null, questions: [] };
    const status = input?.status === 'all' ? '' : typeof input?.status === 'string' ? input.status : 'pending';
    const [questions, periods] = await Promise.all([
      getJson<any[]>(deps, `/questions?sessionId=${encodeURIComponent(session.id)}${status ? `&status=${encodeURIComponent(status)}` : ''}`),
      getJson<any[]>(deps, `/work-periods?sessionId=${encodeURIComponent(session.id)}`),
    ]);
    const byId = new Map(periods.map(p => [p.id, p]));
    return { status: 'ok', session, questions: questions.map(q => ({ questionId: q.questionId, periodId: q.periodId, status: q.status,
      startedAt: byId.get(q.periodId)?.startedAt ?? null, endedAt: byId.get(q.periodId)?.endedAt ?? null })) };
  } catch (error) { return failure(error); }
}

/**
 * The lawyer's answer to an unknown-folder question: assigns the existing case to that period through the API, which
 * refuses a stale answer (a newer assignment of the period) instead of overwriting it.
 */
export async function answerQuestion(deps: SessionDeps, input: unknown): Promise<AnswerResult> {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i.questionId !== 'string' || !i.questionId || typeof i.caseId !== 'string' || !i.caseId) {
    return { status: 'error', error: 'invalid-request', message: 'questionId and caseId (from list_cases) are required' };
  }
  try {
    const question = (await getJson<any[]>(deps, '/questions')).find(q => q.questionId === i.questionId);
    if (!question) return { status: 'error', error: 'not-found', message: 'question not found' };
    const r = await postJson(deps, '/questions/answer', {
      questionId: question.questionId, sessionId: question.sessionId, periodId: question.periodId,
      expectedAssignmentRevision: question.expectedAssignmentRevision, caseId: i.caseId, responseCommandId: `chat-answer-${deps.newId()}`,
    });
    const body = await r.json().catch(() => null) as any;
    if (!r.ok) return { status: 'error', error: String(body?.error ?? `http-${r.status}`), message: String(body?.message ?? '') };
    return { status: 'answered', period: summary(body, await caseNames(deps)) };
  } catch (error) { return failure(error); }
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
