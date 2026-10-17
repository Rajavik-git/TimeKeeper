import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EndCommand, QuestionAnswer, StartCommand } from '../../contracts/index.js';
import { AppError, TimeKeeperService } from '../application/service.js';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new AppError('invalid-request','application/json required');
  let data = '';
  for await (const chunk of request) {
    data += String(chunk);
    if (data.length > 1_000_000) throw new AppError('invalid-request','request too large');
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new AppError('invalid-request','invalid JSON object'); }
}
const required = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new AppError('invalid-request',`${name} required`);
  return v;
};
const revision = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new AppError('invalid-request','revision required');
  return v;
};
const duration = (v: unknown): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new AppError('invalid-request','nonnegative duration required');
  return v;
};

export function createApi(service: TimeKeeperService, options: {allowedOrigins?: readonly string[]} = {}): Server {
  return createServer(async (req,res) => {
    const send = (status: number, value: unknown) => {
      const origin = req.headers.origin;
      res.writeHead(status,{ 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
        ...(origin && options.allowedOrigins?.includes(origin) ? {'access-control-allow-origin':origin,'vary':'Origin'} : {}) });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.origin && !options.allowedOrigins?.includes(req.headers.origin)) throw new AppError('invalid-request','browser origin not enabled');
      if (req.method === 'OPTIONS') {
        res.writeHead(204,{'access-control-allow-origin':req.headers.origin ?? '',
          'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'});
        return res.end();
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/health') return send(200,{status:'ok'});
      const session = url.pathname.match(/^\/sessions\/([^/]+)$/);
      const periods = url.pathname.match(/^\/sessions\/([^/]+)\/periods$/);
      const period = url.pathname.match(/^\/periods\/([^/]+)$/);
      const rate = url.pathname.match(/^\/cases\/([^/]+)\/rate$/);
      const periodSources = url.pathname.match(/^\/periods\/([^/]+)\/sources$/);
      if (method === 'GET' && session) return send(200,service.getSession(decodeURIComponent(session[1]!)));
      if (method === 'GET' && periods) return send(200,service.listPeriods(decodeURIComponent(periods[1]!)));
      if (method === 'GET' && period) return send(200,service.getPeriod(decodeURIComponent(period[1]!)));
      if (method === 'GET' && rate) return send(200,{hourlyRateCents:service.currentRateForCase(decodeURIComponent(rate[1]!))});
      if (method === 'GET' && periodSources) return send(200,service.listSources(decodeURIComponent(periodSources[1]!)));
      if (method !== 'POST') return send(404,{error:'not-found',message:'route not found'});
      const input = await body(req);
      const part = (value: unknown, name: string) => required(value,name);
      let result: unknown;
      switch (url.pathname) {
        case '/clients': service.createClient(part(input.id,'id'),part(input.name,'name')); result={status:'applied'}; break;
        case '/cases': service.createCase(part(input.id,'id'),part(input.clientId,'clientId'),part(input.reference,'reference'),part(input.title,'title'),input.hourlyRateCents === null ? null : duration(input.hourlyRateCents)); result={status:'applied'}; break;
        case '/settings/rate': service.setGlobalRate(duration(input.globalHourlyRateCents) ?? (()=>{throw new AppError('invalid-request','rate required')})(),part(input.currency,'currency'),part(input.workspaceId,'workspaceId')); result={status:'applied'}; break;
        case '/commands/start': result = service.start({producerId:part(input.producerId,'producerId'),commandId:part(input.commandId,'commandId'),
          sessionId:part(input.sessionId,'sessionId'),occurredAt:part(input.occurredAt,'occurredAt'),
          ...(input.prerequisiteCommandId === undefined ? {} : {prerequisiteCommandId:part(input.prerequisiteCommandId,'prerequisiteCommandId')})} satisfies StartCommand); break;
        case '/commands/end': result = service.end({producerId:part(input.producerId,'producerId'),commandId:part(input.commandId,'commandId'),
          sessionId:typeof input.sessionId === 'string' ? input.sessionId : '',occurredAt:part(input.occurredAt,'occurredAt'),
          ...(input.prerequisiteCommandId === undefined ? {} : {prerequisiteCommandId:part(input.prerequisiteCommandId,'prerequisiteCommandId')})} satisfies EndCommand); break;
        case '/periods/open': result = service.openPeriod({id:part(input.id,'id'),sessionId:part(input.sessionId,'sessionId'),
          caseId:input.caseId === null ? null : part(input.caseId,'caseId'),startedAt:part(input.startedAt,'startedAt'),
          origin:input.origin === 'lawyer' || input.origin === 'automatic' || input.origin === 'unresolved' ? input.origin : (()=>{throw new AppError('invalid-request','origin required')})(),
          mode:input.mode === 'current' || input.mode === 'recovery' ? input.mode : (()=>{throw new AppError('invalid-request','mode required')})()}); break;
        case '/periods/assign': result = service.assignPeriod(part(input.id,'id'),part(input.caseId,'caseId'),revision(input.expectedAssignmentRevision),
          input.origin === 'automatic' ? 'automatic' : input.origin === 'lawyer' ? 'lawyer' : (()=>{throw new AppError('invalid-request','origin required')})()); break;
        case '/questions/ask': service.askQuestion({questionId:part(input.questionId,'questionId'),sessionId:part(input.sessionId,'sessionId'),
          periodId:part(input.periodId,'periodId'),expectedAssignmentRevision:revision(input.expectedAssignmentRevision)}); result={status:'pending'}; break;
        case '/questions/answer': result=service.answerQuestion({questionId:part(input.questionId,'questionId'),sessionId:part(input.sessionId,'sessionId'),
          periodId:part(input.periodId,'periodId'),expectedAssignmentRevision:revision(input.expectedAssignmentRevision),
          caseId:part(input.caseId,'caseId'),responseCommandId:part(input.responseCommandId,'responseCommandId')} satisfies QuestionAnswer); break;
        case '/periods/detected-duration': result=service.setDetectedDuration(part(input.id,'id'),duration(input.durationMs)); break;
        case '/periods/duration-override': result=service.setDurationOverride(part(input.id,'id'),duration(input.durationMs)); break;
        case '/periods/validate': result=service.validatePeriod(part(input.id,'id')); break;
        case '/periods/billing': result=service.setBillingStatus(part(input.id,'id'),input.status === 'billed' ? 'billed' : input.status === 'unbilled' ? 'unbilled' : (()=>{throw new AppError('invalid-request','status required')})()); break;
        case '/sources/import': service.importSource({id:part(input.id,'id'),periodId:input.periodId === null ? null : part(input.periodId,'periodId'),
          instanceId:part(input.instanceId,'instanceId'),contentType:part(input.contentType,'contentType'),externalId:part(input.externalId,'externalId'),
          recordedAt:part(input.recordedAt,'recordedAt')}); result={status:'applied'}; break;
        case '/sources/validate': service.validateSource(part(input.instanceId,'instanceId'),part(input.contentType,'contentType'),part(input.externalId,'externalId')); result={status:'applied'}; break;
        case '/sources/availability': service.setSourceAvailability(part(input.instanceId,'instanceId'),part(input.contentType,'contentType'),part(input.externalId,'externalId'),
          input.availability === 'available' ? 'available' : input.availability === 'unavailable' ? 'unavailable' : (()=>{throw new AppError('invalid-request','availability required')})()); result={status:'applied'}; break;
        case '/reconstruction/propose': service.proposeReconstruction({id:part(input.id,'id'),periodId:part(input.periodId,'periodId'),expectedRevision:revision(input.expectedRevision),
          startedAt:part(input.startedAt,'startedAt'),endedAt:input.endedAt === null ? null : part(input.endedAt,'endedAt'),
          sourceReferences:Array.isArray(input.sourceReferences) && input.sourceReferences.every(x=>typeof x === 'string') ? input.sourceReferences as string[] : (()=>{throw new AppError('invalid-request','sourceReferences required')})()}); result={status:'pending'}; break;
        default: return send(404,{error:'not-found',message:'route not found'});
      }
      return send(result && typeof result === 'object' && 'status' in result && result.status === 'pending' ? 202 : 200,result);
    } catch (error) {
      if (error instanceof AppError) return send(error.code === 'not-found' || error.code === 'no-active-session' ? 404 : error.code === 'invalid-request' ? 400 : 409,
        {error:error.code,message:error.message});
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_SQLITE_ERROR' && 'message' in error && typeof error.message === 'string') {
        if (/^(UNIQUE|FOREIGN KEY|overlapping periods|period outside session|source target owner mismatch|target has aliases)/.test(error.message)) return send(409,{error:'conflict',message:'storage constraint conflict'});
        if (/^(CHECK|NOT NULL) constraint failed/.test(error.message)) return send(400,{error:'invalid-request',message:'storage constraint rejected input'});
      }
      return send(500,{error:'internal',message:'internal error'});
    }
  });
}

export async function listenLocal(server: Server, port = 0): Promise<{port:number;close:()=>Promise<void>}> {
  await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  const address = server.address() as AddressInfo;
  return {port:address.port,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
