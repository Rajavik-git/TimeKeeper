import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { createApp } from '../../src/backend/api/app.js';

// Moved from tests/integration/core-api.test.ts, which used the separate node:http server (docs/API.md E10).
it('serves session commands with visible pending, conflict and not-found results', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    new SqliteRepository(db);
    const app = createApp(db);
    const post = (path: string, payload: unknown) => app.request(`/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const pending = await post('/commands/end', { producerId: 'p', commandId: 'e', sessionId: 's', occurredAt: '2026-10-17T12:00:00Z', prerequisiteCommandId: 'a' });
    expect(pending.status).toBe(202); expect(await pending.json()).toMatchObject({ status: 'pending' });
    const start = await post('/commands/start', { producerId: 'p', commandId: 'a', sessionId: 's', occurredAt: '2026-10-17T09:00:00Z' });
    expect(start.status).toBe(200);
    const session = await app.request('/api/sessions/s');
    expect(await session.json()).toMatchObject({ endedAt: '2026-10-17T12:00:00Z' });
    const missing = await post('/commands/end', { producerId: 'p', commandId: 'x', sessionId: 'unknown', occurredAt: '2026-10-17T12:00:00Z' });
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ error: 'not-found' });
    const conflict = await post('/commands/start', { producerId: 'p', commandId: 'a', sessionId: 'other', occurredAt: '2026-10-17T09:00:00Z' });
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: 'conflict' });
  } finally {
    db.close();
  }
});
