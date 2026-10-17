import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SqliteRepository } from '../adapters/sqlite/core-repository.js';
import { AppError, TimeKeeperService } from '../application/service.js';
import { addExpense, billingState, removeExpense } from '../application/invoice.js';
import { invoicePort } from '../adapters/sqlite/invoice.js';
import { readJson } from './http.js';
import { dismissFailedCommand, listFailedCommands } from '../application/inbox.js';
import type { CommandInbox } from '../ports/index.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid-request','JSON object required');
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new AppError('invalid-request',`${name} required`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AppError('invalid-request',`${name} must be a nonnegative integer`);
  return value;
}
function duration(value: unknown): number | null { return value === null ? null : integer(value,'durationMs'); }
/** `validated` defaults to true; false removes the validation (docs/API.md D2). */
function validated(b: Record<string, unknown>): boolean {
  if (b.validated === undefined || b.validated === true) return true;
  if (b.validated === false) return false;
  throw new AppError('invalid-request','validated must be true or false');
}
const expectedRevision = (b: Record<string, unknown>): number | undefined =>
  b.expectedEffectiveRevision === undefined ? undefined : integer(b.expectedEffectiveRevision,'expectedEffectiveRevision');
const input = async (c: {req:{json:()=>Promise<unknown>}}) => object(await readJson(c));

export function coreRoutes(db: DatabaseSync, inbox: () => CommandInbox): Hono {
  const router = new Hono();
  const service = new TimeKeeperService(new SqliteRepository(db));
  const billing = invoicePort(db);
  // Errors propagate to the application's single handler (src/backend/api/http.ts).
  // Readiness for the launcher and Tauri (docs/API.md A1). Answering means the API and its database are open.
  router.get('/health',c=>c.json({status:'ok'}));
  // Canonical catalogue reads for the interface, workflow case lookup, and chat (docs/API.md A13).
  router.get('/clients',c=>c.json(service.listClients()));
  router.get('/cases',c=>{
    const {clientId,status}=c.req.query();
    return c.json(service.listCases({...(clientId ? {clientId} : {}),...(status === undefined ? {} : {status})}));
  });
  router.get('/settings',c=>c.json(service.getSettings()));
  // Inbox commands that could not be applied, for the interface notice (docs/API.md A14).
  router.get('/inbox/failed',c=>c.json(listFailedCommands(inbox())));
  router.post('/inbox/failed/:file/dismiss',c=>c.json(dismissFailedCommand(inbox(),c.req.param('file'))));
  router.get('/sessions/active',c=>c.json(service.activeSession()));
  router.get('/sessions',c=>c.json(service.listSessions()));
  router.get('/sessions/:id',c=>c.json(service.getSession(c.req.param('id'))));
  router.get('/work-periods',c=>{
    const {date,from,to,clientId,caseId,sessionId}=c.req.query();
    const values=service.allPeriods().filter(p=>
      (!date || p.startedAt.startsWith(date)) && (!from || p.startedAt.slice(0,10)>=from) &&
      (!to || p.startedAt.slice(0,10)<=to) && (!clientId || p.clientId===clientId) &&
      (!caseId || p.caseId===caseId) && (!sessionId || p.sessionId===sessionId));
    return c.json(values);
  });
  router.get('/work-periods/:id',c=>c.json(service.getPeriod(c.req.param('id'))));
  router.get('/work-periods/:id/sources',c=>c.json(service.listSources(c.req.param('id'))));
  router.get('/sources',c=>{
    const periodId=c.req.query('periodId');
    return c.json(service.allSources().filter(s=>!periodId || s.workPeriodId===periodId));
  });
  router.get('/coverage-gaps',c=>{
    const {date,from,to,sessionId}=c.req.query();
    return c.json(service.coverageGaps().filter(g=>
      (!date || g.startedAt.startsWith(date)) && (!from || g.startedAt.slice(0,10)>=from) &&
      (!to || g.startedAt.slice(0,10)<=to) && (!sessionId || g.sessionId===sessionId)));
  });
  router.get('/questions',c=>{
    const {date,status,sessionId}=c.req.query();
    if (status !== undefined && status !== 'pending' && status !== 'answered' && status !== 'superseded')
      throw new AppError('invalid-request','status must be pending, answered, or superseded');
    const ids=new Set(service.allPeriods().filter(p=>p.startedAt.startsWith(date??'')).map(p=>p.id));
    return c.json(service.allQuestions().filter(q=>(!date || ids.has(q.periodId)) &&
      (!status || q.status===status) && (!sessionId || q.sessionId===sessionId)));
  });
  router.get('/billing/state',c=>c.json(billingState(billing)));
  router.post('/billing/expenses',async c=>{
    const b=await input(c);
    if (b.type !== 'expense' && b.type !== 'disbursement') throw new AppError('invalid-request','invalid expense type');
    return c.json(addExpense(billing,{caseId:string(b.caseId,'caseId'),date:string(b.date,'date'),label:string(b.label,'label'),
      type:b.type,amountCents:integer(b.amountCents,'amountCents')}));
  });
  router.delete('/billing/expenses/:id',c=>c.json(removeExpense(billing,integer(Number(c.req.param('id')),'id'))));
  router.post('/commands/start',async c=>{
    const b=await input(c);
    const result=service.start({producerId:string(b.producerId,'producerId'),commandId:string(b.commandId,'commandId'),
      sessionId:string(b.sessionId,'sessionId'),occurredAt:string(b.occurredAt,'occurredAt'),
      ...(b.prerequisiteCommandId === undefined ? {} : {prerequisiteCommandId:string(b.prerequisiteCommandId,'prerequisiteCommandId')})});
    return c.json(result,result.status === 'pending' ? 202 : 200);
  });
  router.post('/commands/end',async c=>{
    const b=await input(c);
    const result=service.end({producerId:string(b.producerId,'producerId'),commandId:string(b.commandId,'commandId'),
      sessionId:string(b.sessionId,'sessionId'),occurredAt:string(b.occurredAt,'occurredAt'),
      ...(b.prerequisiteCommandId === undefined ? {} : {prerequisiteCommandId:string(b.prerequisiteCommandId,'prerequisiteCommandId')})});
    return c.json(result,result.status === 'pending' ? 202 : 200);
  });
  router.post('/work-periods',async c=>{
    const b=await input(c);
    const result=service.openPeriod({id:string(b.id,'id'),sessionId:string(b.sessionId,'sessionId'),
      caseId:b.caseId === null ? null : string(b.caseId,'caseId'),startedAt:string(b.startedAt,'startedAt'),
      origin:b.origin === 'lawyer' || b.origin === 'automatic' || b.origin === 'unresolved' ? b.origin : (()=>{throw new AppError('invalid-request','origin required')})(),
      mode:b.mode === 'current' || b.mode === 'recovery' ? b.mode : (()=>{throw new AppError('invalid-request','mode required')})()});
    return c.json(result,'status' in result && result.status === 'pending' ? 202 : 200);
  });
  // Bulk time validation for "approve day" and "approve case" (docs/API.md A3): all or nothing.
  router.post('/work-periods/validate-time',async c=>{
    const b=await input(c);
    if (!Array.isArray(b.periods) || b.periods.length === 0 || b.periods.length > 500)
      throw new AppError('invalid-request','periods must list between 1 and 500 work periods');
    return c.json(service.validatePeriods(b.periods.map(value=>{
      const p=object(value);
      return {id:string(p.id,'id'),...(p.expectedEffectiveRevision === undefined ? {} : {expectedEffectiveRevision:integer(p.expectedEffectiveRevision,'expectedEffectiveRevision')})};
    })));
  });
  router.post('/work-periods/manual',async c=>{
    const b=await input(c);
    return c.json(service.createManualPeriod({sessionId:string(b.sessionId,'sessionId'),caseId:string(b.caseId,'caseId'),
      startedAt:string(b.startedAt,'startedAt'),durationMs:integer(b.durationMs,'durationMs'),
      taskTypeId:integer(b.taskTypeId,'taskTypeId'),label:string(b.label,'label')}));
  });
  router.patch('/work-periods/:id/details',async c=>{
    const b=await input(c);
    return c.json(service.updatePeriodDetails(c.req.param('id'),{
      ...(b.label === undefined ? {} : {label:string(b.label,'label')}),
      ...(b.billable === undefined ? {} : {billable:b.billable as boolean}),
      ...(b.nonbillableReason === undefined ? {} : {nonbillableReason:b.nonbillableReason as string|null}),
      ...(b.excluded === undefined ? {} : {excluded:b.excluded as boolean}),
    }));
  });
  router.post('/work-periods/:id/assignment',async c=>{
    const b=await input(c);
    return c.json(service.assignPeriod(c.req.param('id'),string(b.caseId,'caseId'),integer(b.expectedAssignmentRevision,'expectedAssignmentRevision'),
      b.origin === 'automatic' ? 'automatic' : b.origin === 'lawyer' ? 'lawyer' : (()=>{throw new AppError('invalid-request','origin required')})()));
  });
  router.post('/work-periods/:id/detected-duration',async c=>c.json(service.setDetectedDuration(c.req.param('id'),duration((await input(c)).durationMs))));
  router.post('/work-periods/:id/duration-override',async c=>{
    const b=await input(c);
    return c.json(service.setDurationOverride(c.req.param('id'),duration(b.durationMs),expectedRevision(b)));
  });
  router.post('/work-periods/:id/validate-time',async c=>{
    const b=await input(c);
    return c.json(validated(b)
      ? service.validatePeriod(c.req.param('id'),expectedRevision(b))
      : service.unvalidatePeriod(c.req.param('id'),expectedRevision(b)));
  });
  router.post('/work-periods/:id/billing-status',async c=>{
    const b=await input(c);
    if (b.status !== 'billed' && b.status !== 'unbilled') throw new AppError('invalid-request','status required');
    return c.json(service.setBillingStatus(c.req.param('id'),b.status));
  });
  router.post('/questions',async c=>{
    const b=await input(c);
    const questionId=service.askQuestion({questionId:string(b.questionId,'questionId'),sessionId:string(b.sessionId,'sessionId'),
      periodId:string(b.periodId,'periodId'),expectedAssignmentRevision:integer(b.expectedAssignmentRevision,'expectedAssignmentRevision')});
    return c.json({status:'pending',questionId},202);
  });
  router.post('/questions/answer',async c=>{
    const b=await input(c);
    return c.json(service.answerQuestion({questionId:string(b.questionId,'questionId'),sessionId:string(b.sessionId,'sessionId'),
      periodId:string(b.periodId,'periodId'),expectedAssignmentRevision:integer(b.expectedAssignmentRevision,'expectedAssignmentRevision'),
      caseId:string(b.caseId,'caseId'),responseCommandId:string(b.responseCommandId,'responseCommandId')}));
  });
  // Evidence references from the Screenpipe workflow (docs/API.md A12): one object or an array, applied all or nothing.
  router.post('/sources',async c=>{
    const body=await readJson(c);
    const items=Array.isArray(body) ? body : [body];
    if (items.length === 0 || items.length > 500) throw new AppError('invalid-request','send between 1 and 500 sources');
    const results=service.importSources(items.map(value=>{
      const b=object(value);
      return {id:string(b.id,'id'),periodId:b.periodId === null ? null : string(b.periodId,'periodId'),
        instanceId:string(b.instanceId,'instanceId'),contentType:string(b.contentType,'contentType'),
        externalId:string(b.externalId,'externalId'),recordedAt:string(b.recordedAt,'recordedAt')};
    }));
    return c.json(Array.isArray(body) ? results : results[0]);
  });
  router.post('/sources/:instanceId/:contentType/:externalId/validate',async c=>{
    const identity=[c.req.param('instanceId'),c.req.param('contentType'),c.req.param('externalId')] as const;
    if (validated(await input(c))) service.validateSource(...identity); else service.unvalidateSource(...identity);
    return c.json({status:'applied'});
  });
  router.post('/sources/:instanceId/:contentType/:externalId/availability',async c=>{
    const b=await input(c);
    if (b.availability !== 'available' && b.availability !== 'unavailable') throw new AppError('invalid-request','availability required');
    service.setSourceAvailability(c.req.param('instanceId'),c.req.param('contentType'),c.req.param('externalId'),b.availability);
    return c.json({status:'applied'});
  });
  return router;
}
