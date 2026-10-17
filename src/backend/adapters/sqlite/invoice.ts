import type { DatabaseSync } from 'node:sqlite';
import type { InvoiceCase, InvoiceExpense, InvoicePeriod, InvoicePort, InvoiceSnapshot } from '../../ports/invoice.js';

type Row = Record<string, unknown>;
export function invoicePort(db: DatabaseSync): InvoicePort {
  return {
    transaction<T>(work:()=>T):T {
      db.exec('SAVEPOINT issue_invoice');
      try { const result=work(); db.exec('RELEASE issue_invoice'); return result; }
      catch (error) { db.exec('ROLLBACK TO issue_invoice'); db.exec('RELEASE issue_invoice'); throw error; }
    },
    getCase(id):InvoiceCase|null {
      const row=db.prepare(`SELECT c.id,c.mode,c.flat_fee_cents,c.hourly_rate_cents AS case_rate,
        cl.hourly_rate_cents AS client_rate,s.global_hourly_rate_cents AS global_rate
        FROM cases c JOIN clients cl ON cl.id=c.client_id JOIN settings s ON s.id=1 WHERE c.id=?`).get(id) as Row | undefined;
      return row ? {id:String(row.id),mode:row.mode as InvoiceCase['mode'],flatFeeCents:row.flat_fee_cents as number|null,
        caseRateCents:row.case_rate as number|null,clientRateCents:row.client_rate as number|null,
        globalRateCents:Number(row.global_rate)} : null;
    },
    getPeriod(id):InvoicePeriod|null {
      const row=db.prepare('SELECT * FROM work_periods WHERE id=?').get(id) as Row | undefined;
      return row ? {id:String(row.id),caseId:row.case_id as string|null,effectiveRevision:Number(row.effective_revision),
        validatedEffectiveRevision:row.validated_effective_revision as number|null,
        billingStatus:row.billing_status as InvoicePeriod['billingStatus'],billable:Boolean(row.billable),excluded:Boolean(row.excluded),
        invoiceId:row.invoice_id as number|null} : null;
    },
    getExpense(id):InvoiceExpense|null {
      const row=db.prepare('SELECT id,case_id,invoice_id,amount_cents,type FROM expenses WHERE id=?').get(id) as Row | undefined;
      return row ? {id:Number(row.id),caseId:String(row.case_id),invoiceId:row.invoice_id as number|null,
        amountCents:Number(row.amount_cents),type:row.type as InvoiceExpense['type']} : null;
    },
    getRuleContext(caseId,periodIds) {
      const rules=(db.prepare(`SELECT r.type,r.value FROM client_rules r JOIN cases c ON c.client_id=r.client_id WHERE c.id=?`).all(caseId) as Row[])
        .map(row=>({type:String(row.type),value:Number(row.value)}));
      const selected=new Set(periodIds);
      const periods=(db.prepare(`SELECT p.id,p.started_at,p.billing_status,t.code AS task_code,
          COALESCE(p.duration_override_ms,p.detected_duration_ms) AS effective_ms
        FROM work_periods p JOIN cases c ON c.id=p.case_id LEFT JOIN task_types t ON t.id=p.task_type_id
        WHERE c.client_id=(SELECT client_id FROM cases WHERE id=?) AND p.billable=1 AND p.excluded=0`).all(caseId) as Row[])
        .filter(row=>row.billing_status==='billed'||selected.has(String(row.id))).map(row=>({
        id:String(row.id),startedAt:String(row.started_at),taskCode:row.task_code===null?null:String(row.task_code),
        effectiveDurationMs:row.effective_ms===null?null:Number(row.effective_ms),
      }));
      return {rules,periods};
    },
    hasFinalInvoice(caseId) { return Boolean(db.prepare("SELECT 1 FROM invoices WHERE case_id=? AND type='final' LIMIT 1").get(caseId)); },
    nextInvoice() {
      const row=db.prepare('SELECT invoice_prefix,next_number FROM settings WHERE id=1').get() as Row | undefined;
      if (!row) throw Error('invoice settings missing');
      return {number:String(row.invoice_prefix)+String(row.next_number).padStart(4,'0'),sequence:Number(row.next_number)};
    },
    createInvoice(snapshot:InvoiceSnapshot,number:string,at:string):number {
      const result=db.prepare(`INSERT INTO invoices(case_id,number,date,type,status,subtotal_cents,vat_cents,disbursements_cents,total_cents,snapshot_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(String(snapshot.caseId),number,at.slice(0,10),snapshot.type,'issued',snapshot.subtotalCents,
        snapshot.vatCents,snapshot.disbursementsCents,snapshot.totalCents,JSON.stringify({...snapshot,number,issuedAt:at}));
      const invoiceId=Number(result.lastInsertRowid);
      const insert=db.prepare(`INSERT INTO invoice_lines(invoice_id,origin,origin_id,label,billed_minutes,rate_cents,amount_cents,vat,period_ids_json)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const line of snapshot.lines) insert.run(invoiceId,line.origin,line.originId,line.label,line.billedMinutes,line.rateCents,line.amountCents,
        line.vat ? 1 : 0,line.origin === 'work_period' ? JSON.stringify(snapshot.periodIds) : null);
      return invoiceId;
    },
    markPeriodBilled(id,invoiceId,rateCents,at) {
      db.prepare(`UPDATE work_periods SET billing_status='billed',billed_at=?,applied_hourly_rate_cents=?,applied_currency='EUR',invoice_id=?,revision=revision+1,updated_at=? WHERE id=?`).run(at,rateCents,invoiceId,at,id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='time_entry'").get()) {
        const entry=db.prepare(`SELECT e.id FROM time_entry e LEFT JOIN demo_block_periods link ON link.block_id=e.block_id
          WHERE link.period_id=? OR (e.block_id IS NULL AND CAST(e.id AS TEXT)=?) LIMIT 1`).get(id,id) as {id:number}|undefined;
        if (entry) db.prepare("UPDATE time_entry SET billing_status='billed' WHERE id=?").run(entry.id);
      }
    },
    markExpenseBilled(id,invoiceId) { db.prepare('UPDATE expenses SET invoice_id=? WHERE id=?').run(invoiceId,id); },
    advanceInvoiceSequence(sequence) {
      db.prepare('UPDATE settings SET next_number=? WHERE id=1 AND next_number=?').run(sequence+1,sequence);
      db.prepare('UPDATE setting SET next_number=? WHERE id=1 AND next_number=?').run(sequence+1,sequence);
    },
    listInvoices() { return (db.prepare('SELECT * FROM invoices ORDER BY id').all() as Row[]).map(row=>({
      id:Number(row.id),caseId:String(row.case_id),number:String(row.number),date:String(row.date),
      type:row.type as 'deposit'|'final',status:String(row.status),subtotalCents:Number(row.subtotal_cents ?? 0),
      vatCents:Number(row.vat_cents ?? 0),disbursementsCents:Number(row.disbursements_cents ?? 0),totalCents:Number(row.total_cents ?? 0),
    })); },
    listInvoiceLines() { return (db.prepare('SELECT * FROM invoice_lines ORDER BY id').all() as Row[]).map(row=>({
      id:Number(row.id),invoiceId:Number(row.invoice_id),origin:String(row.origin),originId:String(row.origin_id),label:String(row.label),
      billedMinutes:Number(row.billed_minutes),rateCents:Number(row.rate_cents),amountCents:Number(row.amount_cents),vat:Boolean(row.vat),
    })); },
    listExpenses() { return (db.prepare('SELECT * FROM expenses ORDER BY id').all() as Row[]).map(row=>({
      id:Number(row.id),caseId:String(row.case_id),date:String(row.date),label:String(row.label),
      type:row.type as 'expense'|'disbursement',amountCents:Number(row.amount_cents),invoiceId:row.invoice_id as number|null,
    })); },
    addExpense(value) { return Number(db.prepare('INSERT INTO expenses(case_id,date,label,type,amount_cents) VALUES (?,?,?,?,?)').run(
      value.caseId,value.date,value.label,value.type,value.amountCents).lastInsertRowid); },
    removeExpense(id) { db.prepare('DELETE FROM expenses WHERE id=? AND invoice_id IS NULL').run(id); },
  };
}
