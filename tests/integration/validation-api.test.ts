import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

type Call = (path: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withApp(work: (call: Call, db: DatabaseSync) => Promise<void>) {
  const db = memoryDb();
  try {
    const app = createApp(db);
    await work(async (path, body) => {
      const response = await app.request(path, body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }, db);
  } finally {
    db.close();
  }
}

const SOURCE = '/api/sources/demo/screen/frame_id%2042001';
const sourceStatus = async (call: Call) =>
  (await call('/api/sources')).body.find((s: { externalId: string }) => s.externalId === 'frame_id 42001').validationStatus;

describe('revision guard on time validation and duration override (docs/API.md A2)', () => {
  it('validates when the lawyer saw the current revision', () => withApp(async call => {
    const period = (await call('/api/work-periods/14')).body;
    const result = await call('/api/work-periods/14/validate-time', { expectedEffectiveRevision: period.effectiveRevision });
    expect(result.status).toBe(200);
    expect(result.body.timeValidated).toBe(true);
  }));

  it('refuses to validate or override a period that changed since the lawyer saw it', () => withApp(async call => {
    const period = (await call('/api/work-periods/14')).body;
    const stale = period.effectiveRevision + 1;
    for (const [path, body] of [
      ['/api/work-periods/14/validate-time', { expectedEffectiveRevision: stale }],
      ['/api/work-periods/14/duration-override', { durationMs: 600000, expectedEffectiveRevision: stale }],
    ] as const) {
      const result = await call(path, body);
      expect(result.status, path).toBe(409);
      expect(result.body.error).toBe('conflict');
    }
    expect((await call('/api/work-periods/14')).body).toEqual(period);
  }));

  it('keeps working without the guard, as the current interface calls it', () => withApp(async call => {
    expect((await call('/api/work-periods/14/validate-time', {})).status).toBe(200);
  }));
});

describe('bulk time validation (docs/API.md A3)', () => {
  const unvalidated = (db: DatabaseSync, withCase: boolean) => (db.prepare(`SELECT id FROM work_periods
    WHERE billing_status='unbilled' AND case_id IS ${withCase ? 'NOT ' : ''}NULL
    AND (validated_effective_revision IS NULL OR validated_effective_revision != effective_revision)
    AND COALESCE(duration_override_ms, detected_duration_ms) IS NOT NULL ORDER BY id LIMIT 2`).all() as { id: string }[]).map(r => r.id);

  it('validates several periods and answers in request order', () => withApp(async (call, db) => {
    const ids = unvalidated(db, true).reverse();
    expect(ids.length).toBe(2);
    const result = await call('/api/work-periods/validate-time', { periods: ids.map(id => ({ id })) });
    expect(result.status).toBe(200);
    expect(result.body.map((p: { id: string }) => p.id)).toEqual(ids);
    for (const period of result.body) expect(period.timeValidated).toBe(true);
  }));

  it('changes nothing when one period cannot be validated', () => withApp(async (call, db) => {
    const [ready] = unvalidated(db, true), [noCase] = unvalidated(db, false);
    const result = await call('/api/work-periods/validate-time', { periods: [{ id: ready }, { id: noCase }] });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('conflict');
    expect((await call(`/api/work-periods/${ready}`)).body.timeValidated).toBe(false);
  }));

  it('applies the revision guard to each period', () => withApp(async (call, db) => {
    const [id] = unvalidated(db, true);
    const period = (await call(`/api/work-periods/${id}`)).body;
    const result = await call('/api/work-periods/validate-time', { periods: [{ id, expectedEffectiveRevision: period.effectiveRevision + 1 }] });
    expect(result.status).toBe(409);
  }));

  it('rejects duplicate IDs, an empty list, and a missing list', () => withApp(async call => {
    for (const body of [{ periods: [{ id: '14' }, { id: '14' }] }, { periods: [] }, {}]) {
      const result = await call('/api/work-periods/validate-time', body);
      expect(result.status, JSON.stringify(body)).toBe(400);
      expect(result.body.error).toBe('invalid-request');
    }
  }));
});

describe('undo a validation (docs/API.md D2)', () => {
  it('removes time validation, and repeating it changes nothing', () => withApp(async call => {
    await call('/api/work-periods/14/validate-time', {});
    const undone = await call('/api/work-periods/14/validate-time', { validated: false });
    expect(undone.status).toBe(200);
    expect(undone.body.timeValidated).toBe(false);
    const again = await call('/api/work-periods/14/validate-time', { validated: false });
    expect(again.body).toEqual(undone.body);
  }));

  it('refuses to remove time validation from a billed period', () => withApp(async (call, db) => {
    const billed = db.prepare(`SELECT id FROM work_periods WHERE billing_status='billed'
      AND validated_effective_revision = effective_revision AND time_validated_at IS NOT NULL LIMIT 1`).get() as { id: string };
    const result = await call(`/api/work-periods/${billed.id}/validate-time`, { validated: false });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('conflict');
    expect((await call(`/api/work-periods/${billed.id}`)).body.timeValidated).toBe(true);
  }));

  it('removes source validation, and repeating it changes nothing', () => withApp(async call => {
    await call(`${SOURCE}/validate`, {});
    expect(await sourceStatus(call)).toBe('validated');
    expect((await call(`${SOURCE}/validate`, { validated: false })).status).toBe(200);
    expect(await sourceStatus(call)).toBe('unvalidated');
    expect((await call(`${SOURCE}/validate`, { validated: false })).status).toBe(200);
    expect(await sourceStatus(call)).toBe('unvalidated');
  }));

  it('rejects a validated value that is not true or false', () => withApp(async call => {
    for (const path of ['/api/work-periods/14/validate-time', `${SOURCE}/validate`]) {
      const result = await call(path, { validated: 'no' });
      expect(result.status, path).toBe(400);
      expect(result.body.error).toBe('invalid-request');
    }
  }));
});
