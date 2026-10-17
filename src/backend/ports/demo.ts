import type { components } from '../../contracts/generated.js';
import type { Candidate } from '../domain/recognition.js';
import type { PeriodRecord, QuestionRecord, SessionRecord } from './repository.js';

export type DemoRow = Record<string, unknown>;
export type DemoTable =
  | 'firm' | 'setting' | 'task' | 'client' | 'matter' | 'marker'
  | 'client_rule' | 'block' | 'source' | 'pause' | 'jev_review'
  | 'invoice' | 'time_entry' | 'expense' | 'invoice_line'
  | 'audit_event' | 'source_export';

export interface InvoiceExport {
  number: string;
  date: string;
  clientName: string;
  caseTitle: string;
  lines: Array<{
    label: string;
    billedMinutes: number;
    rateCents: number;
    amountCents: number;
    vat: boolean;
  }>;
}

/** Storage and demo recognition operations used by the retained mockup API. */
export interface DemoPort {
  transaction<T>(work: () => T): T;
  state(): components['schemas']['State'];
  reset(): void;
  rows(table: DemoTable): DemoRow[];
  get(table: DemoTable, id: number): DemoRow | undefined;
  insert(table: DemoTable, values: DemoRow): DemoRow;
  update(table: DemoTable, id: number, values: DemoRow): DemoRow;
  delete(table: DemoTable, id: number): void;
  audit(action: string, before?: string, after?: string, entryId?: number | null, blockId?: number | null, actor?: string): void;
  rate(caseId: number | null): { origin: string };
  recognition(block: DemoRow): Candidate[];
  nextCaseSequence(year: number): number;
  syncCatalog(): void;
  invoiceExport(id: number): InvoiceExport | undefined;
  canonicalPeriod(id: string): PeriodRecord | null;
  canonicalPeriodForBlock(blockId: number): PeriodRecord | null;
  canonicalSession(id: string): SessionRecord | null;
  saveCanonicalPeriod(period: PeriodRecord, at: string): void;
  insertCanonicalPeriod(period: PeriodRecord, at: string): void;
  pendingQuestions(periodId: string): QuestionRecord[];
  saveQuestion(question: QuestionRecord): void;
  insertCanonicalExpense(expense: DemoRow): void;
  removeCanonicalExpense(expense: DemoRow): void;
}
