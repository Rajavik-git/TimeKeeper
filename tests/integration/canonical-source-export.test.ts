import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../../src/backend/api/app.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { sourceExportPort } from "../../src/backend/adapters/sqlite/source-export.js";
import { SourceExportService } from "../../src/backend/application/source-export.js";

const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = openDb(":memory:");
  databases.push(db);
  const repository = new SqliteRepository(db);
  const core = new TimeKeeperService(repository);
  const at = "2026-03-30T22:30:00Z";
  core.createClient("client", "Synthetic owner");
  core.createClient("other", "Synthetic Other Client");
  core.createCase("case", "client", "SYN", "Synthetic case", null);
  core.start({ producerId: "test", commandId: "start", sessionId: "session", occurredAt: at });
  core.openPeriod({
    id: "period-opaque",
    sessionId: "session",
    caseId: "case",
    startedAt: at,
    origin: "automatic",
    mode: "current",
  });
  core.updatePeriodDetails("period-opaque", { label: "Work about Synthetic Other Client" });
  for (const [id, contentType, periodId] of [
    ["screen-opaque", "screen", "period-opaque"],
    ["audio-opaque", "audio", "period-opaque"],
    ["unattached", "screen", null],
  ] as const) {
    core.importSource({
      id,
      periodId,
      instanceId: "synthetic",
      contentType,
      externalId: id,
      recordedAt: at,
    });
    db.prepare("UPDATE sources SET excerpt=?,detected_marker=? WHERE id=?").run(
      "Synthetic Other Client in observed text",
      "Synthetic Other Client",
      id,
    );
  }
  db.prepare(
    "INSERT INTO audit_events(work_period_id,timestamp,actor,action,before,after) VALUES (?,?,?,?,?,?)",
  ).run(
    "period-opaque",
    at,
    "Synthetic Other Client",
    "Synthetic event",
    "Synthetic Other Client",
    "Synthetic Other Client",
  );
  const app = createApp(db);
  const post = (body: unknown) =>
    app.request("/api/catalog/cases/case/source-pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, core, app, post };
}

it("exports canonical identities and precise timestamps, hashes the exact redacted payload, and persists a canonical receipt", async () => {
  const { db, post } = setup();
  const response = await post({
    scope: "selectedPeriods",
    periodIds: ["period-opaque"],
    options: ["blur", "audit"],
    timeZone: "Europe/Paris",
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.payload).not.toContain("Synthetic Other Client");
  expect(result.payload).toContain("[client redacted]");
  const pack = JSON.parse(result.payload);
  expect(pack).toMatchObject({
    version: 2,
    caseId: "case",
    scope: "selectedPeriods",
    timeZone: "Europe/Paris",
    periods: [{ id: "period-opaque", startedAt: "2026-03-30T22:30:00Z" }],
    sources: [
      {
        id: "screen-opaque",
        workPeriodId: "period-opaque",
        excerpt: "[client redacted] in observed text",
      },
    ],
  });
  expect(
    pack.auditEvents.some((event: { actor: string }) => event.actor === "[client redacted]"),
  ).toBe(true);
  expect(pack.sources).toHaveLength(1);
  expect(createHash("sha256").update(result.payload).digest("hex")).toBe(result.export.sha256);
  expect(result.export.periodIds).toEqual(["period-opaque"]);
  const receipt = db
    .prepare("SELECT period_ids_json,options_json,sha256 FROM source_exports WHERE id=?")
    .get(result.export.id);
  expect(receipt).toEqual({
    period_ids_json: '["period-opaque"]',
    options_json: '["blur","audit"]',
    sha256: result.export.sha256,
  });
  expect(db.prepare("SELECT COUNT(*) AS count FROM demo_period_entries").get()?.count).toBe(0);
  expect(db.prepare("SELECT COUNT(*) AS count FROM source_export").get()?.count).toBe(0);
  expect(
    db
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='Source pack generated'")
      .get()?.count,
  ).toBe(1);
});

it("uses the complete period's local start day and includes stored audio only when requested", async () => {
  const { post } = setup();
  const response = await post({
    scope: "dateRange",
    from: "2026-03-31",
    to: "2026-03-31",
    timeZone: "Europe/Paris",
    options: ["audio"],
  });
  expect(response.status).toBe(200);
  const pack = JSON.parse((await response.json()).payload);
  expect(pack.periods).toHaveLength(1);
  expect(pack.periods[0].startedAt).toBe("2026-03-30T22:30:00Z");
  expect(pack.periods[0].endedAt).toBeNull();
  expect(pack.sources).toHaveLength(2);
  expect(JSON.stringify(pack)).not.toContain("Synthetic Other Client");
  expect(pack.auditEvents).toEqual([]);
  expect(
    (
      await post({
        scope: "dateRange",
        from: "2026-03-31",
        to: "2026-03-31",
        timeZone: "UTC",
        options: [],
      })
    ).status,
  ).toBe(400);
});

it("rejects invalid or empty selections before writing export receipts", async () => {
  const { db, post } = setup();
  for (const body of [
    { scope: "selectedPeriods", periodIds: [1] },
    { scope: "selectedPeriods", periodIds: ["missing"] },
    { scope: "dateRange", from: "2026-02-30", to: "2026-03-31" },
    { scope: "dateRange", from: "2026-04-01", to: "2026-03-31" },
    { scope: "case", timeZone: "Invalid/Zone" },
    { scope: "invoice" },
  ])
    expect((await post({ options: [], ...body })).status).toBe(400);
  expect(db.prepare("SELECT COUNT(*) AS count FROM source_exports").get()?.count).toBe(0);
});

it("rolls back the receipt if the export audit write fails", () => {
  const { db } = setup();
  const port = sourceExportPort(db);
  const service = new SourceExportService({
    ...port,
    auditExport() {
      throw Error("synthetic audit failure");
    },
  });
  expect(() => service.exportCase("case", { scope: "case", options: [] })).toThrow(
    "synthetic audit failure",
  );
  expect(db.prepare("SELECT COUNT(*) AS count FROM source_exports").get()?.count).toBe(0);
});

it("excludes imported personal-app periods only when requested", async () => {
  const { db, post } = setup();
  db.prepare(
    "UPDATE work_periods SET demo_app='Synthetic Personal App' WHERE id='period-opaque'",
  ).run();
  db.prepare("UPDATE settings SET excluded_apps='personal' WHERE id=1").run();
  expect((await post({ scope: "case", options: ["personal"] })).status).toBe(400);
  expect((await post({ scope: "case", options: [] })).status).toBe(200);
});

it("exports CSV from canonical invoice tables with the currency frozen at issue", async () => {
  const { db, app } = setup();
  db.prepare(
    "INSERT INTO invoices(case_id,number,date,type,status,subtotal_cents,vat_cents,disbursements_cents,total_cents,snapshot_json,currency) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run("case", "SYN-001", "2026-03-31", "final", "issued", 100, 0, 0, 100, "{}", "EUR");
  const id = db.prepare("SELECT id FROM invoices WHERE number='SYN-001'").get()!.id as number;
  db.prepare(
    "INSERT INTO invoice_lines(invoice_id,origin,origin_id,label,billed_minutes,rate_cents,amount_cents,vat) VALUES (?,?,?,?,?,?,?,?)",
  ).run(id, "work_period", "case", "Synthetic work", 1, 6000, 100, 0);
  db.prepare("UPDATE settings SET currency='USD' WHERE id=1").run();
  const response = await app.request(`/api/invoices/${id}/csv`);
  expect(response.status).toBe(200);
  const { csv } = await response.json();
  expect(csv).toContain(';"EUR";');
  expect(csv).not.toContain(';"USD";');
  expect((await app.request("/api/invoices/99999/csv")).status).toBe(404);
});

it("selects invoice periods by their canonical invoice owner and rejects a different case's invoice", async () => {
  const { db, core, post } = setup();
  core.createCase("other-case", "client", "SYN-OTHER", "Synthetic other case", null);
  const insert = db.prepare(
    "INSERT INTO invoices(case_id,number,date,type,status,subtotal_cents,vat_cents,disbursements_cents,total_cents,snapshot_json,currency) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  insert.run("case", "SYN-OWN", "2026-03-31", "deposit", "issued", 0, 0, 0, 0, "{}", "EUR");
  insert.run("other-case", "SYN-OTHER", "2026-03-31", "deposit", "issued", 0, 0, 0, 0, "{}", "EUR");
  const ownId = db.prepare("SELECT id FROM invoices WHERE number='SYN-OWN'").get()!.id as number;
  const otherId = db.prepare("SELECT id FROM invoices WHERE number='SYN-OTHER'").get()!
    .id as number;
  db.prepare("UPDATE work_periods SET invoice_id=? WHERE id='period-opaque'").run(ownId);
  const response = await post({ scope: "invoice", invoiceId: ownId, options: [] });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(JSON.parse(result.payload).periods.map((period: { id: string }) => period.id)).toEqual([
    "period-opaque",
  ]);
  expect((await post({ scope: "invoice", invoiceId: otherId, options: [] })).status).toBe(400);
  expect(db.prepare("SELECT COUNT(*) AS count FROM source_exports").get()?.count).toBe(1);
});

it("redacts case-insensitive literal client names in text while preserving every structural identity", async () => {
  const { db, core, post } = setup();
  db.prepare("UPDATE clients SET name='period' WHERE id='other'").run();
  core.createClient("other-long", "Period Partners");
  core.createClient("other-literal", "A+B (Client)");
  core.updatePeriodDetails("period-opaque", {
    label: "PERIOD PARTNERS and period and A+B (CLIENT)",
  });
  db.prepare(
    "UPDATE work_periods SET demo_app='PERIOD app',demo_window_title='Period Partners document' WHERE id='period-opaque'",
  ).run();
  db.prepare(
    "UPDATE sources SET excerpt='PERIOD PARTNERS and PERIOD',detected_marker='A+B (CLIENT)' WHERE id='screen-opaque'",
  ).run();
  db.prepare(
    "INSERT INTO audit_events(work_period_id,timestamp,actor,action,before,after) VALUES (?,?,?,?,?,?)",
  ).run(
    "period-opaque",
    "2026-03-30T22:30:00Z",
    "PERIOD",
    "Period Partners opened",
    '{"label":"PERIOD PARTNERS"}',
    '{"label":"A+B (CLIENT)"}',
  );
  const response = await post({
    scope: "selectedPeriods",
    periodIds: ["period-opaque"],
    timeZone: "Europe/Paris",
    options: ["audit"],
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  const pack = JSON.parse(result.payload);
  expect(pack.periods[0]).toMatchObject({
    id: "period-opaque",
    caseId: "case",
    sessionId: "session",
    startedAt: "2026-03-30T22:30:00Z",
    billingStatus: "unbilled",
    label: "[client redacted] and [client redacted] and [client redacted]",
    demoApp: "[client redacted] app",
    demoWindowTitle: "[client redacted] document",
  });
  expect(pack.sources[0]).toMatchObject({
    id: "screen-opaque",
    externalId: "screen-opaque",
    workPeriodId: "period-opaque",
    contentType: "screen",
    excerpt: "[client redacted] and [client redacted]",
    detectedMarker: "[client redacted]",
  });
  expect(
    pack.auditEvents.find(
      (event: { action: string }) => event.action === "[client redacted] opened",
    ),
  ).toMatchObject({
    periodId: "period-opaque",
    actor: "[client redacted]",
    action: "[client redacted] opened",
    before: '{"label":"[client redacted]"}',
    after: '{"label":"[client redacted]"}',
  });
  expect(pack.caseId).toBe("case");
  expect(pack.scope).toBe("selectedPeriods");
  expect(pack.timeZone).toBe("Europe/Paris");
  expect(result.export.periodIds).toEqual(["period-opaque"]);
  expect(
    pack.sources.every((source: { workPeriodId: string }) =>
      pack.periods.some((period: { id: string }) => period.id === source.workPeriodId),
    ),
  ).toBe(true);
  expect(createHash("sha256").update(result.payload).digest("hex")).toBe(result.export.sha256);
});
