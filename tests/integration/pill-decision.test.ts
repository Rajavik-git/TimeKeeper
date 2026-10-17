import { expect, it } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';

it('undoes an answer without reviving its stale question', async () => {
  const db=memoryDb();
  try {
    const app=createApp(db);
    const post=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const answer=await post('/api/pill/decision',{kind:'assign',periodId:'13',caseId:'5',expectedAssignmentRevision:0});
    expect(answer.status).toBe(200);
    const token=(await answer.json()).undoToken as string;
    expect((await (await app.request('/api/work-periods/13')).json()).caseId).toBe('5');
    expect((await post('/api/pill/undo',{undoToken:token})).status).toBe(200);
    const period=await (await app.request('/api/work-periods/13')).json();
    expect(period.caseId).toBeNull();
    expect(period.assignmentRevision).toBe(2);
    const questions=await (await app.request('/api/questions')).json() as Array<{periodId:string;status:string;expectedAssignmentRevision:number}>;
    expect(questions.some(q=>q.periodId==='13'&&q.status==='pending'&&q.expectedAssignmentRevision===2)).toBe(true);
    expect((await post('/api/pill/undo',{undoToken:token})).status).toBe(409);
  } finally { db.close(); }
});

it('undoes a file switch only while its new period is unchanged', async () => {
  const db=memoryDb();
  try {
    const app=createApp(db);
    const post=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const before=await (await app.request('/api/work-periods')).json() as Array<{id:string;endedAt:string|null}>;
    const prior=before.find(period=>period.endedAt===null);
    const switchBody={kind:'switch',caseId:'1',windowTitle:'2025-031 Opposition Brief v3.docx',appName:'Word',at:'2026-10-16T16:43:00Z'};
    const result=await post('/api/pill/decision',switchBody);
    expect(result.status).toBe(200);
    const {period,undoToken}=await result.json() as {period:{id:string};undoToken:string};
    expect((await (await app.request('/api/work-periods')).json()).length).toBe(before.length+1);
    expect((await post('/api/pill/undo',{undoToken})).status).toBe(200);
    expect((await app.request(`/api/work-periods/${period.id}`)).status).toBe(404);
    expect((await (await app.request('/api/work-periods')).json()).length).toBe(before.length);
    if(prior)expect((await (await app.request(`/api/work-periods/${prior.id}`)).json()).endedAt).toBeNull();
    const next=await post('/api/pill/decision',switchBody);
    const changed=await next.json() as {period:{id:string};undoToken:string};
    expect((await post(`/api/work-periods/${changed.period.id}/assignment`,{caseId:'2',expectedAssignmentRevision:0,origin:'lawyer'})).status).toBe(200);
    expect((await post('/api/pill/undo',{undoToken:changed.undoToken})).status).toBe(409);
  } finally { db.close(); }
});

it('undoes exclusion and validation while keeping later edits guarded', async () => {
  const db=memoryDb();
  try {
    const app=createApp(db);
    const post=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const period=await (await app.request('/api/work-periods/13')).json() as {assignmentRevision:number;effectiveRevision:number;excluded:boolean};
    const excluded=await post('/api/pill/decision',{kind:'exclude',periodId:'13',
      expectedAssignmentRevision:period.assignmentRevision,expectedEffectiveRevision:period.effectiveRevision});
    expect(excluded.status).toBe(200);
    expect((await (await app.request('/api/work-periods/13')).json()).excluded).toBe(true);
    expect((await post('/api/pill/undo',{undoToken:(await excluded.json()).undoToken})).status).toBe(200);
    expect((await (await app.request('/api/work-periods/13')).json()).excluded).toBe(period.excluded);
    const before=await (await app.request('/api/work-periods/14')).json() as {timeValidated:boolean;effectiveRevision:number};
    const validated=await post('/api/pill/decision',{kind:'validate',periodIds:['14'],expectedEffectiveRevisions:{'14':before.effectiveRevision}});
    expect(validated.status).toBe(200);
    expect((await (await app.request('/api/work-periods/14')).json()).timeValidated).toBe(true);
    expect((await post('/api/pill/undo',{undoToken:(await validated.json()).undoToken})).status).toBe(200);
    expect((await (await app.request('/api/work-periods/14')).json()).timeValidated).toBe(before.timeValidated);
  } finally {db.close();}
});
