import { HistoryService } from "./application/history.js";
import { historyStorage } from "./adapters/sqlite/history.js";
import type { HistoryRunner } from "./ports/history.js";
import type { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "./adapters/sqlite/core-repository.js";
import { catalogRepository } from "./adapters/sqlite/catalog-repository.js";
import { createCompatibilityPort } from "./adapters/sqlite/compatibility.js";
import { invoicePort } from "./adapters/sqlite/invoice.js";
import { sourceExportPort } from "./adapters/sqlite/source-export.js";
import { transaction } from "./adapters/sqlite/transaction.js";
import { CatalogService } from "./application/catalog.js";
import { CompatibilityApiService } from "./application/compatibility.js";
import { addExpense, billingState, issueInvoice, removeExpense } from "./application/invoice.js";
import { PillService } from "./application/pill.js";
import { TimeKeeperService } from "./application/service.js";
import { SourceExportService } from "./application/source-export.js";
import { WorkspaceService } from "./application/workspace.js";
import type { Clock } from "./ports/index.js";
import type { InvoiceSnapshot } from "./ports/invoice.js";

/** One service graph, transaction connection, and clock for HTTP and background commands. */
export function createApplicationServices(
  db: DatabaseSync,
  clock: Clock = { now: () => new Date().toISOString() },
  historyRunner?: HistoryRunner,
) {
  const repository = new SqliteRepository(db);
  const core = new TimeKeeperService(repository, clock);
  const catalog = new CatalogService(catalogRepository(db), () => clock.now());
  const history = new HistoryService(historyStorage(db), repository, catalog, clock, historyRunner);
  const sourceExports = new SourceExportService(sourceExportPort(db), () => clock.now());
  const pill = new PillService(repository, core, () => Date.parse(clock.now()));
  const compatibility = new CompatibilityApiService(
    createCompatibilityPort(db),
    core,
    catalog,
    sourceExports,
    clock,
  );
  const invoiceStorage = invoicePort(db);
  const billing = {
    state: () => billingState(invoiceStorage),
    issue: (snapshot: InvoiceSnapshot) => issueInvoice(invoiceStorage, snapshot, clock.now()),
    addExpense: (input: Parameters<typeof addExpense>[1]) => addExpense(invoiceStorage, input),
    removeExpense: (id: number) => removeExpense(invoiceStorage, id),
  };
  const workspace = new WorkspaceService(
    (work) => transaction(db, work),
    core,
    catalog,
    billing.state,
  );
  return {
    repository,
    history,
    core,
    catalog,
    sourceExports,
    pill,
    compatibility,
    billing,
    workspace,
    clock,
  };
}

export type ApplicationServices = ReturnType<typeof createApplicationServices>;
