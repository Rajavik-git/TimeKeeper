import { describe, it, expect } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

async function get(path: string): Promise<{ status: number; body: any }> {
  const db = memoryDb();
  try {
    const response = await createApp(db).request(path);
    return { status: response.status, body: await response.json() };
  } finally {
    db.close();
  }
}

describe('list filters (docs/API.md A4)', () => {
  it('filters work periods by session', async () => {
    const { body } = await get('/api/work-periods?sessionId=demo-2026-10-16');
    expect(body.length).toBeGreaterThan(0);
    for (const period of body) expect(period.sessionId).toBe('demo-2026-10-16');
    expect((await get('/api/work-periods?sessionId=unknown')).body).toEqual([]);
  });

  it('filters sources by work period', async () => {
    const { body } = await get('/api/sources?periodId=1');
    expect(body.length).toBeGreaterThan(0);
    for (const source of body) expect(source.workPeriodId).toBe('1');
  });

  it('filters coverage gaps by session and date range', async () => {
    const all = (await get('/api/coverage-gaps')).body;
    expect(all.length).toBeGreaterThan(0);
    const sessionId = all[0].sessionId, day = all[0].startedAt.slice(0, 10);
    for (const gap of (await get(`/api/coverage-gaps?sessionId=${sessionId}`)).body) expect(gap.sessionId).toBe(sessionId);
    expect((await get(`/api/coverage-gaps?from=${day}&to=${day}`)).body.length).toBeGreaterThan(0);
    expect((await get('/api/coverage-gaps?from=2099-01-01')).body).toEqual([]);
  });

  it('filters questions by status and session, and rejects an unknown status', async () => {
    const pending = (await get('/api/questions?status=pending')).body;
    expect(pending.length).toBeGreaterThan(0);
    for (const question of pending) expect(question.status).toBe('pending');
    for (const question of (await get('/api/questions?sessionId=demo-2026-10-16')).body) expect(question.sessionId).toBe('demo-2026-10-16');
    const invalid = await get('/api/questions?status=open');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('invalid-request');
  });
});
