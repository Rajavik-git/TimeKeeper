import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { TimeKeeperService } from '../../src/backend/application/service.js';
import { createApi, listenLocal } from '../../src/backend/api/core-server.js';

const cleanup: Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close()});
it('serves localhost commands and visible pending, conflict and not-found errors',async()=>{
  const repo=new SqliteRepository(new DatabaseSync(':memory:'));
  const server=createApi(new TimeKeeperService(repo));
  const binding=await listenLocal(server);cleanup.push(async()=>{await binding.close();repo.close()});
  const post=async(path:string,payload:unknown)=>fetch(`http://127.0.0.1:${binding.port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const pending=await post('/commands/end',{producerId:'p',commandId:'e',sessionId:'s',occurredAt:'2026-10-17T12:00:00Z',prerequisiteCommandId:'a'});
  expect(pending.status).toBe(202);expect(await pending.json()).toMatchObject({status:'pending'});
  const start=await post('/commands/start',{producerId:'p',commandId:'a',sessionId:'s',occurredAt:'2026-10-17T09:00:00Z'});
  expect(start.status).toBe(200);
  const session=await fetch(`http://127.0.0.1:${binding.port}/sessions/s`);
  expect(await session.json()).toMatchObject({endedAt:'2026-10-17T12:00:00Z'});
  const missing=await post('/commands/end',{producerId:'p',commandId:'x',sessionId:'unknown',occurredAt:'2026-10-17T12:00:00Z'});
  expect(missing.status).toBe(404);expect(await missing.json()).toMatchObject({error:'not-found'});
  const conflict=await post('/commands/start',{producerId:'p',commandId:'a',sessionId:'other',occurredAt:'2026-10-17T09:00:00Z'});
  expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({error:'conflict'});
});

it('accepts catalogue configuration through the application API',async()=>{
  const repo=new SqliteRepository(new DatabaseSync(':memory:'));
  const binding=await listenLocal(createApi(new TimeKeeperService(repo)));
  cleanup.push(async()=>{await binding.close();repo.close()});
  const post=async(path:string,payload:unknown)=>fetch(`http://127.0.0.1:${binding.port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  expect((await post('/clients',{id:'client',name:'Fictional Client'})).status).toBe(200);
  expect((await post('/cases',{id:'case',clientId:'client',reference:'REF',title:'Fictional Case',hourlyRateCents:null})).status).toBe(200);
  expect((await post('/settings/rate',{globalHourlyRateCents:25000,currency:'EUR',workspaceId:'workspace'})).status).toBe(200);
  const rate=await fetch(`http://127.0.0.1:${binding.port}/cases/case/rate`);
  expect(await rate.json()).toMatchObject({hourlyRateCents:25000});
});

it('maps storage constraints to 4xx and accepts only configured browser origins',async()=>{
  const repo=new SqliteRepository(new DatabaseSync(':memory:'));
  const binding=await listenLocal(createApi(new TimeKeeperService(repo),{allowedOrigins:['http://tauri.localhost']}));
  cleanup.push(async()=>{await binding.close();repo.close()});
  const base=`http://127.0.0.1:${binding.port}`;
  const preflight=await fetch(`${base}/clients`,{method:'OPTIONS',headers:{Origin:'http://tauri.localhost','access-control-request-method':'POST'}});
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
  const post=async(path:string,payload:unknown,origin?:string)=>fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(payload)});
  expect((await post('/clients',{id:'client',name:'Fictional Client'},'http://tauri.localhost')).status).toBe(200);
  const duplicate=await post('/clients',{id:'client',name:'Again'});
  expect(duplicate.status).toBe(409);
  const absent=await post('/cases',{id:'case',clientId:'missing',reference:'REF',title:'Fictional',hourlyRateCents:null});
  expect(absent.status).toBe(409);
  const blocked=await post('/clients',{id:'other',name:'Blocked'},'https://untrusted.example');
  expect(blocked.status).toBe(400);
});
