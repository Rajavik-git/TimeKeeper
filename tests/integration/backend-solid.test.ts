import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { sourceExportPort } from "../../src/backend/adapters/sqlite/source-export.js";
import { CatalogService } from "../../src/backend/application/catalog.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { PillService, pillUndoWindowMs } from "../../src/backend/application/pill.js";
import { SourceExportService } from "../../src/backend/application/source-export.js";
import { chooseRate, resolveHourlyRate } from "../../src/backend/domain/pricing.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const db = memoryDb();
  databases.push(db);
  const repo = new SqliteRepository(db);
  let now = Date.parse("2026-10-18T12:00:00Z");
  const core = new TimeKeeperService(repo, { now: () => new Date(now).toISOString() });
  const pill = new PillService(repo, core, () => now);
  return {
    db,
    repo,
    core,
    pill,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

it("keeps narrow catalogue reads independent of damaged historical marker values", () => {
  const { db } = setup();
  for (const trigger of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_extension_%'")
    .all())
    db.exec(`DROP TRIGGER ${trigger.name}`);
  db.exec("UPDATE markers SET type='historical-marker' WHERE id=1");
  const catalog = new CatalogService(catalogRepository(db));
  expect(() => catalog.getCatalog()).toThrow(/marker.type/);
  expect(catalog.listClients().length).toBeGreaterThan(0);
  expect(catalog.getSettings().currency).toBe("USD");
  expect(catalog.listCases({ clientId: "1" }).every((item) => item.clientId === "1")).toBe(true);
  expect(catalog.searchCases("Dawson").cases.length).toBeGreaterThan(0);
});

it("returns the exact undo deadline and keeps expired decisions intact", () => {
  const { pill, repo, advance } = setup();
  const result = pill.decision({
    kind: "assign",
    periodId: "13",
    caseId: "5",
    expectedAssignmentRevision: 0,
  });
  expect(result.undoExpiresAt).toBe("2026-10-18T12:00:05.000Z");
  advance(pillUndoWindowMs + 1);
  expect(() => pill.undo(result.undoToken)).toThrow(/expired/);
  expect(repo.period("13")?.caseId).toBe("5");
});

it("rolls back every validation restoration when one selected period changed", () => {
  const { pill, core, repo } = setup();
  const before = [core.getPeriod("14"), core.getPeriod("15")];
  const result = pill.decision({
    kind: "validate",
    periodIds: before.map((p) => p.id),
    expectedEffectiveRevisions: Object.fromEntries(before.map((p) => [p.id, p.effectiveRevision])),
  });
  core.updatePeriodDetails("15", { label: "Changed after decision" });
  expect(() => pill.undo(result.undoToken)).toThrow(/changed/);
  expect(repo.period("14")?.timeValidatedAt).toBe("2026-10-18T12:00:00.000Z");
});

it("retains switch guards when evidence arrived after the decision", () => {
  const { pill, core, repo } = setup();
  const result = pill.decision({
    kind: "switch",
    caseId: "1",
    windowTitle: "Synthetic document",
    appName: "Editor",
    at: "2026-10-16T16:43:00Z",
  });
  core.importSource({
    id: "new-evidence",
    periodId: result.period.id,
    instanceId: "synthetic",
    contentType: "screen",
    externalId: "new-evidence",
    recordedAt: "2026-10-16T16:43:01Z",
  });
  expect(() => pill.undo(result.undoToken)).toThrow(/changed/);
  expect(repo.period(result.period.id)).not.toBeNull();
});

it("maps observation names at storage and transport boundaries", () => {
  const { core, repo, db } = setup();
  const opened = core.openPeriod({
    id: "observed",
    sessionId: core.activeSession()!.id,
    caseId: "1",
    startedAt: "2026-10-16T16:43:00Z",
    origin: "lawyer",
    mode: "current",
    window: { appName: "Editor", title: "Synthetic document" },
  });
  expect(opened).toMatchObject({
    observedAppName: "Editor",
    observedWindowTitle: "Synthetic document",
    demoApp: "Editor",
    demoWindowTitle: "Synthetic document",
  });
  expect(repo.period("observed")).toMatchObject({
    observedAppName: "Editor",
    observedWindowTitle: "Synthetic document",
  });
  expect(repo.period("observed")).not.toHaveProperty("demoApp");
  expect(db.prepare("SELECT demo_app FROM work_periods WHERE id='observed'").get()?.demo_app).toBe(
    "Editor",
  );
});

it("exports a case without reading unrelated markers or periods", () => {
  const { db, core } = setup();
  db.exec("DROP TABLE markers");
  const periods = core.queryPeriods({ caseId: "1" });
  const service = new SourceExportService(sourceExportPort(db));
  const result = service.exportCase("1", { scope: "case", options: [], timeZone: "UTC" });
  expect(
    JSON.parse(result.payload).periods.every((p: { caseId: string }) => p.caseId === "1"),
  ).toBe(true);
  expect(periods.length).toBeGreaterThan(0);
});

it("uses one rate policy for legacy mappings, explicit zero and flat fees", () => {
  expect(
    resolveHourlyRate({ globalRateCents: 30000, clientRateCents: 20000, caseRateCents: 0 }),
  ).toEqual({ rateCents: 0, origin: "matter", flatFee: false });
  expect(chooseRate({ base_cents: 30000, client_cents: 0 })).toEqual({
    rate_cents: 0,
    origin: "client",
    flat_fee: false,
  });
  expect(resolveHourlyRate({ globalRateCents: null, flatFee: true })).toEqual({
    rateCents: 0,
    origin: "flat_fee",
    flatFee: true,
  });
  expect(resolveHourlyRate({ globalRateCents: null }).rateCents).toBeNull();
});
