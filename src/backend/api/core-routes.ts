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

  // --- Readiness: the launcher and Tauri wait for this before sending commands (docs/API.md A1) ---
  // Answering means the API and its database are open, and the inbox commands left while closed are applied (D8).
  router.get('/health',c=>c.json({status:'ok'}));

  // --- Clients, cases, settings (read-only): used by the screens, the JEV case list, and chat (docs/API.md A13) ---
  router.get('/clients',c=>c.json(service.listClients()));
  // Filters: clientId, status (active or archived). The JEV workflow calls ?status=active.
  router.get('/cases',c=>{
    const {clientId,status}=c.req.query();
    return c.json(service.listCases({...(clientId ? {clientId} : {}),...(status === undefined ? {} : {status})}));
  });
  router.get('/settings',c=>c.json(service.getSettings()));

  // --- Failed inbox commands: Start/End pressed while TimeKeeper was closed that could not be applied (docs/API.md A14) ---
  // The lawyer sees them in the interface and dismisses them once handled.
  router.get('/inbox/failed',c=>c.json(listFailedCommands(inbox())));
  router.post('/inbox/failed/:file/dismiss',c=>c.json(dismissFailedCommand(inbox(),c.req.param('file'))));

  router.get('/sessions/active',c=>c.json(service.activeSession()));
  router.get('/sessions',c=>c.json(service.listSessions()));
  router.get('/sessions/:id',c=>c.json(service.getSession(c.req.param('id'))));
  router.get('/work-periods',c=>{
    // Filters (docs/API.md A4): caseId and sessionId were added for the workflow and chat.
    const {date,from,to,clientId,caseId,sessionId}=c.req.query();
    const values=service.allPeriods().filter(p=>
      (!date || p.startedAt.startsWith(date)) && (!from || p.startedAt.slice(0,10)>=from) &&
      (!to || p.startedAt.slice(0,10)<=to) && (!clientId || p.clientId===clientId) &&
      (!caseId || p.caseId===caseId) && (!sessionId || p.sessionId===sessionId));
    return c.json(values);
  });
  router.get('/work-periods/:id',c=>c.json(service.getPeriod(c.req.param('id'))));
  router.get('/work-periods/:id/sources',c=>c.json(service.listSources(c.req.param('id'))));

  // --- Evidence and coverage lists, with optional filters (docs/API.md A4) ---
  // Sources: periodId. Coverage gaps (time with no recording read, for example while Screenpipe was down): date, from, to, sessionId.
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
    // Filters (docs/API.md A4): status (pending, answered, superseded) and sessionId were added; date was already there.
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

  // --- Bulk time validation: "approve day" and "approve case" in one call (docs/API.md A3) ---
  // All or nothing: if one period cannot be validated, none is, and that period's error is returned.
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

  // --- Duration correction and time validation of one period ---
  // Optional expectedEffectiveRevision: refused with 409 if the period changed after the lawyer saw it (docs/API.md A2).
  // validate-time with {"validated": false} removes the validation (D2); only finished periods of past days can be validated (D9).
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

  // --- Evidence import: references to Screenpipe recordings, never their content (docs/API.md A12) ---
  // Used by the workflow and the recording catch-up. One object or an array of up to 500, applied all or nothing;
  // sending the same reference again changes nothing.
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

  // Source validation; {"validated": false} removes it (docs/API.md D2).
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
