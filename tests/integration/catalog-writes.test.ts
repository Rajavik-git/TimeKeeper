import { describe, it, expect } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

// docs/API.md A5: clients, cases, and settings are written through the existing interface routes, which keep the
// canonical records in sync. These tests replace the catalogue tests of the removed separate server (E10).
async function withApp(work: (call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>) => Promise<void>) {
  const db = memoryDb();
  try {
    const app = createApp(db);
    await work((method, path, body, headers = {}) => app.request(path, {
      method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  } finally {
    db.close();
  }
}

describe('catalogue writes through the existing routes (docs/API.md A5)', () => {
  it('creates a client and a case that the canonical reads return', () => withApp(async call => {
    const client = await (await call('POST', '/api/clients', { name: 'Fictional Client', code: 'FICT', rate_cents: 20000 })).json() as { id: number };
    const clients = await (await call('GET', '/api/clients')).json() as { id: string; name: string; code: string; hourlyRateCents: number }[];
    expect(clients.find(c => c.id === String(client.id))).toMatchObject({ name: 'Fictional Client', code: 'FICT', hourlyRateCents: 20000 });

    const created = await call('POST', '/api/matters', { client_id: client.id, title: 'Fictional Case', opposing_party: 'Other Party' });
    expect(created.status).toBe(200);
    const cases = await (await call('GET', `/api/cases?clientId=${client.id}`)).json() as { title: string; reference: string; opposingParty: string }[];
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ title: 'Fictional Case', opposingParty: 'Other Party' });
    expect(cases[0]!.reference).toMatch(/^\d{4}-\d{3}-FICT$/);
  }));

  it('sets the global hourly rate that settings and case rates use', () => withApp(async call => {
    expect((await call('PATCH', '/api/firm/1', { base_rate_cents: 26000 })).status).toBe(200);
    expect(await (await call('GET', '/api/settings')).json()).toMatchObject({ globalHourlyRateCents: 26000 });
  }));

  it('reports a duplicate client as a conflict and a case for an unknown client as not found', () => withApp(async call => {
    await call('POST', '/api/clients', { name: 'Fictional Client', code: 'FICT', rate_cents: 20000 });
    const duplicate = await call('POST', '/api/clients', { name: 'Again', code: 'FICT', rate_cents: 1 });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: 'conflict' });
    const orphan = await call('POST', '/api/matters', { client_id: 9999, title: 'No client', opposing_party: 'Other' });
    expect(orphan.status).toBe(404);
    expect(await orphan.json()).toMatchObject({ error: 'not-found' });
  }));

  it('answers the browser preflight for an allowed origin', () => withApp(async call => {
    const preflight = await call('OPTIONS', '/api/clients', undefined, { Origin: 'http://tauri.localhost', 'access-control-request-method': 'POST' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
  }));
});
