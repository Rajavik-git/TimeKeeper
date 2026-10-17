import type { components } from "../../contracts/generated.js";
import type { Candidate } from "../domain/recognition.js";
import type { PeriodRecord, QuestionRecord } from "./repository.js";

export type CompatibilityRow = Record<string, unknown>;
export type CompatibilityTable =
  | "firm"
  | "setting"
  | "task"
  | "client"
  | "matter"
  | "marker"
  | "client_rule"
  | "block"
  | "source"
  | "pause"
  | "jev_review"
  | "invoice"
  | "time_entry"
  | "expense"
  | "invoice_line"
  | "audit_event"
  | "source_export";

export type { InvoiceExport } from "./source-export.js";
import type { InvoiceExport } from "./source-export.js";

/** Storage operations used to translate the legacy UI contract into canonical records. */
export interface CompatibilityPort {
  transaction<T>(work: () => T): T;
  state(): components["schemas"]["State"];
  rows(table: CompatibilityTable): CompatibilityRow[];
  get(table: CompatibilityTable, id: number | string): CompatibilityRow | undefined;
  insert(table: CompatibilityTable, values: CompatibilityRow): CompatibilityRow;
  update(
    table: CompatibilityTable,
    id: number | string,
    values: CompatibilityRow,
  ): CompatibilityRow;
  delete(table: CompatibilityTable, id: number | string): void;
  audit(
    action: string,
    before?: string,
    after?: string,
    entryId?: number | null,
    blockId?: number | null,
    actor?: string,
  ): void;
  rate(caseId: number | string | null): { origin: string };
  recognition(block: CompatibilityRow): Candidate[];
  lastCaseSequence(year: number): number;
  invoiceExport(id: number): InvoiceExport | undefined;
  canonicalPeriodForEntry(id: number): PeriodRecord | null;
  ensureCompatibilityEntryId(periodId: string): number;
  canonicalPeriod(id: string): PeriodRecord | null;
  canonicalPeriodForBlock(blockId: number): PeriodRecord | null;
  saveCanonicalPeriod(period: PeriodRecord, at: string): void;
  pendingQuestions(periodId: string): QuestionRecord[];
  saveQuestion(question: QuestionRecord): void;
  insertCanonicalExpense(expense: CompatibilityRow): void;
  assertExpenseCanBeRemoved(expense: CompatibilityRow): void;
}
