// MCP tools against the real application API (Hono app, SQLite in memory, application services).
import { describe, expect, it } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository.js';
import { createApp } from '../../src/backend/api/app.js';
import { ensureSession, getStatus, type SessionDeps } from '../../src/mcp/session.js';
import { answerQuestion, endSession, listCases, listQuestions, listWorkPeriods, recordCaseTransition } from '../../src/mcp/workflow.js';

function realApi() {
  const app = createApp(memoryDb());
  let clock = Date.parse('2026-10-17T09:00:00.000Z');
  let n = 0;
  const deps: SessionDeps = {
    apiBase: 'http://tk/api',
    fetch: ((url: string, init?: RequestInit) => app.request(String(url).replace('http://tk', ''), init)) as typeof fetch,
    now: () => new Date(clock),
    newId: () => `test-${++n}`,
    sleep: async () => {},
  };
  return { app, deps, at: (iso: string) => { clock = Date.parse(iso); } };
}

const periods = async (app: ReturnType<typeof createApp>, sessionId: string) =>
  (await (await app.request('/api/work-periods')).json() as any[]).filter(p => p.sessionId === sessionId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

describe('MCP workflow against the application API', () => {
  it('start, record JEV transitions, ask about an unknown folder, end, and refuse stale writes', async () => {
    const { app, deps, at } = realApi();

    // The demo seed leaves yesterday's session active: the End button ends it first.
    at('2026-10-17T08:00:00.000Z');
    expect(await endSession(deps)).toMatchObject({ status: 'ended', session: { id: 'demo-2026-10-16', endedAt: '2026-10-17T08:00:00.000Z' } });
    at('2026-10-17T09:00:00.000Z');

    // Start button: one session, a second press changes nothing.
    const start = await ensureSession(deps);
    expect(start.status).toBe('started');
    const sessionId = (start as any).session.id as string;
    expect(await ensureSession(deps)).toMatchObject({ status: 'already_active', session: { id: sessionId } });

    // Candidates come from the canonical case table.
    const cases = await listCases(deps);
    expect(cases.length).toBeGreaterThanOrEqual(2);
    expect(cases[0]).toEqual({ id: expect.any(String), clientId: expect.any(String), clientName: expect.any(String),
      reference: expect.any(String), title: expect.any(String) });
    const [a, b] = cases;

    // JEV confirmed a change to case A, then stayed on A, then moved to B.
    const toA = await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:05:00.000Z', caseId: a!.id });
    expect(toA).toMatchObject({ status: 'applied', period: { caseId: a!.id, startedAt: '2026-10-17T09:05:00.000Z' }, questionId: null });
    expect(await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:07:00.000Z', caseId: a!.id }))
      .toMatchObject({ status: 'no_change', reason: 'same_case' });
    const toB = await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:20:00.000Z', caseId: b!.id });
    expect(toB).toMatchObject({ status: 'applied', period: { caseId: b!.id } });

    // Unknown folder: unresolved period and a question for the lawyer.
    const unknown = await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:40:00.000Z', caseId: null });
    expect(unknown).toMatchObject({ status: 'applied', period: { caseId: null } });
    const questionId = (unknown as any).questionId;
    const questions = await (await app.request('/api/questions')).json() as any[];
    expect(questions).toContainEqual(expect.objectContaining({ questionId, status: 'pending', sessionId }));

    // A retried call has no further effect; a delayed result older than the open period is refused.
    expect(await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:40:00.000Z', caseId: null }))
      .toMatchObject({ status: 'applied', period: { id: (unknown as any).period.id } });
    expect(await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:30:00.000Z', caseId: a!.id }))
      .toMatchObject({ status: 'stale', reason: 'newer_period' });
    expect(await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:50:00.000Z', caseId: 'no-such-case' }))
      .toMatchObject({ status: 'error', error: 'not-found' });

    // Periods follow the transitions: each one closes the previous at the new capture time.
    const ps = await periods(app, sessionId);
    expect(ps.map(p => [p.caseId, p.startedAt, p.endedAt])).toEqual([
      [a!.id, '2026-10-17T09:05:00.000Z', '2026-10-17T09:20:00.000Z'],
      [b!.id, '2026-10-17T09:20:00.000Z', '2026-10-17T09:40:00.000Z'],
      [null, '2026-10-17T09:40:00.000Z', null],
    ]);
    expect(await getStatus(deps)).toMatchObject({ activeSession: { id: sessionId }, activePeriod: { caseId: null } });

    // End button: ends the session at the press time and closes the open period there.
    at('2026-10-17T10:00:00.000Z');
    const end = await endSession(deps);
    expect(end).toMatchObject({ status: 'ended', ended: true, session: { id: sessionId, endedAt: '2026-10-17T10:00:00.000Z' } });
    expect((await periods(app, sessionId)).at(-1)?.endedAt).toBe('2026-10-17T10:00:00.000Z');
    expect(await endSession(deps)).toMatchObject({ status: 'no_active_session', ended: false });

    // Results arriving after the end change nothing; the next start is a new session.
    expect(await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:55:00.000Z', caseId: a!.id }))
      .toMatchObject({ status: 'stale', reason: 'session_not_active' });
    at('2026-10-17T11:00:00.000Z');
    const again = await ensureSession(deps);
    expect(again).toMatchObject({ status: 'started' });
    expect((again as any).session.id).not.toBe(sessionId);
  });

  it('lists periods and questions, answers a question, refuses a stale answer, and ends at a known earlier time', async () => {
    const { deps, at } = realApi();
    at('2026-10-17T08:00:00.000Z');
    await endSession(deps);
    at('2026-10-17T09:00:00.000Z');
    const sessionId = ((await ensureSession(deps)) as any).session.id as string;
    const [a, b] = await listCases(deps);

    await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:05:00.000Z', caseId: a!.id });
    const unknown = await recordCaseTransition(deps, { sessionId, transitionAt: '2026-10-17T09:30:00.000Z', caseId: null }) as any;

    const listed = await listWorkPeriods(deps);
    expect(listed).toMatchObject({ status: 'ok', session: { id: sessionId } });
    expect((listed as any).periods).toEqual([
      expect.objectContaining({ caseId: a!.id, case: `${a!.reference} - ${a!.title}`, startedAt: '2026-10-17T09:05:00.000Z', endedAt: '2026-10-17T09:30:00.000Z', timeValidated: false }),
      expect.objectContaining({ caseId: null, case: null, startedAt: '2026-10-17T09:30:00.000Z', endedAt: null, assignmentRevision: 0 }),
    ]);
    const pending = await listQuestions(deps);
    expect(pending).toMatchObject({ status: 'ok', questions: [{ questionId: unknown.questionId, status: 'pending', startedAt: '2026-10-17T09:30:00.000Z' }] });

    // The lawyer's answer assigns the chosen case; answering again with another case is refused.
    expect(await answerQuestion(deps, { questionId: unknown.questionId, caseId: b!.id }))
      .toMatchObject({ status: 'answered', period: { id: unknown.period.id, caseId: b!.id, case: `${b!.reference} - ${b!.title}`, assignmentRevision: 1 } });
    expect(await answerQuestion(deps, { questionId: unknown.questionId, caseId: a!.id })).toMatchObject({ status: 'error', error: 'conflict' });
    expect(await listQuestions(deps)).toMatchObject({ questions: [] });
    expect(await answerQuestion(deps, { questionId: 'nope', caseId: a!.id })).toMatchObject({ status: 'error', error: 'not-found' });

    // Screenpipe session link: an end at a known earlier time never goes before the open period.
    at('2026-10-17T12:00:00.000Z');
    expect(await endSession(deps, undefined, { producerId: 'screenpipe-session-link', at: '2026-10-17T09:10:00.000Z' }))
      .toMatchObject({ status: 'ended', session: { id: sessionId, endedAt: '2026-10-17T09:30:00.000Z' } });
    // With no active session, the most recent one is listed.
    expect(await listWorkPeriods(deps)).toMatchObject({ session: { id: sessionId } });
  });

  it('rejects malformed transitions without calling the API', async () => {
    const { deps } = realApi();
    expect(await recordCaseTransition(deps, { sessionId: 's', transitionAt: 'yesterday', caseId: null })).toMatchObject({ status: 'error', error: 'invalid-request' });
    expect(await recordCaseTransition(deps, { sessionId: 's', transitionAt: '2026-10-17T09:00:00Z', caseId: 7 })).toMatchObject({ status: 'error', error: 'invalid-request' });
  });

  it('reports a closed TimeKeeper without claiming an end', async () => {
    const { deps } = realApi();
    deps.fetch = (async () => { throw new TypeError('connection refused'); }) as typeof fetch;
    expect(await endSession(deps)).toMatchObject({ status: 'timekeeper_not_running', ended: false });
    expect(await recordCaseTransition(deps, { sessionId: 's', transitionAt: '2026-10-17T09:00:00Z', caseId: null })).toMatchObject({ status: 'timekeeper_not_running' });
  });
});
