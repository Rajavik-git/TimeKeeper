import { CatalogService } from "../../src/backend/application/catalog.js";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { SourceExportService } from "../../src/backend/application/source-export.js";
import { sourceExportPort } from "../../src/backend/adapters/sqlite/source-export.js";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { afterEach, expect, it } from "vitest";
import { all, one, update } from "../../src/backend/adapters/sqlite/repository.js";
import { memoryDb } from "../fixtures/database.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { CompatibilityApiService } from "../../src/backend/application/compatibility.js";
import { createCompatibilityPort } from "../../src/backend/adapters/sqlite/compatibility.js";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { invoicePort } from "../../src/backend/adapters/sqlite/invoice.js";
import { billingState, issueInvoice } from "../../src/backend/application/invoice.js";
import { draftInvoice } from "../../src/frontend/calculations/billing.js";

const databases: ReturnType<typeof memoryDb>[] = [];
function fixture() {
  const db = memoryDb();
  databases.push(db);
  const repo = new SqliteRepository(db);
  const core = new TimeKeeperService(repo);
  return {
    db,
    repo,
    core,
    demo: new CompatibilityApiService(
      createCompatibilityPort(db),
      core,
      new CatalogService(catalogRepository(db)),
      new SourceExportService(sourceExportPort(db)),
    ),
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("uses canonical edits while preserving imported fixture rows", () => {
  const { db, demo } = fixture();
  const original = db.prepare("SELECT rate_cents FROM client WHERE id=1").get()?.rate_cents;
  demo.updateCatalog("client", 1, { rate_cents: 0 });
  expect(one(db, "client", 1)?.rate_cents).toBe(0);
  expect(
    db.prepare("SELECT hourly_rate_cents FROM clients WHERE id='1'").get()?.hourly_rate_cents,
  ).toBe(0);
  expect(db.prepare("SELECT rate_cents FROM client WHERE id=1").get()?.rate_cents).toBe(original);
  const client = demo.createClient({
    name: "Synthetic Added Client",
    code: "SYNTHETIC",
    rate_cents: 0,
  });
  const matter = demo.createCase({ client_id: client.id, title: "New synthetic case" });
  expect(one(db, "matter", String(matter.id))?.client_id).toBe(client.id);
  const marker = demo.addMarker({
    matter_id: matter.id,
    type: "keyword",
    value: "synthetic marker",
  });
  expect(all(db, "marker").find((item) => item.id === marker.id)?.matter_id).toBe(matter.id);
  const expense = demo.addExpense({
    matter_id: matter.id,
    type: "expense",
    label: "synthetic expense",
    amount_cents: 10,
  });
  expect(one(db, "expense", Number(expense.id))?.matter_id).toBe(matter.id);
  demo.removeExpense(Number(expense.id));
  expect(one(db, "expense", Number(expense.id))).toBeUndefined();
});

it("redacts another client's name from every source-pack string including entry labels and audit actor", () => {
  const { db, core, demo } = fixture();
  const other = String(one(db, "client", 8)?.name);
  core.updatePeriodDetails("14", { label: `Work mentioning ${other}` });
  db.prepare(
    "INSERT INTO audit_events(work_period_id,timestamp,actor,action,before,after) VALUES ('14','2026-10-17',?,?,?,?)",
  ).run(other, other, other, other);
  const pack = demo.exportCaseSources(
    Number(core.getPeriod("14").caseId),
    "chosen",
    ["blur", "audit", "transcripts"],
    { periodIds: [14] },
  );
  expect(pack.payload).not.toContain(other);
  expect(pack.payload).toContain("[client redacted]");
  expect(JSON.parse(pack.payload).entries[0].label).toBe("Work mentioning [client redacted]");
});

it("exports a canonical-only issued invoice and snapshots the configured currency", () => {
  const { db, core, demo } = fixture();
  core.setGlobalRate(25000, "EUR", "demo-workspace");
  const port = invoicePort(db);
  const coreState = {
    activeSession: core.activeSession(),
    sessions: core.listSessions(),
    periods: core.allPeriods(),
    sources: core.allSources(),
    questions: core.allQuestions(),
    coverageGaps: core.coverageGaps(),
    auditEvents: [],
    billing: billingState(port),
  };
  const {
    pendingPeriods: _pending,
    complete: _complete,
    ...draft
  } = draftInvoice(readCatalog(db), coreState, 2, "final");
  const invoice = issueInvoice(port, { ...draft, type: "final" }, "2026-10-17T18:00:00Z");
  expect(db.prepare("SELECT 1 FROM invoice WHERE id=?").get(invoice.id)).toBeUndefined();
  const pack = JSON.parse(
    demo.exportCaseSources(2, "invoice", [], { invoiceId: invoice.id }).payload,
  );
  expect(pack.entries.length).toBeGreaterThan(0);
  expect(
    pack.entries.every((entry: { invoice_id: number }) => entry.invoice_id === invoice.id),
  ).toBe(true);
  for (const id of draft.periodIds) expect(core.getPeriod(id).appliedCurrency).toBe("EUR");
  core.setGlobalRate(10000, "USD", "demo-workspace");
  const csv = demo.invoiceCsv(invoice.id).csv;
  expect(csv.split("\n")[0]).toBe(
    "number;date;client;case;label;minutes;hourly_rate;amount;currency;sales_tax",
  );
  expect(
    csv
      .split("\n")
      .slice(1)
      .every((line) => line.includes(';"EUR";')),
  ).toBe(true);
  expect(csv).not.toContain("USD");
});

it("projects canonical-only UUID periods through stable compatibility identifiers", () => {
  const { db, core, demo } = fixture();
  const period = core.createManualPeriod({
    sessionId: "demo-2026-10-16",
    caseId: "2",
    startedAt: "2026-10-16T13:00:00Z",
    durationMs: 20000,
    taskTypeId: 1,
    label: "Canonical-only work",
  });
  const entry = all(db, "time_entry").find((item) => item.label === "Canonical-only work")!;
  expect(Number.isInteger(entry.id)).toBe(true);
  expect(one(db, "time_entry", Number(entry.id))?.tenths_of_hour).toBe(20000 / 360000);
  expect(createCompatibilityPort(db).canonicalPeriodForEntry(Number(entry.id))?.id).toBe(period.id);
  expect(() => update(db, "time_entry", Number(entry.id), { label: "Adapter bypass" })).toThrow(
    "application use case",
  );
  demo.updateEntry(Number(entry.id), { label: "Corrected canonical label" });
  expect(core.getPeriod(period.id).label).toBe("Corrected canonical label");
});

it("keeps opaque catalog IDs through canonical edits and UUID source packs", () => {
  const { db, core, demo } = fixture();
  core.createClient("opaque-client", "Opaque synthetic client");
  core.createCase("opaque-case", "opaque-client", "SYN-1", "Opaque case", null);
  demo.updateCatalog("client", "opaque-client", { rate_cents: 0 });
  expect(one(db, "client", "opaque-client")?.rate_cents).toBe(0);
  const period = core.createManualPeriod({
    sessionId: "demo-2026-10-16",
    caseId: "opaque-case",
    startedAt: "2026-10-16T13:00:00Z",
    durationMs: 20000,
    taskTypeId: 1,
    label: "Opaque work",
  });
  const pack = JSON.parse(
    demo.exportCaseSources("opaque-case", "chosen", [], { periodIds: [period.id] }).payload,
  );
  expect(pack.entries).toHaveLength(1);
  expect(pack.entries[0].id).toBe(period.id);
  expect(pack.caseId).toBe("opaque-case");
});

it("preserves leading-zero opaque catalog identifiers without colliding with numeric demo identifiers", () => {
  const { db, core, demo } = fixture();
  core.createClient("01", "Leading zero synthetic client");
  core.createCase("01", "01", "SYN-ZERO", "Leading zero case", null);
  demo.updateCatalog("client", "01", { rate_cents: 12345 });
  expect(one(db, "client", "01")?.id).toBe("01");
  expect(one(db, "client", 1)?.id).toBe(1);
  expect(one(db, "matter", "01")?.client_id).toBe("01");
  expect(core.currentRateForCase("01")).toBe(12345);
  const period = core.createManualPeriod({
    sessionId: "demo-2026-10-16",
    caseId: "01",
    startedAt: "2026-10-16T13:00:00Z",
    durationMs: 20000,
    taskTypeId: 1,
    label: "Leading zero work",
  });
  expect(all(db, "time_entry").find((item) => item.label === "Leading zero work")?.matter_id).toBe(
    "01",
  );
  const pack = JSON.parse(
    demo.exportCaseSources("01", "chosen", [], { periodIds: [period.id] }).payload,
  );
  expect(pack.entries[0].matter_id).toBe("01");
});

it("includes canonical UUID-period audit events in source packs", () => {
  const { db, core, demo } = fixture();
  const period = core.createManualPeriod({
    sessionId: "demo-2026-10-16",
    caseId: "2",
    startedAt: "2026-10-16T13:00:00Z",
    durationMs: 20000,
    taskTypeId: 1,
    label: "Audited UUID work",
  });
  db.prepare(
    "INSERT INTO audit_events(work_period_id,timestamp,actor,action,before,after) VALUES (?,'2026-10-17','Synthetic lawyer','UUID correction','','changed')",
  ).run(period.id);
  const pack = JSON.parse(
    demo.exportCaseSources(2, "chosen", ["audit"], { periodIds: [period.id] }).payload,
  );
  expect(pack.audit).toHaveLength(1);
  expect(pack.audit[0].action).toBe("UUID correction");
});

it("does not interpret a canonical string period ID as a numeric compatibility alias", () => {
  const { db, repo, core, demo } = fixture();
  const existing = repo.period("1")!;
  // Both records share a case so selection alone must distinguish their identities.
  repo.insertPeriod(
    { ...existing, id: "01", initialCaseId: existing.caseId },
    "2026-10-17T18:00:00Z",
  );
  const caseId = core.getPeriod("1").caseId!;
  const pack = JSON.parse(
    demo.exportCaseSources(caseId, "chosen", [], { periodIds: ["01"] }).payload,
  );
  expect(pack.entries.map((entry: { id: string }) => entry.id)).toEqual(["01"]);
  expect(all(db, "time_entry").filter((entry) => String(entry.id) === "1")).toHaveLength(1);
});

it("upgrades an existing v4 database once while preserving preferences and historical currency", () => {
  const { db } = fixture();
  // Remove migration 9 objects as well as its version marker to simulate a real v4 schema.
  const laterObjects = db
    .prepare(
      "SELECT type,name FROM sqlite_master WHERE (type='trigger' AND (name GLOB '*_extension_*' OR (name GLOB '*_value_*' OR name GLOB '*_receipt_*'))) OR (type='index' AND name GLOB '*_id_idx')",
    )
    .all() as Array<{ type: string; name: string }>;
  for (const object of laterObjects)
    db.exec(`DROP ${object.type.toUpperCase()} "${object.name.replaceAll('"', '""')}"`);
  db.exec(`DROP TRIGGER cases_reference_immutable;
    DROP TABLE source_relocations;
    DROP TABLE demo_period_entries;
    ALTER TABLE settings DROP COLUMN pill_always_on_top;
    ALTER TABLE settings DROP COLUMN pill_display;
    ALTER TABLE settings DROP COLUMN pill_withhold_calls;
    ALTER TABLE invoices DROP COLUMN currency;
    ALTER TABLE source_exports DROP COLUMN format_version;
    DELETE FROM schema_migrations WHERE version>=5;
    UPDATE setting SET pill_always_on_top=0,pill_display='time',pill_withhold_calls=0 WHERE id=1;`);
  migrate(db);
  migrate(db);
  expect(
    db
      .prepare(
        "SELECT pill_always_on_top,pill_display,pill_withhold_calls FROM settings WHERE id=1",
      )
      .get(),
  ).toMatchObject({ pill_always_on_top: 0, pill_display: "time", pill_withhold_calls: 0 });
  expect(db.prepare("SELECT currency FROM invoices WHERE id=1").get()?.currency).toBe("USD");
  expect(db.prepare("SELECT count(*) AS count FROM schema_migrations").get()?.count).toBe(10);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("recovers excluded observed work assigned to an opaque case", () => {
  const { db, core, demo } = fixture();
  core.createClient("opaque-recovery-client", "Opaque recovery client");
  core.createCase(
    "opaque-recovery-case",
    "opaque-recovery-client",
    "SYN-RECOVERY",
    "Opaque recovery case",
    null,
  );
  core.assignPeriod("9", "opaque-recovery-case", 0, "lawyer");
  const entry = one(db, "time_entry", 9)!;
  demo.discardEntry(9);
  const recovered = demo.recoverBlock(Number(entry.block_id));
  expect(recovered.matter_id).toBe("opaque-recovery-case");
  expect(core.getPeriod("9")).toMatchObject({ caseId: "opaque-recovery-case", excluded: false });
});
