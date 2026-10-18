import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireWatchLock, releaseWatchLock, runningWatcher, sessionState } from '../../integrations/screenpipe/jev-check/session-bound.js';
import { startTabDetection } from '../../src/mcp/tab-detection.js';

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'tk-tab-')); dirs.push(d); return d; };
// Windows keeps a folder busy briefly while a process started in it exits.
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deadPid = 2 ** 22 - 3; // far above typical PID ranges

describe('watch lock', () => {
  it('allows one watcher, ignores stale locks, and releases only its own lock', () => {
    const lock = join(tempDir(), '.watch.pid');
    expect(runningWatcher(lock)).toBeNull();
    expect(acquireWatchLock(lock)).toEqual({ ok: true });
    expect(runningWatcher(lock)).toBe(process.pid);
    expect(acquireWatchLock(lock, process.pid + 1)).toEqual({ ok: false, pid: process.pid });
    releaseWatchLock(lock, process.pid + 1);
    expect(runningWatcher(lock)).toBe(process.pid);
    releaseWatchLock(lock);
    expect(runningWatcher(lock)).toBeNull();
    writeFileSync(lock, String(deadPid));
    expect(runningWatcher(lock)).toBeNull();
    expect(acquireWatchLock(lock)).toEqual({ ok: true });
  });
});

describe('session state for the watcher', () => {
  it('distinguishes active, ended, and unreachable (closed TimeKeeper keeps the session)', async () => {
    const at = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;
    expect(await sessionState('http://tk/api', at({ id: 's1', startedAt: 'x', endedAt: null }))).toEqual({ state: 'active', sessionId: 's1' });
    expect(await sessionState('http://tk/api', at(null))).toEqual({ state: 'ended' });
    expect(await sessionState('http://tk/api', at({ error: 'internal' }, 500))).toEqual({ state: 'unreachable' });
    const refused = (async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch;
    expect(await sessionState('http://tk/api', refused)).toEqual({ state: 'unreachable' });
  });
});

describe('startTabDetection', () => {
  const opts = (dir: string) => ({ enabled: true, bun: process.execPath, apiBase: 'http://tk/api', dir });

  it('is skipped when disabled', async () => {
    expect(await startTabDetection({ ...opts(tempDir()), enabled: false })).toEqual({ status: 'disabled' });
  });

  it('reports missing JEV configuration instead of starting a watcher that would fail', async () => {
    const saved = { key: process.env.TYPESAFE_API_KEY, fields: process.env.JEV_ALLOWED_FIELDS };
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_ALLOWED_FIELDS;
    try {
      const dir = tempDir();
      expect(await startTabDetection(opts(dir))).toMatchObject({ status: 'not_configured' });
      writeFileSync(join(dir, '.env'), 'TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=\n');
      expect(await startTabDetection(opts(dir))).toMatchObject({ status: 'not_configured' });
    } finally {
      if (saved.key !== undefined) process.env.TYPESAFE_API_KEY = saved.key;
      if (saved.fields !== undefined) process.env.JEV_ALLOWED_FIELDS = saved.fields;
    }
  });

  it('does not start a second watcher', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.watch.pid'), String(process.pid));
    expect(await startTabDetection(opts(dir))).toEqual({ status: 'already_running', pid: process.pid });
  });

  it('starts the watcher in the background with the session flag and API address', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n');
    // Stand-in for jev-check.ts (plain JS so both Node and Bun run it): records how it was started.
    writeFileSync(join(dir, 'jev-check.ts'),
      "require('node:fs').writeFileSync('started.json', JSON.stringify({ args: process.argv.slice(2), api: process.env.TIMEKEEPER_API_URL }));\n");
    const r = await startTabDetection(opts(dir));
    expect(r).toMatchObject({ status: 'started', log: join(dir, 'watch.log') });
    let started: any = null;
    // Process start can take several seconds while the whole suite runs in parallel.
    for (let i = 0; i < 400 && !started; i++) {
      try { started = JSON.parse(readFileSync(join(dir, 'started.json'), 'utf8')); } catch { await new Promise(res => setTimeout(res, 50)); }
    }
    expect(started).toEqual({ args: ['--session-bound', '--api', 'http://tk/api'], api: 'http://tk/api' });
    // Let the background process exit so the temporary folder can be removed.
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 100 && alive((r as any).pid); i++) await new Promise(res => setTimeout(res, 100));
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('on Windows, starts the watcher through WMI with the API address as an argument', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n');
    writeFileSync(join(dir, 'jev-check.ts'),
      "require('node:fs').writeFileSync('started.json', JSON.stringify({ args: process.argv.slice(2), ppid: process.ppid }));\n");
    const r = await startTabDetection({ ...opts(dir), launch: 'wmi' });
    expect(r).toMatchObject({ status: 'started', pid: expect.any(Number) });
    let started: any = null;
    for (let i = 0; i < 200 && !started; i++) {
      try { started = JSON.parse(readFileSync(join(dir, 'started.json'), 'utf8')); } catch { await new Promise(res => setTimeout(res, 50)); }
    }
    expect(started?.args).toEqual(['--session-bound', '--api', 'http://tk/api']);
    // Its parent is the hidden cmd.exe created by WMI, not this test process.
    expect(started?.ppid).toBe((r as any).pid);
    // Let the hidden process exit so the temporary folder can be removed.
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 100 && alive((r as any).pid); i++) await new Promise(res => setTimeout(res, 100));
  }, 30_000);
});
