import { describe, expect, it } from 'vitest';
import { ensureSession, getStatus, PRODUCER_ID, type SessionDeps } from '../../src/mcp/session.js';
import type { AddressInfo } from 'node:net';
import { handle, serveHttp } from '../../src/mcp/server.js';

type Session = { id: string; startedAt: string; endedAt: string | null };

/** In-memory stand-in for the application API: one active session, idempotent start (src/backend/application/service.ts). */
function fakeApi(options: { up?: boolean; active?: Session | null; startStatus?: number; failStart?: boolean } = {}) {
  const state = { up: options.up ?? true, active: options.active ?? null as Session | null, starts: [] as any[], launches: 0 };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (!state.up) throw new TypeError('fetch failed: connection refused');
    const path = url.replace('http://tk/api', '');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/health') return json({ status: 'ok' });
    if (path === '/sessions/active') return json(state.active);
    if (path === '/commands/start' && init?.method === 'POST') {
      const command = JSON.parse(String(init.body));
      state.starts.push(command);
      if (options.failStart) throw new TypeError('socket hang up');
      if (options.startStatus === 202) return json({ status: 'pending', commandId: command.commandId }, 202);
      if (options.startStatus) return json({ error: 'conflict', message: 'session ID already ended' }, options.startStatus);
      state.active ??= { id: command.sessionId, startedAt: command.occurredAt, endedAt: null };
      return json({ status: 'applied', sessionId: state.active.id, startedAt: state.active.startedAt, endedAt: null });
    }
    return json({ error: 'not-found', message: 'route' }, 404);
  }) as typeof fetch;
  let clock = Date.parse('2026-10-17T09:00:00.000Z');
  const deps: SessionDeps = {
    apiBase: 'http://tk/api',
    fetch: fetchImpl,
    now: () => new Date(clock),
    newId: () => '2026-10-17-abcd1234',
    sleep: async ms => { clock += ms; },
    readyTimeoutMs: 5000,
  };
  return { state, deps };
}

describe('start_session', () => {
  it('starts a session when TimeKeeper runs and none is active', async () => {
    const { state, deps } = fakeApi();
    const r = await ensureSession(deps);
    expect(r).toMatchObject({ status: 'started', started: true, launched: false,
      session: { id: 'session-2026-10-17-abcd1234', startedAt: '2026-10-17T09:00:00.000Z' } });
    expect(state.starts).toEqual([{ producerId: PRODUCER_ID, commandId: 'start-2026-10-17-abcd1234',
      sessionId: 'session-2026-10-17-abcd1234', occurredAt: '2026-10-17T09:00:00.000Z' }]);
  });

  it('does nothing when a session is already active', async () => {
    const active = { id: 'session-morning', startedAt: '2026-10-17T08:00:00.000Z', endedAt: null };
    const { state, deps } = fakeApi({ active });
    const r = await ensureSession(deps);
    expect(r).toEqual({ status: 'already_active', started: false, session: active });
    expect(state.starts).toHaveLength(0);
  });

  it('a second press returns the same session without a new start', async () => {
    const { state, deps } = fakeApi();
    const first = await ensureSession(deps);
    const second = await ensureSession(deps);
    expect(second).toMatchObject({ status: 'already_active', session: { id: (first as any).session.id } });
    expect(state.starts).toHaveLength(1);
  });

  it('reports a race where another start won as already active', async () => {
    const { state, deps } = fakeApi();
    const realFetch = deps.fetch;
    deps.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/commands/start')) state.active = { id: 'session-other', startedAt: '2026-10-17T08:59:59.000Z', endedAt: null };
      return realFetch(url, init);
    }) as typeof fetch;
    expect(await ensureSession(deps)).toMatchObject({ status: 'already_active', session: { id: 'session-other' } });
  });

  it('does not start or claim success when TimeKeeper is closed and no launch command exists', async () => {
    const { state, deps } = fakeApi({ up: false });
    expect(await ensureSession(deps)).toMatchObject({ status: 'timekeeper_not_running', started: false });
    expect(state.starts).toHaveLength(0);
  });

  it('launches TimeKeeper, waits for readiness, and keeps the press time as start boundary', async () => {
    const { state, deps } = fakeApi({ up: false });
    deps.launch = async () => { state.launches++; };
    const sleep = deps.sleep;
    let waited = 0;
    deps.sleep = async ms => { await sleep(ms); if (++waited === 3) state.up = true; }; // ready after ~3 s
    const r = await ensureSession(deps);
    expect(state.launches).toBe(1);
    expect(waited).toBe(3);
    expect(r).toMatchObject({ status: 'started', launched: true, session: { startedAt: '2026-10-17T09:00:00.000Z' } });
  });

  it('gives up when a launched TimeKeeper never becomes ready', async () => {
    const { state, deps } = fakeApi({ up: false });
    deps.launch = async () => { state.launches++; };
    expect(await ensureSession(deps)).toMatchObject({ status: 'timekeeper_not_running', started: false });
    expect(state.starts).toHaveLength(0);
  });

  it('reports pending, API errors, and lost answers without claiming a session', async () => {
    expect(await ensureSession(fakeApi({ startStatus: 202 }).deps)).toMatchObject({ status: 'pending', started: false });
    expect(await ensureSession(fakeApi({ startStatus: 409 }).deps)).toMatchObject({ status: 'error', error: 'conflict', started: false });
    expect(await ensureSession(fakeApi({ failStart: true }).deps)).toMatchObject({ status: 'unconfirmed', started: false });
  });
});

describe('timekeeper_status', () => {
  it('reports running with the active session, or not running', async () => {
    const active = { id: 's1', startedAt: '2026-10-17T08:00:00.000Z', endedAt: null };
    expect(await getStatus(fakeApi({ active }).deps)).toEqual({ timekeeper: 'running', activeSession: active });
    expect(await getStatus(fakeApi({ up: false }).deps)).toEqual({ timekeeper: 'not_running', activeSession: null });
  });
});

describe('MCP protocol', () => {
  const call = (deps: SessionDeps, method: string, params?: Record<string, unknown>) => handle({ jsonrpc: '2.0', id: 1, method, params }, deps);

  it('initializes and lists both tools', async () => {
    const { deps } = fakeApi();
    expect(await call(deps, 'initialize')).toMatchObject({ result: { capabilities: { tools: {} }, serverInfo: { name: 'timekeeper' } } });
    const list: any = await call(deps, 'tools/list');
    expect(list.result.tools.map((t: any) => t.name)).toEqual(['timekeeper_status', 'start_session']);
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps)).toBeNull();
  });

  it('start_session returns the result as text and flags non-running outcomes as errors', async () => {
    const ok: any = await call(fakeApi().deps, 'tools/call', { name: 'start_session', arguments: {} });
    expect(ok.result.isError).toBe(false);
    expect(JSON.parse(ok.result.content[0].text)).toMatchObject({ status: 'started' });
    const down: any = await call(fakeApi({ up: false }).deps, 'tools/call', { name: 'start_session', arguments: {} });
    expect(down.result.isError).toBe(true);
    expect(JSON.parse(down.result.content[0].text)).toMatchObject({ status: 'timekeeper_not_running' });
  });

  it('serves the same tools over loopback HTTP and rejects foreign origins', async () => {
    const server = serveHttp(0, fakeApi().deps);
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    try {
      const post = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const r = await post({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'start_session', arguments: {} } });
      const json: any = await r.json();
      expect(json.id).toBe(7);
      expect(JSON.parse(json.result.content[0].text)).toMatchObject({ status: 'started' });
      expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
      expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await fetch(url)).status).toBe(405);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('rejects unknown tools and methods', async () => {
    const { deps } = fakeApi();
    expect(await call(deps, 'tools/call', { name: 'end_session' })).toMatchObject({ error: { code: -32602 } });
    expect(await call(deps, 'resources/list')).toMatchObject({ error: { code: -32601 } });
  });
});
