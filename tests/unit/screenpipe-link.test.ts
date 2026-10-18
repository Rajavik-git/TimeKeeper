import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialLinkState, LINK_PRODUCER_ID, linkStatus, linkTick, readScreenpipe, saveLinkState,
  type LinkDeps, type LinkState, type ScreenpipeState } from '../../src/mcp/screenpipe-link.js';
import type { SessionDeps } from '../../src/mcp/session.js';

type Session = { id: string; startedAt: string; endedAt: string | null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** In-memory application API: one active session, idempotent start, end at the requested boundary. */
function harness(options: { active?: Session | null; openPeriodStart?: string } = {}) {
  const api = { up: true, active: options.active ?? null as Session | null, starts: [] as any[], ends: [] as any[], n: 0 };
  let clock = Date.parse('2026-10-18T08:00:00.000Z');
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (!api.up) throw new TypeError('fetch failed: connection refused');
    const path = url.replace('http://tk/api', '');
    if (path === '/health') return json({ status: 'ok' });
    if (path === '/sessions/active') return json(api.active);
    if (path === '/work-periods') {
      return json(api.active && options.openPeriodStart ? [{ id: 'p1', sessionId: api.active.id, caseId: null, startedAt: options.openPeriodStart, endedAt: null }] : []);
    }
    if (path === '/commands/start' && init?.method === 'POST') {
      const c = JSON.parse(String(init.body));
      api.starts.push(c);
      api.active ??= { id: c.sessionId, startedAt: c.occurredAt, endedAt: null };
      return json({ status: 'applied', sessionId: api.active.id, startedAt: api.active.startedAt, endedAt: null });
    }
    if (path === '/commands/end' && init?.method === 'POST') {
      const c = JSON.parse(String(init.body));
      api.ends.push(c);
      const ended = { ...api.active!, endedAt: c.occurredAt };
      api.active = null;
      return json({ status: 'applied', sessionId: ended.id, startedAt: ended.startedAt, endedAt: ended.endedAt });
    }
    return json({ error: 'not-found' }, 404);
  }) as typeof fetch;
  const session: SessionDeps = {
    apiBase: 'http://tk/api', fetch: fetchImpl, now: () => new Date(clock),
    newId: () => `2026-10-18-${String(++api.n).padStart(8, '0')}`, sleep: async () => {}, readyTimeoutMs: 0,
  };
  let screenpipe: ScreenpipeState = { running: false };
  const deps: LinkDeps = { session, readScreenpipe: async () => screenpipe, graceMs: 60_000, log: () => {} };
  const at = (iso: string) => { clock = Date.parse(iso); };
  const run = (engineStartedAt: string) => { screenpipe = { running: true, engineStartedAt }; };
  const stop = () => { screenpipe = { running: false }; };
  return { api, deps, at, run, stop };
}

const ENGINE_1 = '2026-10-18T07:59:00.000Z';

describe('Screenpipe session link', () => {
  it('starts a session when Screenpipe starts, once per Screenpipe run', async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    expect(h.api.starts).toHaveLength(1);
    expect(h.api.starts[0]).toMatchObject({ producerId: LINK_PRODUCER_ID, occurredAt: '2026-10-18T08:00:00.000Z' });
    expect(s).toMatchObject({ started: true, engineStartedAt: ENGINE_1, lastRunningAt: '2026-10-18T08:00:00.000Z' });

    // The lawyer ends the session with the End button while Screenpipe keeps recording: no new session.
    h.api.active = null;
    h.at('2026-10-18T09:00:00.000Z');
    s = await linkTick(h.deps, s);
    expect(h.api.starts).toHaveLength(1);
  });

  it('leaves an active session unchanged when Screenpipe starts', async () => {
    const active = { id: 'session-kept', startedAt: '2026-10-18T07:00:00.000Z', endedAt: null };
    const h = harness({ active });
    h.run(ENGINE_1);
    const s = await linkTick(h.deps, initialLinkState());
    expect(h.api.starts).toHaveLength(0);
    expect(h.api.active).toEqual(active);
    expect(s.started).toBe(true);
  });

  it('ends the session at the last time Screenpipe was running, only after the grace period', async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    h.at('2026-10-18T12:00:00.000Z');
    s = await linkTick(h.deps, s);

    h.stop();
    h.at('2026-10-18T12:00:30.000Z');
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(0);

    h.at('2026-10-18T12:01:10.000Z');
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toEqual([expect.objectContaining({ producerId: LINK_PRODUCER_ID, occurredAt: '2026-10-18T12:00:00.000Z' })]);
    expect(s).toMatchObject({ ended: true, started: false });

    h.at('2026-10-18T12:05:00.000Z');
    await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(1);
  });

  it('keeps the session through a short Screenpipe restart', async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    h.stop();
    h.at('2026-10-18T08:00:30.000Z');
    s = await linkTick(h.deps, s);
    h.run('2026-10-18T08:00:40.000Z');
    h.at('2026-10-18T08:00:50.000Z');
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(0);
    expect(h.api.starts).toHaveLength(1);
    expect(s).toMatchObject({ started: true, engineStartedAt: '2026-10-18T08:00:40.000Z' });
  });

  it('after a stop it did not see (reboot), ends the old session at its last time and starts a new one', async () => {
    const active = { id: 'session-yesterday', startedAt: '2026-10-17T08:00:00.000Z', endedAt: null };
    const h = harness({ active });
    const saved: LinkState = { engineStartedAt: '2026-10-17T07:59:00.000Z', started: true, lastRunningAt: '2026-10-17T18:30:00.000Z', ended: false };
    h.run(ENGINE_1);
    const s = await linkTick(h.deps, saved);
    expect(h.api.ends).toEqual([expect.objectContaining({ sessionId: 'session-yesterday', occurredAt: '2026-10-17T18:30:00.000Z' })]);
    expect(h.api.starts).toHaveLength(1);
    expect(s).toMatchObject({ started: true, engineStartedAt: ENGINE_1 });
  });

  it('never ends a session that started after Screenpipe was last seen', async () => {
    const active = { id: 'session-from-button', startedAt: '2026-10-18T12:05:00.000Z', endedAt: null };
    const h = harness({ active });
    const saved: LinkState = { engineStartedAt: ENGINE_1, started: true, lastRunningAt: '2026-10-18T12:00:00.000Z', ended: false };
    h.at('2026-10-18T12:10:00.000Z');
    const s = await linkTick(h.deps, saved);
    expect(h.api.ends).toHaveLength(0);
    expect(h.api.active).toEqual(active);
    expect(s.ended).toBe(true);
  });

  it('does not end before the open work period, which the API would refuse', async () => {
    const active = { id: 'session-1', startedAt: '2026-10-18T08:00:00.000Z', endedAt: null };
    const h = harness({ active, openPeriodStart: '2026-10-18T12:00:05.000Z' });
    const saved: LinkState = { engineStartedAt: ENGINE_1, started: true, lastRunningAt: '2026-10-18T12:00:00.000Z', ended: false };
    h.at('2026-10-18T12:10:00.000Z');
    await linkTick(h.deps, saved);
    expect(h.api.ends[0].occurredAt).toBe('2026-10-18T12:00:05.000Z');
  });

  it('retries start and end while TimeKeeper is closed, keeping the end boundary', async () => {
    const h = harness();
    h.api.up = false;
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    expect(s.started).toBe(false);
    h.api.up = true;
    h.at('2026-10-18T08:00:10.000Z');
    s = await linkTick(h.deps, s);
    expect(s.started).toBe(true);

    h.stop();
    h.api.up = false;
    h.at('2026-10-18T09:00:00.000Z');
    s = await linkTick(h.deps, s);
    expect(s.ended).toBe(false);
    h.api.up = true;
    h.at('2026-10-18T09:30:00.000Z');
    s = await linkTick(h.deps, s);
    expect(h.api.ends[0].occurredAt).toBe('2026-10-18T08:00:10.000Z');
    expect(s.ended).toBe(true);
  });
});

describe('linkStatus', () => {
  it('reports the link as running only while it keeps writing its state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tk-link-'));
    try {
      const path = join(dir, 'screenpipe-link.json');
      expect(linkStatus(path, new Date())).toMatchObject({ running: false, lastCheckAt: null, screenpipeLastSeenRunningAt: null });
      saveLinkState(path, { engineStartedAt: ENGINE_1, started: true, lastRunningAt: '2026-10-18T08:00:00.000Z', ended: false });
      expect(linkStatus(path, new Date())).toMatchObject({ running: true, screenpipeLastSeenRunningAt: '2026-10-18T08:00:00.000Z',
        sessionStartDelivered: true, sessionEndDelivered: false });
      expect(linkStatus(path, new Date(Date.now() + 60_000)).running).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readScreenpipe', () => {
  const at = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;
  it('treats a reachable engine as running unless capture is stopped', async () => {
    expect(await readScreenpipe('http://sp', at({ capture_status: { status: 'recording' }, startup: { engine_started_at: 1792311134 } })))
      .toEqual({ running: true, engineStartedAt: new Date(1792311134 * 1000).toISOString() });
    expect(await readScreenpipe('http://sp', at({ capture_status: { status: 'paused' } }))).toEqual({ running: true, engineStartedAt: null });
    expect(await readScreenpipe('http://sp', at({ status: 'unhealthy' }, 503))).toEqual({ running: true, engineStartedAt: null });
    expect(await readScreenpipe('http://sp', at({ capture_status: { status: 'stopped' } }))).toEqual({ running: false });
    const refused = (async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch;
    expect(await readScreenpipe('http://sp', refused)).toEqual({ running: false });
  });
});
