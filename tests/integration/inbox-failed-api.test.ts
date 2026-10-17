import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';
import { folderInbox } from '../../src/backend/adapters/inbox/folder';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'timekeeper-failed-'));
  const inbox = folderInbox(dir);
  const db = memoryDb();
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const app = createApp(db, { inbox });
  const call = async (path: string, method = 'GET') => {
    const response = await app.request(path, { method });
    return { status: response.status, body: await response.json() as any };
  };
  /** Writes a command file into the inbox and refuses it, as the synchronization does. */
  const fail = (name: string, content: string, error = { error: 'not-found', message: 'target session not found' }, mtime?: Date) => {
    writeFileSync(join(dir, name), content);
    inbox.markFailed(name, error);
    if (mtime) utimesSync(join(dir, 'failed', name), mtime, mtime);
  };
  return { dir, call, fail };
}

const end = (commandId: string, occurredAt: string) =>
  JSON.stringify({ kind: 'end', producerId: 'pipe', commandId, sessionId: 'session-1', occurredAt });

describe('failed inbox commands (docs/API.md A14)', () => {
  it('lists failed commands newest first, with the recorded error', async () => {
    const { call, fail } = fixture();
    fail('end-old.json', end('end-old', '2026-10-16T18:00:00Z'), undefined, new Date('2026-10-17T08:00:00Z'));
    fail('end-new.json', end('end-new', '2026-10-17T18:00:00Z'), { error: 'conflict', message: 'end before start' }, new Date('2026-10-18T08:00:00Z'));
    const { status, body } = await call('/api/inbox/failed');
    expect(status).toBe(200);
    expect(body).toEqual([
      { file: 'end-new.json', kind: 'end', sessionId: 'session-1', occurredAt: '2026-10-17T18:00:00Z', error: 'conflict', message: 'end before start' },
      { file: 'end-old.json', kind: 'end', sessionId: 'session-1', occurredAt: '2026-10-16T18:00:00Z', error: 'not-found', message: 'target session not found' },
    ]);
  });

  it('lists a file that was not valid JSON with null command fields', async () => {
    const { call, fail } = fixture();
    fail('broken.json', '{not json', { error: 'invalid-request', message: 'command file is not valid JSON' });
    expect((await call('/api/inbox/failed')).body).toEqual([
      { file: 'broken.json', kind: null, sessionId: null, occurredAt: null, error: 'invalid-request', message: 'command file is not valid JSON' },
    ]);
  });

  it('returns an empty list when nothing failed', async () => {
    const { call } = fixture();
    expect(await call('/api/inbox/failed')).toEqual({ status: 200, body: [] });
  });

  it('dismisses a failed command, idempotently, and keeps it in dismissed/', async () => {
    const { dir, call, fail } = fixture();
    fail('end-1.json', end('end-1', '2026-10-17T18:00:00Z'));
    expect(await call('/api/inbox/failed/end-1.json/dismiss', 'POST')).toEqual({ status: 200, body: { status: 'dismissed', file: 'end-1.json' } });
    expect((await call('/api/inbox/failed')).body).toEqual([]);
    expect(readdirSync(join(dir, 'dismissed')).sort()).toEqual(['end-1.error.json', 'end-1.json']);
    expect((await call('/api/inbox/failed/end-1.json/dismiss', 'POST')).status).toBe(200);
  });

  it('reports an unknown file as not found and refuses names outside the inbox', async () => {
    const { dir, call } = fixture();
    const unknown = await call('/api/inbox/failed/missing.json/dismiss', 'POST');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('not-found');
    for (const name of ['..%2Ftimekeeper.db', 'end-1.error.json', 'notes.txt', '%2E%2E.json']) {
      const result = await call(`/api/inbox/failed/${name}/dismiss`, 'POST');
      expect(result.status, name).toBe(400);
      expect(result.body.error).toBe('invalid-request');
    }
    expect(existsSync(join(dir, 'failed'))).toBe(true);
  });
});
