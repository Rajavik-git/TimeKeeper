import type { DatabaseSync } from 'node:sqlite';
import type { DemoPort, DemoTable, InvoiceExport } from '../../ports/demo.js';
import { all, audit, insert, one, rate, reset, state, transaction, update } from './repository.js';
import { recognizeBlock } from './recognition.js';
import { syncDemoCatalog } from './catalog.js';
import { SqliteRepository } from './core-repository.js';
import { AppError } from '../../ports/errors.js';

type RawRow = Record<string, string | number | null>;

export function demoPort(db: DatabaseSync): DemoPort {
  const canonical = new SqliteRepository(db);
  return {
    transaction: work => transaction(db, work),
    state: () => state(db),
    reset: () => reset(db),
    rows: table => all(db, table),
    get: (table, id) => one(db, table, id),
    insert: (table, values) => insert(db, table, values),
    update: (table, id, values) => update(db, table, id, values),
    delete: (table: DemoTable, id: number) => {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    },
    audit: (action, before, after, entryId, blockId, actor) =>
      audit(db, action, before, after, entryId, blockId, actor),
    rate: caseId => rate(db, caseId),
    recognition: block => recognizeBlock(db, block),
    nextCaseSequence: year => {
      const result = db.prepare(
        'SELECT COALESCE(MAX(CAST(substr(reference,6,3) AS INTEGER)),0) AS last FROM matter WHERE substr(reference,1,4)=?',
      ).get(String(year)) as { last: number };
      return Number(result.last);
    },
    syncCatalog: () => syncDemoCatalog(db),
    invoiceExport: (id): InvoiceExport | undefined => {
      const header = db.prepare(`SELECT i.number,i.date,c.name AS client_name,ca.title AS case_title
        FROM invoices i JOIN cases ca ON ca.id=i.case_id JOIN clients c ON c.id=ca.client_id
        WHERE i.id=?`).get(id) as RawRow | undefined;
      if (!header) return undefined;
      const lines = db.prepare(`SELECT label,billed_minutes,rate_cents,amount_cents,vat
        FROM invoice_lines WHERE invoice_id=? ORDER BY id`).all(id) as RawRow[];
      return {
        number: String(header.number), date: String(header.date),
        clientName: String(header.client_name), caseTitle: String(header.case_title),
        lines: lines.map(line => ({
          label: String(line.label), billedMinutes: Number(line.billed_minutes),
          rateCents: Number(line.rate_cents), amountCents: Number(line.amount_cents),
          vat: Boolean(line.vat),
        })),
      };
    },
    canonicalPeriod: id => canonical.period(id),
    canonicalPeriodForBlock: blockId => {
      const link=db.prepare('SELECT period_id FROM demo_block_periods WHERE block_id=?').get(blockId) as {period_id:string}|undefined;
      return link ? canonical.period(link.period_id) : null;
    },
    canonicalSession: id => canonical.session(id),
    saveCanonicalPeriod: (period, at) => canonical.savePeriod(period, at),
    insertCanonicalPeriod: (period, at) => canonical.insertPeriod(period, at),
    pendingQuestions: periodId => canonical.allQuestions().filter(question =>
      question.periodId === periodId && question.status === 'pending'),
    saveQuestion: question => canonical.saveQuestion(question),
    insertCanonicalExpense: expense => {
      db.prepare(`INSERT INTO expenses(id,case_id,date,label,type,amount_cents,invoice_id)
        VALUES (?,?,?,?,?,?,NULL)`).run(Number(expense.id), String(expense.matter_id),
        String(expense.date), String(expense.label), String(expense.type), Number(expense.amount_cents));
    },
    removeCanonicalExpense: expense => {
      const canonicalExpense = db.prepare('SELECT * FROM expenses WHERE id=?').get(Number(expense.id)) as RawRow | undefined;
      if (!canonicalExpense || String(canonicalExpense.case_id) !== String(expense.matter_id) ||
          canonicalExpense.date !== expense.date || canonicalExpense.label !== expense.label ||
          canonicalExpense.type !== expense.type || canonicalExpense.amount_cents !== expense.amount_cents)
        throw new AppError('conflict', 'Canonical expense does not match');
      if (canonicalExpense.invoice_id !== null) throw new AppError('conflict', 'Expense already billed');
      db.prepare('DELETE FROM expenses WHERE id=?').run(Number(expense.id));
    },
  };
}
