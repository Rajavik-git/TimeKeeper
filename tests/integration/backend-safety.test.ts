import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { invoicePort } from "../../src/backend/adapters/sqlite/invoice.js";
import { billingState, issueInvoice } from "../../src/backend/application/invoice.js";
import { draftInvoice } from "../../src/frontend/calculations/billing.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = memoryDb();
  databases.push(db);
  const app = createApp(db);
  const repo = new SqliteRepository(db);
  const core = new TimeKeeperService(repo);
  const write = (path: string, body: unknown, method = "POST") =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, app, repo, core, write };
}
it("rejects deprecated catalog validator bypasses while preserving valid old response fields", async () => {
  const { db, write } = fixture();
  const before = readCatalog(db);
  for (const [path, body, method] of [
    ["/client/1", { rate_cents: 1.5 }, "PATCH"],
    ["/firm/1", { currency: "" }, "PATCH"],
    ["/firm/1", { global_hourly_rate_cents: 1 }, "PATCH"],
    ["/setting/1", { unknown: 1 }, "PATCH"],
    ["/matter/1", { status: "unexpected" }, "PATCH"],
    ["/clients", { name: "   ", code: "X", rate_cents: 0 }, "POST"],
    ["/markers", { matter_id: 1, type: "unknown", value: "test" }, "POST"],
  ] as const)
    expect((await write(path, body, method)).status).toBe(400);
  expect(readCatalog(db)).toEqual(before);
  const response = await write("/client/1", { rate_cents: 0, vat_applicable: true }, "PATCH");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: 1, rate_cents: 0, vat_applicable: true });
  expect(readCatalog(db).clients.find((c) => c.id === "1")).toMatchObject({
    hourlyRateCents: 0,
    vatApplicable: true,
  });
});
it("guards validation against unseen effective edits, and manual writes against unseen record edits", async () => {
  const { core, write, repo } = fixture();
  const before = core.getPeriod("14");
  expect((await write("/work-periods/14/validate-time", {})).status).toBe(400);
  core.setDurationOverride(
    "14",
    (before.durationOverrideMs ?? before.detectedDurationMs ?? 0) + 60000,
  );
  const current = core.getPeriod("14");
  expect(
    (
      await write("/work-periods/14/validate-time", {
        expectedEffectiveRevision: before.effectiveRevision,
      })
    ).status,
  ).toBe(409);
  expect(repo.period("14")?.validatedEffectiveRevision).toBeNull();
  for (const [path, body, method] of [
    [
      "/work-periods/14/duration-override",
      { durationMs: 1000, expectedRevision: before.revision },
      "POST",
    ],
    [
      "/work-periods/14/details",
      { label: "stale edit", expectedRevision: before.revision },
      "PATCH",
    ],
    [
      "/work-periods/14/billing-status",
      { status: "unbilled", expectedRevision: before.revision },
      "POST",
    ],
  ] as const)
    expect((await write(path, body, method)).status).toBe(409);
  expect(core.getPeriod("14")).toEqual(current);
  expect(
    (
      await write("/work-periods/14/validate-time", {
        expectedEffectiveRevision: current.effectiveRevision,
      })
    ).status,
  ).toBe(200);
});
it("requires guarded deprecated approvals and rolls back bulk approval on any stale target", async () => {
  const { core, write, repo } = fixture();
  expect((await write("/time-entries/14", { review_status: "approved" }, "PATCH")).status).toBe(
    400,
  );
  expect((await write("/day/approve", { date: "2026-10-16" })).status).toBe(400);
  const expected = Object.fromEntries(core.allPeriods().map((p) => [p.id, p.effectiveRevision]));
  const p = core.getPeriod("15");
  core.setDetectedDuration("15", (p.detectedDurationMs ?? 0) + 60000);
  const before = core.allPeriods();
  expect(
    (await write("/day/approve", { date: "2026-10-16", expected_effective_revisions: expected }))
      .status,
  ).toBe(409);
  expect(core.allPeriods()).toEqual(before);
  expect(
    (
      await write(
        "/time-entries/15",
        { review_status: "approved", expected_effective_revision: expected["15"] },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(repo.period("15")?.validatedEffectiveRevision).toBeNull();
  expect(
    (
      await write(
        "/time-entries/15",
        {
          review_status: "approved",
          expected_effective_revision: core.getPeriod("15").effectiveRevision,
        },
        "PATCH",
      )
    ).status,
  ).toBe(200);
});
it("stores canonical arrays through both deprecated export paths without rewriting old receipts", async () => {
  const { db, write } = fixture();
  db.prepare(
    "INSERT INTO source_exports(period_ids_json,options_json,sha256,created_at) VALUES('14','blur,audit','old','2026-10-01')",
  ).run();
  const old = db.prepare("SELECT * FROM source_exports WHERE sha256='old'").get();
  for (const [path, body] of [
    ["/sources/14/export", { options: ["audit"] }],
    ["/cases/1/source-pack", { scope: "case", options: ["audit"] }],
  ] as const) {
    const response = await write(path, body);
    expect(response.status).toBe(200);
    const result = await response.json();
    const receipt = result.export ?? result;
    const row = db.prepare("SELECT * FROM source_exports WHERE id=?").get(receipt.id)!;
    expect(row.format_version).toBe(2);
    expect(
      JSON.parse(String(row.period_ids_json)).every((id: unknown) => typeof id === "string"),
    ).toBe(true);
    expect(Array.isArray(JSON.parse(String(row.options_json)))).toBe(true);
    if (result.payload) expect(JSON.parse(result.payload)).toHaveProperty("entries");
  }
  expect(db.prepare("SELECT * FROM source_exports WHERE sha256='old'").get()).toEqual(old);
});
it("checks frozen invoice mathematics before billing any record or advancing numbering", () => {
  const { db, core } = fixture();
  const port = invoicePort(db);
  const state = {
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
  } = draftInvoice(readCatalog(db), state, 2, "final");
  const before = {
    billing: billingState(port),
    periods: core.allPeriods(),
    number: port.nextInvoice(),
  };
  for (const key of [
    "billedMinutes",
    "feesCents",
    "expensesCents",
    "disbursementsCents",
    "subtotalCents",
    "vatCents",
    "totalCents",
  ] as const) {
    const invalid = structuredClone({ ...draft, type: "final" as const });
    invalid[key]++;
    expect(() => issueInvoice(port, invalid, "2026-10-18T10:00:00Z")).toThrow();
    expect({
      billing: billingState(port),
      periods: core.allPeriods(),
      number: port.nextInvoice(),
    }).toEqual(before);
  }
  const emptyWork = {
    ...draft,
    type: "final" as const,
    periodIds: [],
    revisions: {},
    billedMinutes: 0,
    feesCents: 0,
    subtotalCents: 0,
    vatCents: 0,
    totalCents: 0,
    lines: [0, 1].map(() => ({ ...draft.lines[0], billedMinutes: 0, amountCents: 0 })),
  };
  expect(() => issueInvoice(port, emptyWork, "2026-10-18T10:00:00Z")).toThrow(
    "one grouped work line required",
  );
  const invalidLine = structuredClone({ ...draft, type: "final" as const });
  invalidLine.lines[0].amountCents++;
  expect(() => issueInvoice(port, invalidLine, "2026-10-18T10:00:00Z")).toThrow();
  expect(
    issueInvoice(port, { ...draft, type: "final" }, "2026-10-18T10:00:00Z").id,
  ).toBeGreaterThan(0);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
it("upgrades constraints without changing historical values and rejects future invalid IDs and units", () => {
  const db = openDb(":memory:");
  databases.push(db);
  const objects = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND (name GLOB '*_value_*' OR name GLOB '*_receipt_*')",
    )
    .all();
  for (const { name } of objects) db.exec(`DROP TRIGGER "${String(name)}"`);
  db.exec(
    "ALTER TABLE source_exports DROP COLUMN format_version; DELETE FROM schema_migrations WHERE version=10;",
  );
  db.prepare(
    "INSERT INTO clients(id,name,created_at,updated_at,hourly_rate_cents) VALUES('old','Historical','at','at',1.5)",
  ).run();
  db.prepare(
    "INSERT INTO source_exports(period_ids_json,options_json,sha256,created_at) VALUES('1,2','blur,audit','old','at')",
  ).run();
  migrate(db);
  migrate(db);
  expect(
    db.prepare("SELECT hourly_rate_cents FROM clients WHERE id='old'").get()?.hourly_rate_cents,
  ).toBe(1.5);
  db.exec("UPDATE clients SET billing_address='preserved row' WHERE id='old'");
  expect(() => db.exec("UPDATE clients SET hourly_rate_cents=2.5 WHERE id='old'")).toThrow();
  db.exec("UPDATE clients SET hourly_rate_cents=2 WHERE id='old'");
  for (const id of [null, "", "   "])
    expect(() =>
      db
        .prepare("INSERT INTO clients(id,name,created_at,updated_at) VALUES(?,'invalid','at','at')")
        .run(id),
    ).toThrow();
  expect(() => db.exec("UPDATE settings SET currency='' WHERE id=1")).toThrow();
  expect(
    db
      .prepare(
        "SELECT period_ids_json,options_json,format_version FROM source_exports WHERE sha256='old'",
      )
      .get(),
  ).toEqual({ period_ids_json: "1,2", options_json: "blur,audit", format_version: 1 });
  for (const [periods, options] of [
    ["14", "[]"],
    ["[]", "blur,audit"],
    ["bad-json", "[]"],
  ])
    expect(() =>
      db
        .prepare(
          "INSERT INTO source_exports(period_ids_json,options_json,format_version,sha256,created_at) VALUES(?,?,2,'invalid','at')",
        )
        .run(periods, options),
    ).toThrow();
  expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
