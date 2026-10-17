import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DatabaseSync } from 'node:sqlite';
import { coreRoutes } from './core-routes.js';
import { AppError, TimeKeeperService } from '../application/service.js';
import { errorHandler, readJson } from './http.js';
import { DemoService } from '../application/demo.js';
import { demoPort } from '../adapters/sqlite/demo.js';
import { issueInvoice } from '../application/invoice.js';
import { invoicePort } from '../adapters/sqlite/invoice.js';
import type { InvoiceSnapshot } from '../ports/invoice.js';
import { assignmentPort } from '../adapters/sqlite/assignment.js';
import { SqliteRepository } from '../adapters/sqlite/core-repository.js';

const id = (value: string): number => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new AppError('invalid-request', 'Invalid ID');
  return result;
};

export function createApp(db: DatabaseSync) {
  const app = new Hono();
  const demo = new DemoService(demoPort(db), new TimeKeeperService(new SqliteRepository(db)));
  const assignment = assignmentPort(db);
  const invoice = invoicePort(db);
  const allowedOrigins = new Set([
    'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
    'http://127.0.0.1:5173', 'http://localhost:5173',
  ]);
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !allowedOrigins.has(origin)) return c.json({ error: 'forbidden-origin', message: 'origin not allowed' }, 403);
    return cors({ origin: origin ?? '', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'] })(c, next);
  });
  app.onError(errorHandler);

  app.get('/api/state', c => c.json(demo.state()));
  app.post('/api/demo/reset', c => c.json(demo.reset()));
  app.patch('/api/time-entries/:id', async c =>
    c.json(demo.updateEntry(id(c.req.param('id')), await readJson<Record<string, unknown>>(c), assignment)));
  app.post('/api/day/approve', async c =>
    c.json(demo.approveDay((await readJson<{ date: string }>(c)).date)));
  app.post('/api/matters/:id/approve', c => c.json(demo.approveCase(id(c.req.param('id')))));
  app.post('/api/time-entries/:id/discard', c => c.json(demo.discardEntry(id(c.req.param('id')))));
  app.post('/api/blocks/:id/recover', c => c.json(demo.recoverBlock(id(c.req.param('id')))));
  app.post('/api/time-entries/manual', async c => c.json(demo.addManualEntry(await readJson<Record<string, unknown>>(c))));
  app.post('/api/matters', async c => c.json(demo.createCase(await readJson<Record<string, unknown>>(c))));
  app.post('/api/markers', async c => c.json(demo.addMarker(await readJson<Record<string, unknown>>(c))));
  app.delete('/api/markers/:id', c => c.json(demo.removeMarker(id(c.req.param('id')))));
  app.post('/api/expenses', async c => c.json(demo.addExpense(await readJson<Record<string, unknown>>(c))));
  app.delete('/api/expenses/:id', c => c.json(demo.removeExpense(id(c.req.param('id')))));
  app.post('/api/invoices', async c =>
    c.json(issueInvoice(invoice, await readJson<InvoiceSnapshot>(c), new Date().toISOString())));
  app.get('/api/invoices/:id/csv', c => c.json(demo.invoiceCsv(id(c.req.param('id')))));
  app.get('/api/blocks/:id/recognition', c => c.json(demo.recognition(id(c.req.param('id')))));
  app.get('/api/sources/:id', c => c.json(demo.sourceDetails(id(c.req.param('id')))));
  app.post('/api/sources/:id/export', async c =>
    c.json(demo.exportSources(id(c.req.param('id')), (await readJson<{ options: string[] }>(c)).options)));
  app.post('/api/pauses', async c => c.json(demo.addPause(await readJson<Record<string, unknown>>(c))));
  app.patch('/api/pauses/:id', async c =>
    c.json(demo.closePause(id(c.req.param('id')), (await readJson<{ end_time: string }>(c)).end_time)));
  app.post('/api/blocks/:id/close', async c =>
    c.json(demo.closeBlock(id(c.req.param('id')), (await readJson<{ minutes: number }>(c)).minutes)));
  for (const table of ['firm', 'setting', 'client', 'matter', 'task'] as const)
    app.patch(`/api/${table}/:id`, async c =>
      c.json(demo.updateCatalog(table, id(c.req.param('id')), await readJson<Record<string, unknown>>(c))));
  app.post('/api/clients', async c => c.json(demo.createClient(await readJson<Record<string, unknown>>(c))));
  app.post('/api/tasks', async c => c.json(demo.createTask(await readJson<Record<string, unknown>>(c))));
  app.post('/api/client-rules', async c => c.json(demo.createClientRule(await readJson<Record<string, unknown>>(c))));
  app.delete('/api/client-rules/:id', c => c.json(demo.removeClientRule(id(c.req.param('id')))));
  app.route('/api', coreRoutes(db));
  return app;
}
