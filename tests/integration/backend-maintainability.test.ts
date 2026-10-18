import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../src/backend/api/app.js";
import { apiError } from "../../src/backend/api/errors.js";
import { AppError } from "../../src/backend/application/errors.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { memoryDb } from "../fixtures/database.js";

const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup(fictional = false) {
  const db = fictional ? memoryDb() : openDb(":memory:");
  databases.push(db);
  const repo = new SqliteRepository(db);
  const core = new TimeKeeperService(repo);
  const app = createApp(db);
  const write = (path: string, body: unknown, method = "POST") =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, repo, core, app, write };
}

function allowHistoricalEnums(db: ReturnType<typeof openDb>) {
  // Simulate values from before extension constraints, without rewriting migrations.
  for (const trigger of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_extension_%'")
    .all())
    db.exec(`DROP TRIGGER ${trigger.name}`);
  for (const index of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE 'CREATE INDEX %_id_idx ON %'",
    )
    .all())
    db.exec(`DROP INDEX ${index.name}`);
  db.exec("DELETE FROM schema_migrations WHERE version=9");
}

it("reads the workspace in one transaction without audit or conflict dependencies", async () => {
  const { db, app, core } = setup(true);
  // These independent histories must not be read by the workspace snapshot.
  db.exec("DROP TABLE audit_events; DROP TABLE reconstruction_conflicts");
  const response = await app.request("/api/workspace");
  expect(response.status).toBe(200);
  const snapshot = await response.json();
  expect(Object.keys(snapshot.workspaceState).sort()).toEqual([
    "activeSession",
    "billing",
    "coverageGaps",
    "periods",
    "questions",
    "sessions",
    "sources",
  ]);
  expect(snapshot.workspaceState.periods).toEqual(core.allPeriods());
  for (const period of snapshot.workspaceState.periods) {
    const legalCase = snapshot.catalogState.cases.find(
      (item: { id: string }) => item.id === period.caseId,
    );
    expect(period.clientId).toBe(legalCase?.clientId ?? null);
  }
  expect((await app.request("/api/audit-events")).status).toBe(500);
});

it("filters period queries in storage and derives clients without per-period lookups", () => {
  const { repo, core } = setup(true);
  repo.clientForCase = () => {
    throw new Error("unexpected per-record lookup");
  };
  const selected = core.queryPeriods({
    clientId: "1",
    caseId: "1",
    startedFrom: "2026-10-16T00:00:00Z",
    startedBefore: "2026-10-17T00:00:00.000Z",
  });
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every((period) => period.caseId === "1" && period.clientId === "1")).toBe(true);
  expect(core.queryPeriods({ clientId: "2", caseId: "1" })).toEqual([]);
  expect(core.listPeriods(selected[0]!.sessionId).length).toBeGreaterThan(0);
});

it("scopes snapshot evidence and questions to the selected periods and rejects invalid calendar filters", async () => {
  const { app } = setup(true);
  const snapshot = await (
    await app.request("/api/workspace?caseId=1&clientId=1&date=2026-10-16&timeZone=UTC")
  ).json();
  const ids = new Set(snapshot.workspaceState.periods.map((period: { id: string }) => period.id));
  expect(ids.size).toBeGreaterThan(0);
  expect(
    snapshot.workspaceState.sources.every((source: { workPeriodId: string }) =>
      ids.has(source.workPeriodId),
    ),
  ).toBe(true);
  expect(
    snapshot.workspaceState.questions.every((question: { periodId: string }) =>
      ids.has(question.periodId),
    ),
  ).toBe(true);
  for (const query of [
    "date=2026-02-30",
    "timeZone=Invalid%2FZone",
    "from=2026-10-17&to=2026-10-16",
  ])
    expect((await app.request(`/api/workspace?${query}`)).status).toBe(400);
});

it("keeps combined legacy assignment, detail editing and approval atomic through canonical use cases", async () => {
  const { core, write } = setup(true);
  const before = core.getPeriod("14");
  const failed = await write(
    "/time-entries/14",
    {
      matter_id: 2,
      expected_assignment_revision: before.assignmentRevision,
      expected_effective_revision: before.effectiveRevision,
      review_status: "approved",
      label: "   ",
    },
    "PATCH",
  );
  expect(failed.status).toBe(400);
  expect(core.getPeriod("14")).toEqual(before);
  const success = await write(
    "/time-entries/14",
    {
      matter_id: 2,
      expected_assignment_revision: before.assignmentRevision,
      expected_effective_revision: before.effectiveRevision,
      review_status: "approved",
      label: "Reviewed work",
    },
    "PATCH",
  );
  expect(success.status).toBe(200);
  const next = core.getPeriod("14");
  expect(next).toMatchObject({ caseId: "2", label: "Reviewed work", timeValidated: true });
  expect(next.validatedEffectiveRevision).toBe(next.effectiveRevision);
  expect(next.assignmentRevision).toBe(before.assignmentRevision + 1);
});

it("supports retained catalogue and period routes on a canonical-only fresh database", async () => {
  const { db, core, app, write } = setup();
  const clientResponse = await write("/clients", {
    name: "Synthetic client",
    code: "SYN",
    rate_cents: 0,
  });
  expect(clientResponse.status).toBe(200);
  const client = await clientResponse.json();
  const caseResponse = await write("/matters", { client_id: client.id, title: "Synthetic case" });
  expect(caseResponse.status).toBe(200);
  const legalCase = await caseResponse.json();
  core.start({
    producerId: "synthetic",
    commandId: "start",
    sessionId: "session",
    occurredAt: "2026-10-17T10:00:00Z",
  });
  const period = core.createManualPeriod({
    sessionId: "session",
    caseId: String(legalCase.id),
    startedAt: "2026-10-17T10:00:00Z",
    durationMs: 60000,
    taskTypeId: 1,
    label: "Synthetic work",
  });
  const state = await (await app.request("/api/state")).json();
  const entry = state.time_entry.find(
    (item: { work_period_id: string }) => item.work_period_id === period.id,
  );
  expect(
    (await write(`/time-entries/${entry.id}`, { label: "Updated work" }, "PATCH")).status,
  ).toBe(200);
  expect(core.getPeriod(period.id).label).toBe("Updated work");
  expect(
    (await write("/pauses", { date: "2026-10-17", start_time: "10:00", reason: "" })).status,
  ).toBe(202);
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('block','client','time_entry','pause')",
      )
      .all(),
  ).toEqual([]);
});

it("maps application error codes independently of English messages and hides unknown errors", async () => {
  const app = new Hono();
  app.onError(apiError);
  app.get("/typed", () => {
    throw new AppError("conflict", "An unrelated description");
  });
  app.get("/unknown", () => {
    throw new Error("Not found");
  });
  const conflict = await app.request("/typed");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "conflict", message: "An unrelated description" });
  const unknown = await app.request("/unknown");
  expect(unknown.status).toBe(500);
  expect(await unknown.json()).toEqual({ error: "internal", message: "internal error" });
});

it("reports unsupported historical enum values and permits an explicit atomic client repair", async () => {
  const { db, app, write } = setup();
  allowHistoricalEnums(db);
  db.prepare(
    "INSERT INTO clients(id,name,type,mode,created_at,updated_at) VALUES ('historical','Synthetic historical client','old-type','old-mode','','')",
  ).run();
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  for (const path of ["/api/catalog", "/api/workspace"]) {
    const response = await app.request(path);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "conflict",
      message: expect.stringContaining("client.type"),
    });
  }
  const before = db.prepare("SELECT * FROM clients WHERE id='historical'").get();
  expect((await write("/catalog/clients/historical", { type: "individual" }, "PATCH")).status).toBe(
    409,
  );
  expect(db.prepare("SELECT * FROM clients WHERE id='historical'").get()).toEqual(before);
  const repaired = await write(
    "/catalog/clients/historical",
    { type: "individual", mode: "hourly" },
    "PATCH",
  );
  expect(repaired.status).toBe(200);
  expect(await repaired.json()).toMatchObject({
    id: "historical",
    name: "Synthetic historical client",
    type: "individual",
    mode: "hourly",
  });
  expect((await app.request("/api/catalog")).status).toBe(200);
  expect((await app.request("/api/workspace")).status).toBe(200);
  const audit = db
    .prepare("SELECT before,after FROM audit_events WHERE action='Client updated'")
    .all();
  expect(audit).toHaveLength(1);
  expect(JSON.parse(String(audit[0]!.before))).toMatchObject({
    type: "old-type",
    mode: "old-mode",
  });
  expect(JSON.parse(String(audit[0]!.after))).toMatchObject({ type: "individual", mode: "hourly" });
});

it("repairs malformed case and settings states without requiring a readable full catalogue", async () => {
  const { db, app, write } = setup(true);
  allowHistoricalEnums(db);
  // Case mode has always had a CHECK; create an explicitly damaged isolated row
  // to verify the repair path without weakening production constraints.
  db.exec("PRAGMA ignore_check_constraints=ON");
  db.exec(
    "UPDATE cases SET mode='old-mode' WHERE id='1'; UPDATE settings SET base_unit='old-unit'",
  );
  db.exec("PRAGMA ignore_check_constraints=OFF");
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  const beforeCase = db.prepare("SELECT title,reference,client_id FROM cases WHERE id='1'").get();
  expect((await app.request("/api/catalog")).status).toBe(409);
  expect((await write("/catalog/settings", { baseUnit: "hour" }, "PATCH")).status).toBe(200);
  expect((await app.request("/api/catalog")).status).toBe(409);
  expect((await write("/catalog/cases/1", { mode: "hourly" }, "PATCH")).status).toBe(200);
  expect((await app.request("/api/catalog")).status).toBe(200);
  expect(db.prepare("SELECT title,reference,client_id FROM cases WHERE id='1'").get()).toEqual(
    beforeCase,
  );
  const audit = db
    .prepare("SELECT before FROM audit_events WHERE action IN ('Settings updated','Case updated')")
    .all();
  expect(audit.map((event) => JSON.parse(String(event.before)))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ baseUnit: "old-unit" }),
      expect.objectContaining({ mode: "old-mode" }),
    ]),
  );
});

it("allows explicit removal of malformed historical markers and client rules", async () => {
  const { db, app } = setup(true);
  allowHistoricalEnums(db);
  db.exec(
    "UPDATE markers SET type='old-marker' WHERE id=1; UPDATE client_rules SET type='old-rule' WHERE id=1",
  );
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  expect((await app.request("/api/catalog")).status).toBe(409);
  expect((await app.request("/api/catalog/markers/1", { method: "DELETE" })).status).toBe(200);
  expect((await app.request("/api/catalog")).status).toBe(409);
  expect((await app.request("/api/catalog/client-rules/1", { method: "DELETE" })).status).toBe(200);
  expect((await app.request("/api/catalog")).status).toBe(200);
  const audit = db
    .prepare(
      "SELECT before FROM audit_events WHERE action IN ('Marker removed','Client rule removed')",
    )
    .all();
  expect(audit.map((event) => JSON.parse(String(event.before)).type)).toEqual(
    expect.arrayContaining(["old-marker", "old-rule"]),
  );
});

it("repairs only an explicitly supplied historical period reason and preserves all edit guards", async () => {
  const { db, app, write } = setup(true);
  allowHistoricalEnums(db);
  const lockedIds = db
    .prepare("SELECT id FROM work_periods WHERE id <> '14' ORDER BY id LIMIT 2")
    .all()
    .map((row) => String(row.id));
  for (const id of ["14", ...lockedIds])
    db.prepare("UPDATE work_periods SET nonbillable_reason='old-reason' WHERE id=?").run(id);
  db.prepare(
    "UPDATE work_periods SET billing_status='billed',billed_at='2026-10-18T00:00:00Z' WHERE id=?",
  ).run(lockedIds[0]);
  db.prepare("UPDATE work_periods SET invoice_id=1 WHERE id=?").run(lockedIds[1]);
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  expect((await app.request("/api/workspace")).status).toBe(409);
  const stored = (id: string) => db.prepare("SELECT * FROM work_periods WHERE id=?").get(id)!;
  const before = stored("14");
  for (const [body, status] of [
    [{ label: "Unrelated change", expectedRevision: before.revision }, 409],
    [{ nonbillableReason: "invalid", expectedRevision: before.revision }, 400],
    [{ nonbillableReason: "offered", expectedRevision: Number(before.revision) + 1 }, 409],
    [{ nonbillableReason: "offered", label: "   ", expectedRevision: before.revision }, 400],
  ] as const) {
    expect((await write("/work-periods/14/details", body, "PATCH")).status).toBe(status);
    expect(stored("14")).toEqual(before);
  }
  const repaired = await write(
    "/work-periods/14/details",
    { nonbillableReason: null, expectedRevision: before.revision },
    "PATCH",
  );
  expect(repaired.status).toBe(200);
  expect(stored("14")).toMatchObject({
    nonbillable_reason: null,
    revision: Number(before.revision) + 1,
  });
  for (const id of lockedIds) {
    const locked = stored(id);
    expect(
      (
        await write(
          `/work-periods/${id}/details`,
          { nonbillableReason: "offered", expectedRevision: locked.revision },
          "PATCH",
        )
      ).status,
    ).toBe(409);
    expect(stored(id)).toEqual(locked);
  }
  // Locked malformed records remain visible as a controlled error; no repair policy is invented.
  expect((await app.request("/api/workspace")).status).toBe(409);
});

it("recovers the workspace after a valid explicit reason repair", async () => {
  const { db, app, write } = setup(true);
  allowHistoricalEnums(db);
  db.exec("UPDATE work_periods SET nonbillable_reason='old-reason' WHERE id='14'");
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  const before = db.prepare("SELECT revision FROM work_periods WHERE id='14'").get()!;
  expect((await app.request("/api/workspace")).status).toBe(409);
  expect(
    (
      await write(
        "/work-periods/14/details",
        { nonbillableReason: "offered", expectedRevision: before.revision },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect((await app.request("/api/workspace")).status).toBe(200);
});

it("removes an unsupported historical unbilled expense without decoding its category", async () => {
  const { db, app } = setup(true);
  allowHistoricalEnums(db);
  db.exec(
    "UPDATE expenses SET type='old-type' WHERE id IN (1,2); UPDATE expenses SET invoice_id=1 WHERE id=2",
  );
  const { migrate } = await import("../../src/backend/adapters/sqlite/migrate.js");
  migrate(db);
  expect((await app.request("/api/billing/state")).status).toBe(409);
  expect((await app.request("/api/billing/expenses/1", { method: "DELETE" })).status).toBe(200);
  expect(db.prepare("SELECT * FROM expenses WHERE id=1").get()).toBeUndefined();
  const billed = db.prepare("SELECT * FROM expenses WHERE id=2").get();
  expect((await app.request("/api/billing/expenses/2", { method: "DELETE" })).status).toBe(409);
  expect(db.prepare("SELECT * FROM expenses WHERE id=2").get()).toEqual(billed);
});
