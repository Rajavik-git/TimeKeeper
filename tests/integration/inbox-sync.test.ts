import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { TimeKeeperService } from '../../src/backend/application/service.js';
import { folderInbox, inboxDir } from '../../src/backend/adapters/inbox/folder.js';
import { syncInbox } from '../../src/backend/workers/inbox-sync.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'timekeeper-inbox-'));
  const repo = new SqliteRepository(new DatabaseSync(':memory:'));
  cleanups.push(() => { repo.close(); rmSync(dir, { recursive: true, force: true }); });
  const service = new TimeKeeperService(repo, { now: () => '2026-10-18T09:00:00Z' });
  const inbox = folderInbox(dir);
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  const files = (folder = '') => readdirSync(join(dir, folder)).filter(name => name.endsWith('.json')).sort();
  return { dir, service, write, files, sync: () => syncInbox(inbox, service) };
}

const start = { kind: 'start', producerId: 'pipe', commandId: 'start-1', sessionId: 's1', occurredAt: '2026-10-17T09:00:00Z' };
const end = { kind: 'end', producerId: 'pipe', commandId: 'end-1', sessionId: 's1', occurredAt: '2026-10-17T18:00:00Z', prerequisiteCommandId: 'start-1' };
const { kind: _s, ...startPayload } = start;

describe('inbox synchronization (docs/API.md D8)', () => {
  it('applies an end pressed while TimeKeeper was closed, at its original time', () => {
    const { service, write, files, sync } = fixture();
    service.start(startPayload);
    write('end-1.json', end);
    expect(sync()).toEqual({ applied: ['end-1.json'], pending: [], failed: [], retry: [] });
    expect(service.getSession('s1').endedAt).toBe('2026-10-17T18:00:00Z');
    expect(files()).toEqual([]);
    expect(files('done')).toEqual(['end-1.json']);
  });

  it('applies files in order of their original time, whatever their names', () => {
    const { service, write, sync } = fixture();
    write('a-end.json', end);
    write('z-start.json', start);
    expect(sync().applied).toEqual(['z-start.json', 'a-end.json']);
    expect(service.getSession('s1')).toMatchObject({ startedAt: '2026-10-17T09:00:00Z', endedAt: '2026-10-17T18:00:00Z' });
  });

  it('keeps an end waiting for its start, then applies both when the start arrives', () => {
    const { service, write, files, sync } = fixture();
    write('end-1.json', end);
    expect(sync().pending).toEqual(['end-1.json']);
    expect(files()).toEqual(['end-1.json']);
    write('start-1.json', start);
    const result = sync();
    expect(result.applied).toEqual(['start-1.json', 'end-1.json']);
    expect(result.pending).toEqual([]);
    expect(service.getSession('s1').endedAt).toBe('2026-10-17T18:00:00Z');
    expect(files()).toEqual([]);
  });

  it('applies a duplicated command once', () => {
    const { service, write, files, sync } = fixture();
    service.start(startPayload);
    write('end-1.json', end);
    write('end-1-copy.json', end);
    expect(sync().applied).toHaveLength(2);
    expect(service.getSession('s1').endedAt).toBe('2026-10-17T18:00:00Z');
    expect(files('done')).toEqual(['end-1-copy.json', 'end-1.json']);
  });

  it('finishes cleanly after a crash between applying a command and moving its file', () => {
    const { service, write, sync } = fixture();
    service.start(startPayload);
    const { kind: _e, ...endPayload } = end;
    service.end(endPayload);
    write('end-1.json', end);
    expect(sync().applied).toEqual(['end-1.json']);
    expect(service.getSession('s1').endedAt).toBe('2026-10-17T18:00:00Z');
  });

  it('moves invalid and refused commands to failed/ with their error', () => {
    const { dir, write, files, sync } = fixture();
    write('broken.json', '{not json');
    write('no-kind.json', { ...end, kind: 'pause' });
    write('unknown-session.json', { ...end, commandId: 'end-x', sessionId: 'absent', prerequisiteCommandId: undefined });
    const result = sync();
    expect(result.failed.sort()).toEqual(['broken.json', 'no-kind.json', 'unknown-session.json']);
    expect(files()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'failed', 'broken.error.json'), 'utf8'))).toMatchObject({ error: 'invalid-request' });
    expect(JSON.parse(readFileSync(join(dir, 'failed', 'unknown-session.error.json'), 'utf8')).error).toMatch(/not-found|no-active-session/);
  });

  it('ignores files still being written', () => {
    const { write, files, sync } = fixture();
    write('end-1.json.tmp', end);
    expect(sync()).toEqual({ applied: [], pending: [], failed: [], retry: [] });
    expect(files()).toEqual([]);
  });

  it('places the inbox next to the database unless TIMEKEEPER_INBOX is set', () => {
    expect(inboxDir({ TIMEKEEPER_DB: '/app/data/timekeeper.db' }, '/')).toBe(resolve('/app/data', 'inbox'));
    expect(inboxDir({ TIMEKEEPER_INBOX: '/elsewhere/inbox' }, '/')).toBe(resolve('/elsewhere/inbox'));
  });

  it('refuses an end whose time is before its start, and records why', () => {
    const { dir, write, sync } = fixture();
    write('end-1.json', end);
    write('start-1.json', { ...start, occurredAt: '2026-10-17T19:00:00Z' });
    const result = sync();
    expect(result.applied).toEqual(['start-1.json']);
    expect(result.failed).toEqual(['end-1.json']);
    expect(JSON.parse(readFileSync(join(dir, 'failed', 'end-1.error.json'), 'utf8'))).toMatchObject({ error: 'conflict' });
  });
});
