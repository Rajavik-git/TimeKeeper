export interface InvoicePeriod {
  effectiveDurationMs: number | null;
  id: string;
  caseId: string | null;
  effectiveRevision: number;
  validatedEffectiveRevision: number | null;
  billingStatus: "billed" | "unbilled";
  billable: boolean;
  excluded: boolean;
  invoiceId: number | null;
}
export interface InvoiceExpense {
  id: number;
  caseId: string;
  invoiceId: number | null;
  amountCents: number;
  type: "expense" | "disbursement";
}
export interface InvoiceCase {
  vatRate: number;
  vatApplicable: boolean;
  id: string;
  mode: "hourly" | "flat_fee";
  flatFeeCents: number | null;
  caseRateCents: number | null;
  clientRateCents: number | null;
  globalRateCents: number;
}
export interface FrozenLine {
  origin: "work_period" | "expense" | "flat_fee";
  originId: string;
  label: string;
  billedMinutes: number;
  rateCents: number;
  amountCents: number;
  vat: boolean;
}
export interface InvoiceSnapshot {
  timeZone?: string;
  caseId: number | string;
  type: "deposit" | "final";
  periodIds: string[];
  revisions: Record<string, number>;
  billedMinutes: number;
  rateCents: number;
  rateOrigin: "matter" | "client" | "base" | "flat_fee";
  feesCents: number;
  subtotalCents: number;
  expensesCents: number;
  disbursementsCents: number;
  vatCents: number;
  totalCents: number;
  lines: FrozenLine[];
}
export interface InvoicePort {
  transaction<T>(work: () => T): T;
  getCase(id: string): InvoiceCase | null;
  getPeriod(id: string): InvoicePeriod | null;
  getExpense(id: number): InvoiceExpense | null;
  getRuleContext(
    caseId: string,
    periodIds: string[],
  ): {
    rules: Array<{ type: string; value: number }>;
    periods: Array<{
      id: string;
      startedAt: string;
      taskCode: string | null;
      effectiveDurationMs: number | null;
    }>;
  };
  hasFinalInvoice(caseId: string): boolean;
  nextInvoice(): { number: string; sequence: number };
  createInvoice(snapshot: InvoiceSnapshot, number: string, at: string): number;
  markPeriodBilled(id: string, invoiceId: number, rateCents: number, at: string): void;
  markExpenseBilled(id: number, invoiceId: number): void;
  advanceInvoiceSequence(sequence: number): void;
  listInvoices(): Array<{
    id: number;
    caseId: string;
    number: string;
    date: string;
    type: "deposit" | "final";
    status: string;
    subtotalCents: number;
    vatCents: number;
    disbursementsCents: number;
    totalCents: number;
    currency: string | null;
  }>;
  listInvoiceLines(): Array<{
    id: number;
    invoiceId: number;
    origin: string;
    originId: string;
    label: string;
    billedMinutes: number;
    rateCents: number;
    amountCents: number;
    vat: boolean;
  }>;
  listExpenses(): Array<{
    id: number;
    caseId: string;
    date: string;
    label: string;
    type: "expense" | "disbursement";
    amountCents: number;
    invoiceId: number | null;
  }>;
  addExpense(input: {
    caseId: string;
    date: string;
    label: string;
    type: "expense" | "disbursement";
    amountCents: number;
  }): number;
  removeExpense(id: number): void;
}
