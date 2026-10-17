import type { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import type { SourceExportPort } from "../../ports/source-export.js";
import { TimeKeeperService } from "../../application/service.js";
import { SqliteRepository } from "./core-repository.js";
import { catalogRepository, readCatalog } from "./catalog-repository.js";
import { orm } from "./orm.js";
import * as t from "./tables.js";
import { transaction } from "./transaction.js";

export function sourceExportPort(db: DatabaseSync): SourceExportPort {
  const query = orm(db);
  const core = new TimeKeeperService(new SqliteRepository(db));
  return {
    transaction: (work) => transaction(db, work),
    snapshot: () => ({
      catalog: readCatalog(db),
      periods: core.allPeriods(),
      sources: core.allSources(),
      auditEvents: catalogRepository(db).auditEvents(),
    }),
    invoiceCaseId(id) {
      return query
        .select({ caseId: t.invoices.case_id })
        .from(t.invoices)
        .where(eq(t.invoices.id, id))
        .get()?.caseId;
    },
    saveReceipt(value) {
      const row = query
        .insert(t.source_exports)
        .values({
          period_ids_json: JSON.stringify(value.periodIds),
          options_json: JSON.stringify(value.options),
          sha256: value.sha256,
          created_at: value.createdAt,
        })
        .returning({ id: t.source_exports.id })
        .get();
      return { id: row.id, ...value };
    },
    auditExport(hash, at) {
      query
        .insert(t.audit_events)
        .values({
          work_period_id: null,
          timestamp: at,
          actor: "Lawyer",
          action: "Source pack generated",
          before: "",
          after: `SHA-256 ${hash}`,
        })
        .run();
    },
    invoice(id) {
      const header = query
        .select({
          number: t.invoices.number,
          date: t.invoices.date,
          vatCents: t.invoices.vat_cents,
          currency: t.invoices.currency,
          clientName: t.clients.name,
          caseTitle: t.cases.title,
        })
        .from(t.invoices)
        .innerJoin(t.cases, eq(t.cases.id, t.invoices.case_id))
        .innerJoin(t.clients, eq(t.clients.id, t.cases.client_id))
        .where(eq(t.invoices.id, id))
        .get();
      if (!header) return undefined;
      const lines = query
        .select({
          label: t.invoice_lines.label,
          billedMinutes: t.invoice_lines.billed_minutes,
          rateCents: t.invoice_lines.rate_cents,
          amountCents: t.invoice_lines.amount_cents,
          vat: t.invoice_lines.vat,
        })
        .from(t.invoice_lines)
        .where(eq(t.invoice_lines.invoice_id, id))
        .orderBy(t.invoice_lines.id)
        .all()
        .map((line) => ({ ...line, vat: Boolean(line.vat) }));
      return { ...header, vatCents: header.vatCents ?? 0, lines };
    },
  };
}
