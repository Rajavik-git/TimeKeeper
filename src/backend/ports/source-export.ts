import type { components } from "../../contracts/generated.js";
import type { PeriodView } from "../../contracts/index.js";
import type { CatalogAuditEvent, CatalogState } from "./catalog.js";
import type { SourceRecord } from "./repository.js";

export interface InvoiceExport {
  number: string;
  date: string;
  vatCents: number;
  currency: string | null;
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
export type SourceExportRequest = components["schemas"]["CanonicalSourcePackRequest"];
export type SourceExportScope = SourceExportRequest["scope"];
export type SourceExportReceipt = components["schemas"]["SourceExportReceipt"];
export type SourceExportResponse = components["schemas"]["CanonicalSourcePackResponse"];
export interface SourceExportSnapshot {
  catalog: CatalogState;
  periods: PeriodView[];
  sources: SourceRecord[];
  auditEvents: CatalogAuditEvent[];
}
export interface SourceExportPort {
  transaction<T>(work: () => T): T;
  snapshot(): SourceExportSnapshot;
  invoiceCaseId(id: number): string | undefined;
  saveReceipt(value: Omit<SourceExportReceipt, "id">): SourceExportReceipt;
  auditExport(hash: string, at: string): void;
  invoice(id: number): InvoiceExport | undefined;
}
