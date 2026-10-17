import { calendarDay } from "../../../shared/dates.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { orm } from "./orm.js";
import * as tables from "./tables.js";
import { transaction } from "./transaction.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  InvoiceCase,
  InvoiceExpense,
  InvoicePeriod,
  InvoicePort,
  InvoiceSnapshot,
} from "../../ports/invoice.js";

type Row = Record<string, unknown>;
export function invoicePort(db: DatabaseSync): InvoicePort {
  return {
    transaction: (work) => transaction(db, work),
    getCase(id): InvoiceCase | null {
      const row = orm(db)
        .select({
          id: tables.cases.id,
          mode: tables.cases.mode,
          flat_fee_cents: tables.cases.flat_fee_cents,
          case_rate: tables.cases.hourly_rate_cents,
          client_rate: tables.clients.hourly_rate_cents,
          global_rate: tables.settings.global_hourly_rate_cents,
          vat_rate: tables.settings.vat_rate,
          vat_applicable: tables.clients.vat_applicable,
        })
        .from(tables.cases)
        .innerJoin(tables.clients, eq(tables.clients.id, tables.cases.client_id))
        .innerJoin(tables.settings, eq(tables.settings.id, 1))
        .where(eq(tables.cases.id, id))
        .get();
      return row
        ? {
            id: String(row.id),
            mode: row.mode as InvoiceCase["mode"],
            flatFeeCents: row.flat_fee_cents as number | null,
            caseRateCents: row.case_rate as number | null,
            clientRateCents: row.client_rate as number | null,
            globalRateCents: Number(row.global_rate),
            vatRate: Number(row.vat_rate),
            vatApplicable: Boolean(row.vat_applicable),
          }
        : null;
    },
    getPeriod(id): InvoicePeriod | null {
      const row = orm(db)
        .select()
        .from(tables.work_periods)
        .where(eq(tables.work_periods.id, id))
        .get() as Row | undefined;
      return row
        ? {
            effectiveDurationMs: (row.duration_override_ms ?? row.detected_duration_ms ?? null) as
              number | null,
            id: String(row.id),
            caseId: row.case_id as string | null,
            effectiveRevision: Number(row.effective_revision),
            validatedEffectiveRevision: row.validated_effective_revision as number | null,
            billingStatus: row.billing_status as InvoicePeriod["billingStatus"],
            billable: Boolean(row.billable),
            excluded: Boolean(row.excluded),
            invoiceId: row.invoice_id as number | null,
          }
        : null;
    },
    getExpense(id): InvoiceExpense | null {
      const row = orm(db).select().from(tables.expenses).where(eq(tables.expenses.id, id)).get() as
        Row | undefined;
      return row
        ? {
            id: Number(row.id),
            caseId: String(row.case_id),
            invoiceId: row.invoice_id as number | null,
            amountCents: Number(row.amount_cents),
            type: row.type as InvoiceExpense["type"],
          }
        : null;
    },
    // This existing multi-table billing selection remains SQL; its domain calculations stay in the application.
    getRuleContext(caseId, periodIds) {
      const rules = (
        db
          .prepare(
            `SELECT r.type,r.value FROM client_rules r JOIN cases c ON c.client_id=r.client_id WHERE c.id=?`,
          )
          .all(caseId) as Row[]
      ).map((row) => ({ type: String(row.type), value: Number(row.value) }));
      const selected = new Set(periodIds);
      const periods = (
        db
          .prepare(
            `SELECT p.id,p.started_at,p.billing_status,t.code AS task_code,
          COALESCE(p.duration_override_ms,p.detected_duration_ms) AS effective_ms
        FROM work_periods p JOIN cases c ON c.id=p.case_id LEFT JOIN task_types t ON t.id=p.task_type_id
        WHERE c.client_id=(SELECT client_id FROM cases WHERE id=?) AND p.billable=1 AND p.excluded=0`,
          )
          .all(caseId) as Row[]
      )
        .filter((row) => row.billing_status === "billed" || selected.has(String(row.id)))
        .map((row) => ({
          id: String(row.id),
          startedAt: String(row.started_at),
          taskCode: row.task_code === null ? null : String(row.task_code),
          effectiveDurationMs: row.effective_ms === null ? null : Number(row.effective_ms),
        }));
      return { rules, periods };
    },
    hasFinalInvoice(caseId) {
      return Boolean(
        orm(db)
          .select({ id: tables.invoices.id })
          .from(tables.invoices)
          .where(and(eq(tables.invoices.case_id, caseId), eq(tables.invoices.type, "final")))
          .limit(1)
          .get(),
      );
    },
    nextInvoice() {
      const row = orm(db).select().from(tables.settings).where(eq(tables.settings.id, 1)).get() as
        Row | undefined;
      if (!row) throw Error("invoice settings missing");
      return {
        number: String(row.invoice_prefix) + String(row.next_number).padStart(4, "0"),
        sequence: Number(row.next_number),
      };
    },
    createInvoice(snapshot: InvoiceSnapshot, number: string, at: string): number {
      const currency =
        orm(db)
          .select({ currency: tables.settings.currency })
          .from(tables.settings)
          .where(eq(tables.settings.id, 1))
          .get()?.currency ?? null;
      const result = orm(db)
        .insert(tables.invoices)
        .values({
          case_id: String(snapshot.caseId),
          number,
          date: calendarDay(at, snapshot.timeZone),
          type: snapshot.type,
          status: "issued",
          subtotal_cents: snapshot.subtotalCents,
          vat_cents: snapshot.vatCents,
          disbursements_cents: snapshot.disbursementsCents,
          total_cents: snapshot.totalCents,
          snapshot_json: JSON.stringify({ ...snapshot, number, issuedAt: at }),
          currency,
        })
        .run();
      const invoiceId = Number(result.lastInsertRowid);
      for (const line of snapshot.lines) {
        orm(db)
          .insert(tables.invoice_lines)
          .values({
            invoice_id: invoiceId,
            origin: line.origin,
            origin_id: line.originId,
            label: line.label,
            billed_minutes: line.billedMinutes,
            rate_cents: line.rateCents,
            amount_cents: line.amountCents,
            vat: line.vat ? 1 : 0,
            period_ids_json:
              line.origin === "work_period" ? JSON.stringify(snapshot.periodIds) : null,
          })
          .run();
      }
      return invoiceId;
    },
    markPeriodBilled(id, invoiceId, rateCents, at) {
      orm(db)
        .update(tables.work_periods)
        .set({
          billing_status: "billed",
          billed_at: at,
          applied_hourly_rate_cents: rateCents,
          applied_currency: sql`(SELECT currency FROM settings WHERE id=1)`,
          invoice_id: invoiceId,
          revision: sql`${tables.work_periods.revision}+1`,
          updated_at: at,
        })
        .where(eq(tables.work_periods.id, id))
        .run();
    },
    markExpenseBilled(id, invoiceId) {
      orm(db)
        .update(tables.expenses)
        .set({ invoice_id: invoiceId })
        .where(eq(tables.expenses.id, id))
        .run();
    },
    advanceInvoiceSequence(sequence) {
      orm(db)
        .update(tables.settings)
        .set({ next_number: sequence + 1 })
        .where(and(eq(tables.settings.id, 1), eq(tables.settings.next_number, sequence)))
        .run();
    },
    listInvoices() {
      return orm(db)
        .select()
        .from(tables.invoices)
        .orderBy(tables.invoices.id)
        .all()
        .map((row) => ({
          id: Number(row.id),
          caseId: String(row.case_id),
          number: String(row.number),
          date: String(row.date),
          type: row.type as "deposit" | "final",
          status: String(row.status),
          subtotalCents: Number(row.subtotal_cents ?? 0),
          vatCents: Number(row.vat_cents ?? 0),
          disbursementsCents: Number(row.disbursements_cents ?? 0),
          totalCents: Number(row.total_cents ?? 0),
          currency: row.currency === null ? null : String(row.currency),
        }));
    },
    listInvoiceLines() {
      return orm(db)
        .select()
        .from(tables.invoice_lines)
        .orderBy(tables.invoice_lines.id)
        .all()
        .map((row) => ({
          id: Number(row.id),
          invoiceId: Number(row.invoice_id),
          origin: String(row.origin),
          originId: String(row.origin_id),
          label: String(row.label),
          billedMinutes: Number(row.billed_minutes),
          rateCents: Number(row.rate_cents),
          amountCents: Number(row.amount_cents),
          vat: Boolean(row.vat),
        }));
    },
    listExpenses() {
      return orm(db)
        .select()
        .from(tables.expenses)
        .orderBy(tables.expenses.id)
        .all()
        .map((row) => ({
          id: Number(row.id),
          caseId: String(row.case_id),
          date: String(row.date),
          label: String(row.label),
          type: row.type as "expense" | "disbursement",
          amountCents: Number(row.amount_cents),
          invoiceId: row.invoice_id as number | null,
        }));
    },
    addExpense(value) {
      return Number(
        orm(db)
          .insert(tables.expenses)
          .values({
            case_id: value.caseId,
            date: value.date,
            label: value.label,
            type: value.type,
            amount_cents: value.amountCents,
          })
          .run().lastInsertRowid,
      );
    },
    removeExpense(id) {
      orm(db)
        .delete(tables.expenses)
        .where(and(eq(tables.expenses.id, id), isNull(tables.expenses.invoice_id)))
        .run();
    },
  };
}
