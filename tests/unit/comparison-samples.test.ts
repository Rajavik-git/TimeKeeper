import { mkdtempSync, existsSync, rmSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { openDb } from "../../src/backend/adapters/sqlite/repository";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository";
import { TimeKeeperService } from "../../src/backend/application/service";
import { CatalogService } from "../../src/backend/application/catalog";
import { BillingStatus, ClientType } from "../../src/backend/domain/states";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository";
import { monthlyRecordedTime } from "../../src/frontend/calculations/comparison";
import { caseBudget } from "../../src/frontend/calculations/case-budget";
import type { CoreState } from "../../src/frontend/api/client";
import { calendarDay } from "../../src/shared/dates";
import { comparisonSamplePlan, sampleNamespace } from "../../scripts/comparison-samples/plan";
import { loadComparisonSamples } from "../../scripts/comparison-samples/load";

const databases: ReturnType<typeof openDb>[] = [];
const folders: string[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});
function database() {
  const db = openDb(":memory:");
  databases.push(db);
  return db;
}
const plan = () => comparisonSamplePlan(new Date("2026-10-18T12:00:00Z"), "Europe/Paris");
function workspace(db: ReturnType<typeof openDb>): CoreState {
  const service = new TimeKeeperService(new SqliteRepository(db));
  return {
    activeSession: service.activeSession(),
    sessions: service.listSessions(),
    periods: service.allPeriods(),
    sources: service.allSources(),
    questions: [],
    coverageGaps: [],
    billing: { invoices: [], lines: [], expenses: [] },
    auditEvents: [],
  };
}

it("loads complete explicit durations and different monthly figures without provider evidence", () => {
  const db = database();
  expect(loadComparisonSamples(db, plan())).toEqual({
    created: 4,
    skipped: 0,
    incompleteUnrelated: 0,
  });
  const state = readCatalog(db);
  const core = workspace(db);
  const comparison = monthlyRecordedTime(state, core, "2026-10-18");
  expect(comparison.comparison.status).toBe("available");
  expect(comparison.current.preciseDurationMs).toBe(3 * 3600000);
  expect(comparison.previous.preciseDurationMs).toBe(1.5 * 3600000);
  expect(core.sources).toEqual([]);
  expect(
    core.periods.every(
      (period) =>
        period.timeValidated === calendarDay(period.startedAt) < plan().today &&
        period.label?.startsWith("[Sample]"),
    ),
  ).toBe(true);
  expect(
    core.periods.filter((period) => period.billingStatus === BillingStatus.Billed),
  ).toHaveLength(1);
  expect(state.clients.every((client) => client.type === ClientType.Company)).toBe(true);
  expect(state.cases.map((item) => caseBudget(state, core, item).percent)).toEqual([30, 7.5]);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});

it("repeated imports preserve existing human corrections and add no duplicate records", () => {
  const db = database();
  loadComparisonSamples(db, plan());
  const service = new TimeKeeperService(new SqliteRepository(db));
  const target = plan().periods.find((period) => !period.billed)!;
  service.setDurationOverride(target.id, 5000);
  const before = db.prepare("SELECT * FROM work_periods ORDER BY id").all();
  expect(loadComparisonSamples(db, plan())).toMatchObject({ created: 0, skipped: 4 });
  expect(db.prepare("SELECT * FROM work_periods ORDER BY id").all()).toEqual(before);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count).toBe(4);
});

it("preserves unrelated clients, preferences, and an active session", () => {
  const db = database();
  const service = new TimeKeeperService(new SqliteRepository(db));
  service.createClient("real-client", "Existing client");
  service.createCase("real-case", "real-client", "REAL-001", "Existing case", 13000);
  service.start({
    producerId: "test",
    commandId: "start",
    sessionId: "real-session",
    occurredAt: "2026-10-18T08:00:00Z",
  });
  const before = {
    client: db.prepare("SELECT * FROM clients WHERE id='real-client'").get(),
    legalCase: db.prepare("SELECT * FROM cases WHERE id='real-case'").get(),
    settings: db.prepare("SELECT * FROM settings").all(),
    session: service.activeSession(),
  };
  loadComparisonSamples(db, plan());
  expect(db.prepare("SELECT * FROM clients WHERE id='real-client'").get()).toEqual(before.client);
  expect(db.prepare("SELECT * FROM cases WHERE id='real-case'").get()).toEqual(before.legalCase);
  expect(db.prepare("SELECT * FROM settings").all()).toEqual(before.settings);
  expect(service.activeSession()).toEqual(before.session);
});

it.each(["2026-03-01T00:00:00.120Z", "2026-03-31T22:01:00Z", "2027-01-01T00:05:00Z"])(
  "keeps periods inside the current cutoff and previous comparison range at %s",
  (instant) => {
    const now = new Date(instant);
    const sample = comparisonSamplePlan(now, "UTC");
    for (const period of sample.periods) {
      expect(+new Date(period.endedAt)).toBeLessThanOrEqual(+now);
      expect(calendarDay(period.startedAt, "UTC")).toBe(period.day);
      expect(Number.isSafeInteger(period.durationMs)).toBe(true);
      expect(period.durationMs).toBeGreaterThan(0);
      expect(
        period.day <=
          (period.day.startsWith(sample.today.slice(0, 7)) ? sample.today : sample.previousDay),
      ).toBe(true);
    }
    const db = database();
    loadComparisonSamples(db, sample);
    const comparison = monthlyRecordedTime(readCatalog(db), workspace(db), sample.today);
    expect(comparison.comparison.status).toBe("available");
    expect(comparison.current.preciseDurationMs).toBe(2 * comparison.previous.preciseDurationMs);
  },
);

it("rolls back all changes on a sample namespace collision", () => {
  const db = database();
  const catalog = new CatalogService(catalogRepository(db));
  catalog.createClient({ id: `${sampleNamespace}:river:client`, name: "Real record" });
  const before = db.prepare("SELECT * FROM clients ORDER BY id").all();
  expect(() => loadComparisonSamples(db, plan())).toThrow("unlabelled record");
  expect(db.prepare("SELECT * FROM clients ORDER BY id").all()).toEqual(before);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count).toBe(0);
});

it("dry run does not open or create the selected database", () => {
  const folder = mkdtempSync(join(tmpdir(), "timekeeper-sample-dryrun-"));
  folders.push(folder);
  const path = join(folder, "preview.db");
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/load-comparison-samples.ts", "--database", path, "--dry-run"],
    { encoding: "utf8" },
  );
  expect(output).toContain("no database was opened or changed");
  expect(existsSync(path)).toBe(false);
});

it("requires an explicit database path even when TIMEKEEPER_DB is configured", () => {
  const folder = mkdtempSync(join(tmpdir(), "timekeeper-sample-explicit-path-"));
  folders.push(folder);
  const path = join(folder, "must-not-create.db");
  expect(() =>
    execFileSync(process.execPath, ["--import", "tsx", "scripts/load-comparison-samples.ts"], {
      env: { ...process.env, TIMEKEEPER_DB: path },
      stdio: "pipe",
    }),
  ).toThrow("An explicit --database PATH is required");
  expect(existsSync(path)).toBe(false);
});

it("backs up an existing database before adding samples and supports an idempotent CLI rerun", () => {
  const folder = mkdtempSync(join(tmpdir(), "timekeeper-sample-backup-"));
  folders.push(folder);
  const path = join(folder, "preview.db");
  const db = openDb(path);
  new TimeKeeperService(new SqliteRepository(db)).createClient("real", "Existing client");
  db.close();
  const args = ["--import", "tsx", "scripts/load-comparison-samples.ts", "--database", path];
  const output = execFileSync(process.execPath, args, { encoding: "utf8", timeout: 10000 });
  expect(output).toContain('"created":4');
  const backups = readdirSync(join(folder, "backups"));
  expect(backups).toHaveLength(1);
  const original = new DatabaseSync(join(folder, "backups", backups[0]), { readOnly: true });
  try {
    expect(original.prepare("SELECT id FROM clients").all()).toEqual([{ id: "real" }]);
    expect(original.prepare("SELECT COUNT(*) AS count FROM work_periods").get()?.count).toBe(0);
  } finally {
    original.close();
  }
  expect(execFileSync(process.execPath, args, { encoding: "utf8", timeout: 10000 })).toContain(
    '"created":0',
  );
}, 20000);

it("rejects a database with pending migrations without changing its schema", () => {
  const folder = mkdtempSync(join(tmpdir(), "timekeeper-sample-oldschema-"));
  folders.push(folder);
  const path = join(folder, "old.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (1)",
  );
  db.close();
  expect(() =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/load-comparison-samples.ts", "--database", path],
      { stdio: "pipe" },
    ),
  ).toThrow();
  const unchanged = new DatabaseSync(path, { readOnly: true });
  try {
    expect(unchanged.prepare("SELECT version FROM schema_migrations").all()).toEqual([
      { version: 1 },
    ]);
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "schema_migrations" },
    ]);
  } finally {
    unchanged.close();
  }
});
