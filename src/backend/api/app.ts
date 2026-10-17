import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DatabaseSync } from 'node:sqlite';
import { coreRoutes } from './core-routes.js';
import { AppError, TimeKeeperService } from '../application/service.js';
import { DemoService } from '../application/demo.js';
import { demoPort } from '../adapters/sqlite/demo.js';
import { issueInvoice } from '../application/invoice.js';
import { invoicePort } from '../adapters/sqlite/invoice.js';
import type { InvoiceSnapshot } from '../ports/invoice.js';
import { assignmentPort } from '../adapters/sqlite/assignment.js';
import { SqliteRepository } from '../adapters/sqlite/core-repository.js';

const id = (value: string): number => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw Error('Invalid ID');
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
    // The dev UI may run on another port (UI_PORT), and a shared preview may add origins.
    ...(process.env.UI_PORT ? [`http://127.0.0.1:${process.env.UI_PORT}`, `http://localhost:${process.env.UI_PORT}`] : []),
    ...(process.env.TIMEKEEPER_ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean),
  ]);
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    const sameDeployment = process.env.VERCEL && origin === `https://${c.req.header('host')}`;
    if (origin && !allowedOrigins.has(origin) && !sameDeployment) return c.json({ error: 'Origin not allowed' }, 403);
    return cors({ origin: origin ?? '', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'] })(c, next);
  });
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.code, message: error.message },
      error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : 400);
    return c.json({ error: error.message }, error.message === 'Not found' ? 404 : 400);
  });

  app.get('/api/state', c => c.json(demo.state(c.req.query('date'),c.req.query('clientId'),c.req.query('caseId'))));
  app.get('/api/cases/search', c => c.json(demo.searchCases(c.req.query('query')??'')));
  app.post('/api/cases/:id/source-pack', async c => {
    const body=await c.req.json<{scope:'invoice'|'case'|'period'|'chosen';options:string[];invoiceId?:number;from?:string;to?:string;periodIds?:number[]}>();
    if(!['invoice','case','period','chosen'].includes(body.scope) || !Array.isArray(body.options))
      throw new AppError('invalid-request','Source pack scope and options required');
    if(body.scope==='invoice' && !Number.isInteger(body.invoiceId)) throw new AppError('invalid-request','Invoice required');
    if(body.scope==='period' && (!body.from || !body.to)) throw new AppError('invalid-request','Date range required');
    if(body.scope==='chosen' && !Array.isArray(body.periodIds)) throw new AppError('invalid-request','Period selection required');
    return c.json(demo.exportCaseSources(id(c.req.param('id')),body.scope,body.options,body));
  });
  app.post('/api/demo/reset', c => c.json(demo.reset()));
  app.patch('/api/time-entries/:id', async c =>
    c.json(demo.updateEntry(id(c.req.param('id')), await c.req.json<Record<string, unknown>>(), assignment)));
  app.post('/api/day/approve', async c =>
    c.json(demo.approveDay((await c.req.json<{ date: string }>()).date)));
  app.post('/api/matters/:id/approve', c => c.json(demo.approveCase(id(c.req.param('id')))));
  app.post('/api/time-entries/:id/discard', c => c.json(demo.discardEntry(id(c.req.param('id')))));
  app.post('/api/blocks/:id/recover', c => c.json(demo.recoverBlock(id(c.req.param('id')))));
  app.post('/api/time-entries/manual', async c => c.json(demo.addManualEntry(await c.req.json<Record<string, unknown>>())));
  app.post('/api/matters', async c => c.json(demo.createCase(await c.req.json<Record<string, unknown>>())));
  app.post('/api/markers', async c => c.json(demo.addMarker(await c.req.json<Record<string, unknown>>())));
  app.delete('/api/markers/:id', c => c.json(demo.removeMarker(id(c.req.param('id')))));
  app.post('/api/expenses', async c => c.json(demo.addExpense(await c.req.json<Record<string, unknown>>())));
  app.delete('/api/expenses/:id', c => c.json(demo.removeExpense(id(c.req.param('id')))));
  app.post('/api/invoices', async c =>
    c.json(issueInvoice(invoice, await c.req.json<InvoiceSnapshot>(), new Date().toISOString())));
  app.get('/api/invoices/:id/csv', c => c.json(demo.invoiceCsv(id(c.req.param('id')))));
  app.get('/api/blocks/:id/recognition', c => c.json(demo.recognition(id(c.req.param('id')))));
  app.get('/api/sources/:id', c => c.json(demo.sourceDetails(id(c.req.param('id')))));
  app.post('/api/sources/:id/export', async c =>
    c.json(demo.exportSources(id(c.req.param('id')), (await c.req.json<{ options: string[] }>()).options)));
  app.post('/api/pauses', async c => c.json(demo.addPause(await c.req.json<Record<string, unknown>>())));
  app.patch('/api/pauses/:id', async c =>
    c.json(demo.closePause(id(c.req.param('id')), (await c.req.json<{ end_time: string }>()).end_time)));
  app.post('/api/blocks/:id/close', async c =>
    c.json(demo.closeBlock(id(c.req.param('id')), (await c.req.json<{ minutes: number }>()).minutes)));
  for (const table of ['firm', 'setting', 'client', 'matter', 'task'] as const)
    app.patch(`/api/${table}/:id`, async c =>
      c.json(demo.updateCatalog(table, id(c.req.param('id')), await c.req.json<Record<string, unknown>>())));
  app.post('/api/clients', async c => c.json(demo.createClient(await c.req.json<Record<string, unknown>>())));
  app.post('/api/tasks', async c => c.json(demo.createTask(await c.req.json<Record<string, unknown>>())));
  app.post('/api/client-rules', async c => c.json(demo.createClientRule(await c.req.json<Record<string, unknown>>())));
  app.delete('/api/client-rules/:id', c => c.json(demo.removeClientRule(id(c.req.param('id')))));
  app.route('/api', coreRoutes(db));
  return app;
}
