import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { TimeKeeperService } from '../../src/backend/application/service.js';
import { catchUpRecordings } from '../../src/backend/workers/recording-catchup.js';
import type { MemoryObservation, ScreenpipeMemory } from '../../src/backend/ports/index.js';

const repos: SqliteRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.close(); });

function fixture() {
  const repo = new SqliteRepository(new DatabaseSync(':memory:')); repos.push(repo);
  let now = '2026-10-17T13:00:00.000Z';
  const created = '2026-10-17T08:00:00Z';
  repo.db.prepare('INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('client', 'Fictional Client', created, created);
  for (const id of ['A', 'B']) repo.db.prepare('INSERT INTO cases(id,client_id,reference,title,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, 'client', id, `Fictional ${id}`, created, created);
  const service = new TimeKeeperService(repo, { now: () => now });
  service.start({ producerId: 'pipe', commandId: 'start', sessionId: 's1', occurredAt: '2026-10-17T09:00:00Z' });
  service.openPeriod({ id: 'p-a', sessionId: 's1', caseId: 'A', startedAt: '2026-10-17T09:00:00Z', origin: 'automatic', mode: 'current' });
  service.openPeriod({ id: 'p-b', sessionId: 's1', caseId: 'B', startedAt: '2026-10-17T10:00:00Z', origin: 'automatic', mode: 'current' });
  const sourcesOf = () => repo.db.prepare('SELECT external_id AS id, work_period_id AS period FROM sources ORDER BY recorded_at').all();
  return { repo, service, sourcesOf, setNow: (value: string) => { now = value; } };
}

const at = (externalId: string, recordedAt: string): MemoryObservation =>
  ({ instanceId: 'laptop', contentType: 'ocr', externalId, recordedAt: new Date(recordedAt).toISOString() });

/** A stand-in for the Screenpipe adapter: returns the observations inside the requested window, or fails on demand. */
function memory(observations: MemoryObservation[], failOnCall?: number): ScreenpipeMemory & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async read(startAt, endAt) {
      calls.push(`${startAt}..${endAt}`);
      if (failOnCall === calls.length) throw new Error('Screenpipe is not reachable at http://localhost:3030');
      return observations.filter(o => o.recordedAt >= startAt && o.recordedAt <= endAt);
    },
  };
}

describe('catching up missed recordings (docs/API.md D8 step 4)', () => {
  it('reads an ended session in one-hour windows and attaches each reference to its period', async () => {
    const { service, sourcesOf } = fixture();
    service.end({ producerId: 'pipe', commandId: 'end', sessionId: 's1', occurredAt: '2026-10-17T12:00:00Z' });
    const m = memory([at('f1', '2026-10-17T09:30:00Z'), at('f2', '2026-10-17T10:30:00Z'), at('f3', '2026-10-17T11:59:00Z')]);
    const result = await catchUpRecordings(m, service, 'laptop', '2026-10-17T13:00:00.000Z');
    expect(result).toEqual({ windows: 3, imported: 3, unchanged: 0, skipped: 0 });
    expect(m.calls).toEqual(['2026-10-17T09:00:00.000Z..2026-10-17T10:00:00.000Z', '2026-10-17T10:00:00.000Z..2026-10-17T11:00:00.000Z',
      '2026-10-17T11:00:00.000Z..2026-10-17T12:00:00.000Z']);
    expect(sourcesOf()).toEqual([{ id: 'f1', period: 'p-a' }, { id: 'f2', period: 'p-b' }, { id: 'f3', period: 'p-b' }]);
    expect(service.coverageGaps()).toEqual([]);
    expect((await catchUpRecordings(m, service, 'laptop', '2026-10-17T14:00:00.000Z')).windows).toBe(0);
  });

  it('continues an active session from its checkpoint, re-reading the last five minutes', async () => {
    const { service } = fixture();
    const m = memory([at('f1', '2026-10-17T10:27:00Z'), at('f2', '2026-10-17T10:45:00Z')]);
    await catchUpRecordings(m, service, 'laptop', '2026-10-17T10:30:00.000Z');
    const second = await catchUpRecordings(m, service, 'laptop', '2026-10-17T11:00:00.000Z');
    expect(m.calls.at(-1)).toBe('2026-10-17T10:25:00.000Z..2026-10-17T11:00:00.000Z');
    expect(second).toEqual({ windows: 1, imported: 1, unchanged: 1, skipped: 0 });
  });

  it('marks a failed read as a coverage gap, stops, and closes the gap on a later successful run', async () => {
    const { service } = fixture();
    service.end({ producerId: 'pipe', commandId: 'end', sessionId: 's1', occurredAt: '2026-10-17T12:00:00Z' });
    const failing = await catchUpRecordings(memory([at('f1', '2026-10-17T10:30:00Z')], 2), service, 'laptop', '2026-10-17T13:00:00.000Z');
    expect(failing).toMatchObject({ windows: 1, stoppedBy: 'Screenpipe is not reachable at http://localhost:3030' });
    expect(service.coverageGaps()).toEqual([expect.objectContaining({ sessionId: 's1', startedAt: '2026-10-17T10:00:00.000Z', status: 'failed' })]);
    const m = memory([at('f1', '2026-10-17T10:30:00Z')]);
    const retry = await catchUpRecordings(m, service, 'laptop', '2026-10-17T14:00:00.000Z');
    // Restarts five minutes before the checkpoint (10:00), so the windows no longer line up with the failed one.
    expect(m.calls[0]).toBe('2026-10-17T09:55:00.000Z..2026-10-17T10:55:00.000Z');
    expect(retry).toEqual({ windows: 3, imported: 1, unchanged: 0, skipped: 0 });
    expect(service.coverageGaps()).toEqual([]);
  });

  it('keeps an existing reference attached elsewhere instead of moving it', async () => {
    const { service, sourcesOf } = fixture();
    service.end({ producerId: 'pipe', commandId: 'end', sessionId: 's1', occurredAt: '2026-10-17T12:00:00Z' });
    service.importSource({ id: 'manual', periodId: null, instanceId: 'laptop', contentType: 'ocr', externalId: 'f1', recordedAt: '2026-10-17T09:30:00.000Z' });
    const result = await catchUpRecordings(memory([at('f1', '2026-10-17T09:30:00Z')]), service, 'laptop', '2026-10-17T13:00:00.000Z');
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(sourcesOf()).toEqual([{ id: 'f1', period: null }]);
  });

  it('catches up the newest session before older ones', async () => {
    const { service } = fixture();
    service.end({ producerId: 'pipe', commandId: 'end', sessionId: 's1', occurredAt: '2026-10-17T12:00:00Z' });
    service.start({ producerId: 'pipe', commandId: 'start-2', sessionId: 's2', occurredAt: '2026-10-17T14:00:00Z' });
    const m = memory([]);
    await catchUpRecordings(m, service, 'laptop', '2026-10-17T14:30:00.000Z', { windowMs: 60 * 60_000, overlapMs: 5 * 60_000, maxWindows: 2 });
    expect(m.calls).toEqual(['2026-10-17T14:00:00.000Z..2026-10-17T14:30:00.000Z', '2026-10-17T09:00:00.000Z..2026-10-17T10:00:00.000Z']);
  });

  it('reads at most the configured number of windows per run', async () => {
    const { service } = fixture();
    const m = memory([]);
    const result = await catchUpRecordings(m, service, 'laptop', '2026-10-17T20:00:00.000Z', { windowMs: 60 * 60_000, overlapMs: 5 * 60_000, maxWindows: 3 });
    expect(result.windows).toBe(3);
    expect(m.calls.at(-1)).toBe('2026-10-17T11:00:00.000Z..2026-10-17T12:00:00.000Z');
  });
});
