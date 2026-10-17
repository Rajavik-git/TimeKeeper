import { expect, it } from 'vitest';
import { createApp } from '../../src/backend/api/app';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';

it('records a confirmed document switch as a visible canonical period',async()=>{
  const db=memoryDb();
  try {
    const app=createApp(db);
    const recognition=await app.request('/api/recognize',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({windowTitle:'2025-031 Opposition Brief v3.docx',appName:'Word'})});
    expect(await recognition.json()).toMatchObject({confidence:'high',suggestion:{caseId:'1',title:'Dawson v Martin'}});
    const response=await app.request('/api/periods/switch',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({caseId:'1',windowTitle:'2025-031 Opposition Brief v3.docx',appName:'Word',at:'2026-10-16T16:43:00Z'})});
    expect(response.status).toBe(200);
    const period=await response.json() as {id:string};
    const day=await app.request('/api/work-periods?date=2026-10-16');
    expect(await day.json()).toContainEqual(expect.objectContaining({id:period.id,caseId:'1',
      demoWindowTitle:'2025-031 Opposition Brief v3.docx',demoApp:'Word',endedAt:null}));
  }finally{db.close();}
});

it('creates non-client work already excluded, without a pending question',async()=>{
  const db=memoryDb();
  try {
    const app=createApp(db);
    const response=await app.request('/api/periods/switch',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({caseId:null,notClientWork:true,windowTitle:'Private notes',appName:'Editor',at:'2026-10-16T16:43:00Z'})});
    expect(response.status).toBe(200);
    const period=await response.json() as {id:string;excluded:boolean};
    expect(period.excluded).toBe(true);
    const questions=await (await app.request('/api/questions')).json() as Array<{periodId:string;status:string}>;
    expect(questions.some(question=>question.periodId===period.id&&question.status==='pending')).toBe(false);
  }finally{db.close();}
});
