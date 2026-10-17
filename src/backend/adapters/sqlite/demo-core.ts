import type { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.js';

type Row = Record<string, string | number | null>;
const rows = (db: DatabaseSync, table: string): Row[] => db.prepare(`SELECT * FROM ${table}`).all() as Row[];
const asText = (value: string | number | null): string => String(value ?? '');
const timestamp = (date: string, time: string): string => `${date}T${time}:00Z`;
const now = '2026-10-16T16:42:00Z';

/** Imports the fictional mockup seed once. It does not infer durations from source observations. */
export function seedCanonicalDemo(db: DatabaseSync): void {
  migrate(db);
  if (db.prepare('SELECT 1 FROM clients LIMIT 1').get()) return;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='client'").get()) return;
  db.exec('SAVEPOINT demo_seed');
  try {
    // The imported mockup column remains for read compatibility; unissued
    // calculations belong to React and have no stored legacy amount.
    db.prepare('UPDATE time_entry SET amount_cents=0 WHERE invoice_id IS NULL').run();
    const firm = rows(db, 'firm')[0]!;
    const preference = rows(db, 'setting')[0]!;
    for (const client of rows(db, 'client')) {
      db.prepare(`INSERT INTO clients(id,name,active,created_at,updated_at,code,type,mode,hourly_rate_cents,vat_applicable,billing_address)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(asText(client.id),client.name,1,now,now,client.code,client.type,client.mode,client.rate_cents,client.vat_applicable,client.billing_address);
    }
    for (const item of rows(db, 'matter')) {
      db.prepare(`INSERT INTO cases(id,client_id,reference,title,hourly_rate_cents,status,created_at,updated_at,category,case_number,opposing_party,mode,flat_fee_cents,hour_cap,success_fee_percent,budget_cents,opened_on)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(asText(item.id),asText(item.client_id),item.reference,item.title,item.own_rate_cents,
        item.status === 'closed' ? 'archived' : 'active',now,now,item.category,item.case_number,item.opposing_party,item.mode,item.flat_fee_cents,item.hour_cap,item.success_fee_percent,item.budget_cents,item.opened_on);
    }
    db.prepare(`INSERT INTO settings(id,global_hourly_rate_cents,currency,workspace_id,updated_at,lawyer_name,address,vat_number,base_unit,vat_rate,confidence_threshold,excluded_apps,capture_retention,notifications,pill_position,invoice_prefix,next_number)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(firm.base_rate_cents,'USD','demo-workspace',now,firm.lawyer_name,firm.address,firm.vat_number,firm.base_unit,firm.vat_rate,
      preference.confidence_threshold,preference.excluded_apps,preference.capture_retention,preference.notifications,preference.pill_position,preference.invoice_prefix,preference.next_number);
    for (const task of rows(db,'task')) db.prepare(`INSERT INTO task_types(id,code,label,billable_by_default,off_screen,sort_order) VALUES (?,?,?,?,?,?)`).run(task.id,task.code,task.label,task.billable_by_default,task.off_screen,task.sort_order);
    for (const marker of rows(db,'marker')) db.prepare(`INSERT INTO markers(id,case_id,type,value,weight,learned,hits,last_seen_at) VALUES (?,?,?,?,?,?,?,?)`).run(marker.id,asText(marker.matter_id),marker.type,marker.value,marker.weight,marker.learned,marker.hits,marker.last_seen_at);
    for (const rule of rows(db,'client_rule')) db.prepare(`INSERT INTO client_rules(id,client_id,type,value,label) VALUES (?,?,?,?,?)`).run(rule.id,asText(rule.client_id),rule.type,rule.value,rule.label);
    for (const invoice of rows(db,'invoice')) db.prepare(`INSERT INTO invoices(id,case_id,number,date,type,status,subtotal_cents,vat_cents,disbursements_cents,total_cents,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      invoice.id,asText(invoice.matter_id),invoice.number,invoice.date,invoice.type,invoice.status,invoice.subtotal_cents,invoice.vat_cents,invoice.disbursements_cents,
      Number(invoice.subtotal_cents)+Number(invoice.vat_cents)+Number(invoice.disbursements_cents),JSON.stringify(invoice));

    const blocks = rows(db,'block');
    const entries = rows(db,'time_entry');
    const byBlock = new Map(entries.filter(e=>e.block_id !== null).map(e=>[Number(e.block_id),e]));
    const dates = new Set([...blocks.map(b=>asText(b.date)),...entries.map(e=>asText(e.date))]);
    for (const date of [...dates].sort()) db.prepare(`INSERT INTO sessions(id,started_at,ended_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(
      `demo-${date}`,date === '2026-10-16' ? `${date}T08:40:00Z` : `${date}T00:00:00Z`,date === '2026-10-16' ? null : `${date}T23:59:59Z`,0,now,now);

    const clients = new Map(rows(db,'matter').map(m=>[asText(m.id),asText(m.client_id)]));
    const clientRates = new Map(rows(db,'client').map(c=>[asText(c.id),Number(c.rate_cents)]));
    const caseRates = new Map(rows(db,'matter').map(m=>[asText(m.id),m.own_rate_cents]));
    const insertPeriod = db.prepare(`INSERT INTO work_periods(
      id,session_id,case_id,initial_case_id,initial_origin,started_at,ended_at,detected_duration_ms,duration_override_ms,
      assignment_origin,time_validation_status,effective_revision,validated_effective_revision,time_validated_at,
      billing_status,billed_at,applied_hourly_rate_cents,applied_currency,revision,assignment_revision,created_at,updated_at,
      task_type_id,label,billable,nonbillable_reason,excluded,demo_app,demo_window_title,demo_confidence,invoice_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const block of blocks) {
      const entry = byBlock.get(Number(block.id));
      const caseId = entry?.matter_id == null ? null : asText(entry.matter_id);
      const date = asText(block.date);
      const start = timestamp(date,asText(block.start_time));
      const end = block.end_time == null ? null : timestamp(date,asText(block.end_time));
      const excluded = block.state === 'discarded';
      const validated = entry?.review_status === 'approved';
      const billed = entry?.billing_status === 'billed';
      // The reviewed mockup correction is explicit; detection remains the
      // original 152-minute observation for comparison and replay.
      const demoOverride = Number(entry?.id) === 14 ? 108*60000 : null;
      const rate = caseId ? Number(caseRates.get(caseId) ?? clientRates.get(clients.get(caseId)!) ?? firm.base_rate_cents) : null;
      insertPeriod.run(asText(entry?.id ?? `excluded-${block.id}`),`demo-${date}`,caseId,caseId,caseId ? 'automatic' : 'unresolved',start,end,
        Number(block.minutes)*60000,demoOverride,caseId ? 'automatic' : 'unresolved',validated ? 'validated' : 'unvalidated',0,validated ? 0 : null,validated ? end ?? start : null,
        billed ? 'billed' : 'unbilled',billed ? now : null,billed ? rate : null,billed ? 'USD' : null,0,0,now,now,
        entry?.task_id ?? block.task_id,entry?.label ?? `${block.app} · ${block.window_title}`,entry?.billable ?? 0,entry?.reason ?? null,excluded ? 1 : 0,
        block.app,block.window_title,block.confidence,entry?.invoice_id ?? null);
      db.prepare('INSERT INTO demo_block_periods(block_id,period_id) VALUES (?,?)').run(block.id,asText(entry?.id ?? `excluded-${block.id}`));
    }
    for (const entry of entries.filter(e=>e.block_id === null)) {
      const date=asText(entry.date);
      const start=timestamp(date,`12:${String(Number(entry.id)%60).padStart(2,'0')}`);
      const end=new Date(Date.parse(start)+Number(entry.tenths_of_hour)*360000).toISOString();
      const caseId=entry.matter_id === null ? null : asText(entry.matter_id);
      const validated=entry.review_status === 'approved';
      const billed=entry.billing_status === 'billed';
      const rate=caseId ? Number(caseRates.get(caseId) ?? clientRates.get(clients.get(caseId)!) ?? firm.base_rate_cents) : null;
      insertPeriod.run(asText(entry.id),`demo-${date}`,caseId,caseId,'lawyer',start,end,null,Number(entry.tenths_of_hour)*360000,
        'lawyer',validated ? 'validated' : 'unvalidated',0,validated ? 0 : null,validated ? end : null,
        billed ? 'billed' : 'unbilled',billed ? now : null,billed ? rate : null,billed ? 'USD' : null,0,0,now,now,
        entry.task_id,entry.label,entry.billable,entry.reason,0,null,null,null,entry.invoice_id);
    }
    for (const source of rows(db,'source')) {
      const entry=byBlock.get(Number(source.block_id));
      const block=blocks.find(b=>b.id === source.block_id)!;
      const observed=asText(source.timestamp);
      const recordedAt=observed.includes('T') ? observed : timestamp(asText(block.date),observed.slice(0,5));
      const validatedSource=[1,2,3,4,16].includes(Number(source.id));
      const availableSource=Number(source.id) !== 2 && Boolean(source.available);
      db.prepare(`INSERT INTO sources(id,work_period_id,screenpipe_instance_id,content_type,external_id,recorded_at,ingested_at,app_name,window_name,validation_status,validated_at,availability_status,availability_checked_at,excerpt,detected_marker)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(asText(source.id),asText(entry?.id ?? `excluded-${block.id}`),'demo',source.type,source.screenpipe_ref,recordedAt,now,block.app,block.window_title,
        validatedSource ? 'validated' : 'unvalidated',validatedSource ? now : null,availableSource ? 'available' : 'unavailable',now,source.excerpt,source.detected_marker);
    }
    db.prepare(`INSERT INTO pending_questions(question_id,session_id,work_period_id,expected_assignment_revision,status) VALUES (?,?,?,?,?)`).run('demo-question-13','demo-2026-10-16','13',0,'pending');
    db.prepare(`INSERT INTO retrieval_progress(id,session_id,screenpipe_instance_id,requested_start_at,requested_end_at,status)
      VALUES (?,?,?,?,?,'failed')`).run('demo-gap-1124','demo-2026-10-16','demo','2026-10-16T11:24:00Z','2026-10-16T12:05:00Z');
    for (const line of rows(db,'invoice_line')) db.prepare(`INSERT INTO invoice_lines(id,invoice_id,origin,origin_id,label,billed_minutes,rate_cents,amount_cents,vat,period_ids_json) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      line.id,line.invoice_id,line.origin === 'time_entry' ? 'work_period' : line.origin,asText(line.origin_id),line.label,Number(line.tenths_of_hour)*6,line.rate_cents,line.amount_cents,line.vat,
      line.origin === 'time_entry' ? JSON.stringify([asText(line.origin_id)]) : null);
    for (const expense of rows(db,'expense')) db.prepare(`INSERT INTO expenses(id,case_id,date,label,type,amount_cents,invoice_id) VALUES (?,?,?,?,?,?,?)`).run(expense.id,asText(expense.matter_id),expense.date,expense.label,expense.type,expense.amount_cents,expense.invoice_id);
    for (const event of rows(db,'audit_event')) db.prepare(`INSERT INTO audit_events(id,work_period_id,timestamp,actor,action,before,after) VALUES (?,?,?,?,?,?,?)`).run(event.id,event.time_entry_id === null ? null : asText(event.time_entry_id),event.timestamp,event.actor,event.action,event.before,event.after);
    for (const review of rows(db,'jev_review')) {
      const entry=byBlock.get(Number(review.block_id));
      db.prepare(`INSERT INTO jev_reviews(id,work_period_id,question,answer,probability,sent_data) VALUES (?,?,?,?,?,?)`).run(review.id,asText(entry?.id ?? `excluded-${review.block_id}`),review.question,review.answer,review.probability,review.sent_data);
    }
    db.exec('RELEASE demo_seed');
  } catch (error) {
    db.exec('ROLLBACK TO demo_seed');
    db.exec('RELEASE demo_seed');
    throw error;
  }
}
