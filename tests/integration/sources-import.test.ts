import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

// Demo period 13 runs from 08:40 to 08:52 on 2026-10-16 in the open demo session.
const source = (externalId: string, overrides: Record<string, unknown> = {}) => ({
  id: `src-${externalId}`, periodId: '13', instanceId: 'demo', contentType: 'screen', externalId,
  recordedAt: '2026-10-16T08:45:00Z', ...overrides,
});

async function withApp(work: (post: (body: unknown) => Promise<{ status: number; body: any }>, db: DatabaseSync) => Promise<void>) {
  const db = memoryDb();
  try {
    const app = createApp(db);
    await work(async body => {
      const response = await app.request('/api/sources', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }, db);
  } finally {
    db.close();
  }
}

const count = (db: DatabaseSync, externalIds: string[]) =>
  (db.prepare(`SELECT count(*) AS n FROM sources WHERE external_id IN (${externalIds.map(() => '?').join(',')})`).get(...externalIds) as { n: number }).n;

describe('POST /api/sources (docs/API.md A12)', () => {
  it('imports one reference and attaches it to its period', () => withApp(async (post, db) => {
    const result = await post(source('f1'));
    expect(result).toEqual({ status: 200, body: { id: 'src-f1', status: 'imported' } });
    expect(count(db, ['f1'])).toBe(1);
  }));

  it('treats a resent reference as unchanged and keeps the first ID', () => withApp(async post => {
    await post(source('f1'));
    expect((await post(source('f1', { id: 'retry-id' }))).body).toEqual({ id: 'src-f1', status: 'unchanged' });
  }));

  it('imports a batch and answers in input order', () => withApp(async post => {
    await post(source('f1'));
    const result = await post([source('f2'), source('f1'), source('f3', { periodId: null })]);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      { id: 'src-f2', status: 'imported' }, { id: 'src-f1', status: 'unchanged' }, { id: 'src-f3', status: 'imported' },
    ]);
  }));

  it('applies a batch all or nothing', () => withApp(async (post, db) => {
    const result = await post([source('ok-1'), source('late', { recordedAt: '2026-10-16T09:30:00Z' }), source('ok-2')]);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('conflict');
    expect(count(db, ['ok-1', 'late', 'ok-2'])).toBe(0);
  }));

  it('refuses the same provider identity with a different period or time', () => withApp(async post => {
    await post(source('f1'));
    const moved = await post(source('f1', { recordedAt: '2026-10-16T08:50:00Z' }));
    expect(moved.status).toBe(409);
    expect(moved.body.error).toBe('conflict');
  }));

  it('reports an unknown period as not found', () => withApp(async post => {
    const result = await post(source('f1', { periodId: 'missing' }));
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('not-found');
  }));

  it('rejects missing fields, an empty batch, and an oversized batch', () => withApp(async post => {
    const { periodId: _omitted, ...withoutPeriod } = source('f1');
    for (const body of [withoutPeriod, source('f1', { recordedAt: 'yesterday' }), [], Array.from({ length: 501 }, (_, i) => source(`b${i}`))]) {
      const result = await post(body);
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(result.body.error).toBe('invalid-request');
    }
  }));
});
