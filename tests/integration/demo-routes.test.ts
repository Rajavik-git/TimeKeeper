import { expect, it } from 'vitest';
import { memoryDb, state } from '../../src/backend/adapters/sqlite/repository.js';
import { createApp } from '../../src/backend/api/app.js';
import { invoicePort } from '../../src/backend/adapters/sqlite/invoice.js';
import { issueInvoice, billingState } from '../../src/backend/application/invoice.js';
import { TimeKeeperService } from '../../src/backend/application/service.js';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { draftInvoice } from '../../src/frontend/calculations/billing.js';
import { migrate } from '../../src/backend/adapters/sqlite/migrate.js';
const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('backfills demo block links when upgrading an existing canonical database',()=>{
  const db=memoryDb();
  try {
    const expected=(db.prepare('SELECT COUNT(*) AS count FROM block').get() as {count:number}).count;
    db.exec('DROP TABLE demo_block_periods; DELETE FROM schema_migrations WHERE version=4');
    migrate(db);
    expect((db.prepare('SELECT COUNT(*) AS count FROM demo_block_periods').get() as {count:number}).count).toBe(expected);
    expect((db.prepare('SELECT period_id FROM demo_block_periods WHERE block_id=20').get() as {period_id:string}).period_id).toBe('excluded-20');
  } finally { db.close(); }
});

it('projects canonical recovery to the compatibility block state',async()=>{
  const db=memoryDb();
  try {
    const app=createApp(db);
    const response=await app.request('/api/work-periods/excluded-20/details',{
      method:'PATCH',...json({excluded:false}),
    });
    expect(response.status).toBe(200);
    expect((db.prepare('SELECT state FROM block WHERE id=20').get() as {state:string}).state).toBe('to_check');
    // A second recovery is a state conflict, not a malformed request (docs/API.md E3).
    expect((await app.request('/api/blocks/20/recover',{method:'POST'})).status).toBe(409);
    const question=db.prepare("SELECT question_id AS id,expected_assignment_revision AS revision FROM pending_questions WHERE work_period_id='excluded-20' AND status='pending'").get() as {id:string;revision:number};
    expect(question.revision).toBe(0);
    const answer=await app.request('/api/questions/answer',{method:'POST',...json({
      questionId:question.id,sessionId:'demo-2026-10-16',periodId:'excluded-20',
      expectedAssignmentRevision:question.revision,caseId:'5',responseCommandId:'recover-answer-20',
    })});
    expect(answer.status).toBe(200);
    expect((db.prepare("SELECT case_id FROM work_periods WHERE id='excluded-20'").get() as {case_id:string}).case_id).toBe('5');
  } finally {db.close();}
});

it('keeps answered canonical assignments safe from stale compatibility edits', async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const answer = await app.request('/api/questions/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'demo-question-13', sessionId: 'demo-2026-10-16',
        periodId: '13', expectedAssignmentRevision: 0, caseId: '5', responseCommandId: 'answer-13' }),
    });
    expect(answer.status).toBe(200);
    expect((db.prepare('SELECT matter_id FROM time_entry WHERE id=13').get() as {matter_id:number}).matter_id).toBe(5);
    const label = await app.request('/api/time-entries/13', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Edited label' }),
    });
    expect(label.status).toBe(200);
    expect((db.prepare('SELECT case_id FROM work_periods WHERE id=\'13\'').get() as {case_id:string}).case_id).toBe('5');
    const stale = await app.request('/api/time-entries/13', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matter_id: 1, expected_assignment_revision: 0 }),
    });
    expect(stale.status).toBe(409);
    expect((db.prepare('SELECT case_id FROM work_periods WHERE id=\'13\'').get() as {case_id:string}).case_id).toBe('5');
  } finally { db.close(); }
});

it('exports issued canonical invoice lines from their frozen snapshot', async () => {
  const db = memoryDb();
  try {
    const service = new TimeKeeperService(new SqliteRepository(db));
    const port = invoicePort(db);
    const core = {
      activeSession: service.activeSession(), sessions: service.listSessions(),
      periods: service.allPeriods(), sources: service.allSources(),
      questions: service.allQuestions(), coverageGaps: service.coverageGaps(),
      billing: billingState(port),
    };
    const { pendingPeriods, complete, ...draft } = draftInvoice(state(db), core, 2, 'final');
    expect(complete).toBe(true);
    expect(pendingPeriods).toBe(0);
    const issued = issueInvoice(port, { ...draft, type: 'final' }, '2026-10-16T18:00:00Z');
    const app = createApp(db);
    const client = db.prepare('SELECT client_id AS id FROM matter WHERE id=2').get() as { id: number };
    const edit = await app.request(`/api/client/${client.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rate_cents: draft.rateCents + 5000 }),
    });
    expect(edit.status).toBe(200);
    const response = await app.request(`/api/invoices/${issued.id}/csv`);
    expect(response.status).toBe(200);
    const { csv } = await response.json() as { csv: string };
    expect(csv).toContain(issued.number);
    expect(csv.split('\n')[0]).toContain(';minutes;');
    expect(csv).toContain(`;"${draft.billedMinutes}";`);
    expect(csv).toContain((draft.feesCents / 100).toFixed(2));
    expect(csv).toContain((draft.rateCents / 100).toFixed(2));
    expect(csv).toContain(draft.lines[0].label);
    expect(csv.split('\n').length).toBe(draft.lines.length + 1);
  } finally {
    db.close();
  }
});

it('keeps legacy assignment, approval and discard operations aligned with work periods', async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const patch = await app.request('/api/time-entries/13', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matter_id: 5, expected_assignment_revision: 0, review_status: 'approved' }),
    });
    expect(patch.status).toBe(200);
    const assigned = db.prepare('SELECT case_id,assignment_revision,effective_revision,validated_effective_revision FROM work_periods WHERE id=?').get('13') as {
      case_id: string; assignment_revision: number; effective_revision: number; validated_effective_revision: number;
    };
    expect(assigned.case_id).toBe('5');
    expect(assigned.assignment_revision).toBe(1);
    expect(assigned.validated_effective_revision).toBe(assigned.effective_revision);
    expect((db.prepare('SELECT status FROM pending_questions WHERE question_id=?').get('demo-question-13') as { status: string }).status).toBe('superseded');

    const reassigned = await app.request('/api/time-entries/13', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matter_id: 1, expected_assignment_revision: 1 }),
    });
    expect(reassigned.status).toBe(200);
    const changed = db.prepare('SELECT case_id,time_validation_status FROM work_periods WHERE id=?').get('13') as {
      case_id: string; time_validation_status: string;
    };
    expect(changed).toEqual({ case_id: '1', time_validation_status: 'unvalidated' });
    expect((await reassigned.json() as { review_status: string }).review_status).toBe('to_review');

    const discard = await app.request('/api/time-entries/13/discard', { method: 'POST' });
    expect(discard.status).toBe(200);
    expect((db.prepare('SELECT excluded FROM work_periods WHERE id=?').get('13') as { excluded: number }).excluded).toBe(1);
    const recover = await app.request('/api/blocks/13/recover', { method: 'POST' });
    expect(recover.status).toBe(200);
    const recovered = db.prepare('SELECT case_id,excluded FROM work_periods WHERE id=?').get('13') as {
      case_id: string | null; excluded: number;
    };
    expect(recovered).toEqual({ case_id: '1', excluded: 0 });
    expect((db.prepare("SELECT COUNT(*) AS count FROM pending_questions WHERE work_period_id='13' AND status='pending'").get() as { count: number }).count).toBe(0);
    const recoveredEntry=db.prepare('SELECT id FROM time_entry WHERE block_id=13').get() as {id:number};
    expect((await app.request(`/api/time-entries/${recoveredEntry.id}`,{
      method:'PATCH',...json({label:'Recovered work'})
    })).status).toBe(200);
    expect((db.prepare("SELECT label FROM work_periods WHERE id='13'").get() as {label:string}).label).toBe('Recovered work');
    const originalDiscarded = await app.request('/api/blocks/16/recover', { method: 'POST' });
    expect(originalDiscarded.status).toBe(200);
    expect((db.prepare('SELECT excluded FROM work_periods WHERE id=?').get('excluded-16') as { excluded: number }).excluded).toBe(0);
    const manualBefore=db.prepare("SELECT label FROM work_periods WHERE id='20'").get() as {label:string};
    expect((await app.request('/api/blocks/20/recover',{method:'POST'})).status).toBe(200);
    const personal=db.prepare('SELECT id FROM time_entry WHERE block_id=20').get() as {id:number};
    expect((await app.request(`/api/time-entries/${personal.id}`,{
      method:'PATCH',...json({label:'Recovered personal work'})
    })).status).toBe(200);
    expect((db.prepare("SELECT label,excluded FROM work_periods WHERE id='excluded-20'").get() as {label:string;excluded:number}))
      .toEqual({label:'Recovered personal work',excluded:0});
    expect((db.prepare("SELECT label FROM work_periods WHERE id='20'").get() as {label:string})).toEqual(manualBefore);
  } finally { db.close(); }
});

it('aligns legacy duration, manual time and expenses with canonical records', async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const correctedBefore = db.prepare('SELECT detected_duration_ms,duration_override_ms,effective_revision FROM work_periods WHERE id=?').get('14') as {
      detected_duration_ms: number; duration_override_ms: number; effective_revision: number;
    };
    const close = await app.request('/api/blocks/14/close', { method: 'POST', ...json({ minutes: 6 }) });
    expect(close.status).toBe(200);
    const correctedAfter = db.prepare('SELECT detected_duration_ms,duration_override_ms,effective_revision FROM work_periods WHERE id=?').get('14') as typeof correctedBefore;
    expect(correctedAfter).toEqual({
      detected_duration_ms: correctedBefore.detected_duration_ms + 360000,
      duration_override_ms: correctedBefore.duration_override_ms,
      effective_revision: correctedBefore.effective_revision,
    });
    const approve = await app.request('/api/day/approve', { method: 'POST', ...json({ date: '2026-10-16' }) });
    expect(approve.status).toBe(200);
    const approved = db.prepare('SELECT effective_revision,validated_effective_revision FROM work_periods WHERE id=?').get('15') as {
      effective_revision: number; validated_effective_revision: number;
    };
    expect(approved.validated_effective_revision).toBe(approved.effective_revision);
    const closeUncorrected = await app.request('/api/blocks/15/close', { method: 'POST', ...json({ minutes: 3 }) });
    expect(closeUncorrected.status).toBe(200);
    expect((db.prepare('SELECT time_validation_status FROM work_periods WHERE id=?').get('15') as { time_validation_status: string }).time_validation_status).toBe('unvalidated');
    expect((db.prepare('SELECT review_status FROM time_entry WHERE id=15').get() as {review_status:string}).review_status).toBe('to_review');
    expect((await app.request('/api/day/approve', {method:'POST',...json({date:'2026-10-16'})})).status).toBe(200);
    expect((db.prepare('SELECT time_validation_status FROM work_periods WHERE id=?').get('15') as {time_validation_status:string}).time_validation_status).toBe('validated');

    const manual = await app.request('/api/time-entries/manual', {
      method: 'POST', ...json({ matter_id: 1, task_id: 5, date: '2026-10-16', tenths_of_hour: 10, label: 'Demo meeting' }),
    });
    expect(manual.status).toBe(200);
    const entry = await manual.json() as { id: number };
    const period = db.prepare('SELECT case_id,duration_override_ms,time_validation_status FROM work_periods WHERE id=?').get(String(entry.id)) as {
      case_id: string; duration_override_ms: number; time_validation_status: string;
    };
    expect(period).toEqual({ case_id: '1', duration_override_ms: 3600000, time_validation_status: 'unvalidated' });

    const added = await app.request('/api/expenses', {
      method: 'POST', ...json({ matter_id: 1, date: '2026-10-16', label: 'Demo filing', type: 'expense', amount_cents: 1234 }),
    });
    expect(added.status).toBe(200);
    const expense = await added.json() as { id: number };
    const canonical = db.prepare('SELECT case_id,amount_cents FROM expenses WHERE id=?').get(expense.id) as {
      case_id: string; amount_cents: number;
    };
    expect(canonical).toEqual({ case_id: '1', amount_cents: 1234 });
    expect((await app.request(`/api/expenses/${expense.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(db.prepare('SELECT id FROM expenses WHERE id=?').get(expense.id)).toBeUndefined();
  } finally { db.close(); }
});

it('keeps catalogue updates and canonical rates in one transaction', async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const response = await app.request('/api/client/1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rate_cents: 32100 }),
    });
    expect(response.status).toBe(200);
    const legacy = db.prepare('SELECT rate_cents FROM client WHERE id=1').get() as { rate_cents: number };
    const canonical = db.prepare('SELECT hourly_rate_cents FROM clients WHERE id=?').get('1') as { hourly_rate_cents: number };
    expect(legacy.rate_cents).toBe(32100);
    expect(canonical.hourly_rate_cents).toBe(32100);
  } finally {
    db.close();
  }
});
