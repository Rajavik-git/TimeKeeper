import { describe, it, expect, afterEach, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';
import { toErrorResponse } from '../../src/backend/api/http';
import { AppError } from '../../src/backend/ports/errors';

const spec = JSON.parse(readFileSync('src/contracts/openapi.yaml', 'utf8')) as { components: { schemas: Record<string, object> } };
const validateError = new Ajv2020({ strict: false }).compile({ $ref: '#/components/schemas/Error', components: spec.components });

async function call(path: string, init: RequestInit = {}) {
  const db = memoryDb();
  try {
    const response = await createApp(db).request(path, { headers: { 'content-type': 'application/json' }, ...init });
    return { status: response.status, body: await response.json() as { error: string; message: string } };
  } finally {
    db.close();
  }
}

function expectError(result: { status: number; body: unknown }, status: number, code: string) {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(validateError(result.body), JSON.stringify(validateError.errors)).toBe(true);
  expect((result.body as { error: string }).error).toBe(code);
}

describe('API error responses (docs/API.md E1-E5, E12, D4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports malformed JSON on a core route as invalid-request, not internal', async () => {
    expectError(await call('/api/commands/start', { method: 'POST', body: '{not json' }), 400, 'invalid-request');
  });

  it('reports malformed JSON on a demo route as invalid-request', async () => {
    expectError(await call('/api/matters', { method: 'POST', body: '{not json' }), 400, 'invalid-request');
  });

  it('reports malformed JSON on the source pack route as invalid-request', async () => {
    expectError(await call('/api/cases/1/source-pack', { method: 'POST', body: '{not json' }), 400, 'invalid-request');
  });

  it('uses the same code and status for a missing record on core and demo routes', async () => {
    expectError(await call('/api/work-periods/missing/validate-time', { method: 'POST', body: '{}' }), 404, 'not-found');
    expectError(await call('/api/invoices/999/csv'), 404, 'not-found');
  });

  it('refuses an action blocked by an undecided rule with 409 rule-not-decided instead of 202', async () => {
    const result = await call('/api/work-periods/1/assignment', {
      method: 'POST', body: JSON.stringify({ caseId: '5', expectedAssignmentRevision: 0, origin: 'lawyer' }),
    });
    expectError(result, 409, 'rule-not-decided');
  });

  it('still answers a waiting command with 202 pending', async () => {
    const result = await call('/api/commands/start', {
      method: 'POST',
      body: JSON.stringify({ producerId: 'test', commandId: 'later', sessionId: 'next', occurredAt: '2026-10-16T18:00:00Z', prerequisiteCommandId: 'unknown' }),
    });
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ status: 'pending', commandId: 'later' });
  });

  it('refuses a browser origin outside the allow-list with the common error shape', async () => {
    expectError(await call('/api/sessions', { headers: { origin: 'https://example.com' } }), 403, 'forbidden-origin');
  });

  it('maps unexpected failures to 500 internal without leaking their message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = toErrorResponse(new Error('SELECT secret FROM clients'));
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal', message: 'internal error' });
  });

  it('maps only SQLite constraint violations to conflict', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toErrorResponse({ code: 'ERR_SQLITE_ERROR', errcode: 2067 }).status).toBe(409);
    expect(toErrorResponse({ code: 'ERR_SQLITE_ERROR', errcode: 5 }).status).toBe(500);
  });

  it('keeps expected refusals as their own code', () => {
    expect(toErrorResponse(new AppError('no-active-session', 'none'))).toEqual({ status: 404, body: { error: 'no-active-session', message: 'none' } });
  });
});
