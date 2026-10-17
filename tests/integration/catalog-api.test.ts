import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

async function withApp<T>(work: (request: (path: string) => Promise<{ status: number; body: any }>, db: DatabaseSync) => Promise<T>) {
  const db = memoryDb();
  try {
    const app = createApp(db);
    return await work(async path => {
      const response = await app.request(path);
      return { status: response.status, body: await response.json() };
    }, db);
  } finally {
    db.close();
  }
}

describe('canonical catalogue reads (docs/API.md A13)', () => {
  it('lists every client with string IDs', () => withApp(async request => {
    const { status, body } = await request('/api/clients');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const client of body) expect(typeof client.id).toBe('string');
  }));

  it('lists the cases work periods can be assigned to', () => withApp(async (request, db) => {
    const { body } = await request('/api/cases');
    const caseIds = new Set(body.map((c: { id: string }) => c.id));
    const assigned = db.prepare('SELECT DISTINCT case_id FROM work_periods WHERE case_id IS NOT NULL').all() as { case_id: string }[];
    for (const { case_id } of assigned) expect(caseIds.has(case_id)).toBe(true);
  }));

  it('filters cases by client', () => withApp(async request => {
    const { status, body } = await request('/api/cases?clientId=1');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) expect(item.clientId).toBe('1');
    expect((await request('/api/cases?clientId=unknown')).body).toEqual([]);
  }));

  it('names each case\'s client, for case matching by the workflow', () => withApp(async (request, db) => {
    const clients = new Map((await request('/api/clients')).body.map((c: { id: string; name: string }) => [c.id, c.name]));
    const { body } = await request('/api/cases?status=active');
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) expect(item.clientName).toBe(clients.get(item.clientId));
  }));

  it('filters cases by status and rejects an unknown status', () => withApp(async request => {
    for (const item of (await request('/api/cases?status=active')).body) expect(item.status).toBe('active');
    const invalid = await request('/api/cases?status=closed');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('invalid-request');
  }));

  it('reads settings, and reports 404 when they are not configured', () => withApp(async (request, db) => {
    const { status, body } = await request('/api/settings');
    expect(status).toBe(200);
    expect(body).toMatchObject({ currency: expect.any(String), globalHourlyRateCents: expect.any(Number) });
    db.exec('DELETE FROM settings');
    const missing = await request('/api/settings');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not-found');
  }));
});
