import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDb, insert, one, update } from "../../src/backend/adapters/sqlite/repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { entries, ensureCompatibilityEntryId } from "../../src/backend/adapters/sqlite/entries.js";
import { createApp } from "../../src/backend/api/app.js";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";

it("recovers mixed-precision timestamps in chronological order without overlapping periods", () => {
  const db = openDb(":memory:");
  try {
    const repo = new SqliteRepository(db);
    const service = new TimeKeeperService(repo);
    service.start({
      producerId: "test",
      commandId: "start",
      sessionId: "s",
      occurredAt: "2026-10-17T08:00:00Z",
    });
    service.end({
      producerId: "test",
      commandId: "end",
      sessionId: "s",
      occurredAt: "2026-10-17T09:00:00Z",
    });
    for (const [id, startedAt] of [
      ["second", "2026-10-17T08:01:00.100Z"],
      ["first", "2026-10-17T08:01:00Z"],
      ["earlier", "2026-10-17T08:00:30Z"],
    ]) {
      service.openPeriod({
        id,
        sessionId: "s",
        startedAt,
        caseId: null,
        origin: "unresolved",
        mode: "recovery",
      });
    }
    const periods = repo.listPeriods("s");
    expect(periods.map((p) => p.id)).toEqual(["earlier", "first", "second"]);
    expect(repo.allPeriods().map((p) => p.id)).toEqual(["earlier", "first", "second"]);
    expect(periods.map((p) => p.endedAt)).toEqual([
      "2026-10-17T08:01:00Z",
      "2026-10-17T08:01:00.100Z",
      "2026-10-17T09:00:00Z",
    ]);
    expect(repo.periodAt("s", "2026-10-17T08:01:00.050Z")?.id).toBe("first");
    expect(repo.periodAt("s", "2026-10-17T08:01:00.100Z")?.id).toBe("second");
  } finally {
    db.close();
  }
});

it("orders session, evidence and incomplete retrieval timestamps chronologically", () => {
  const db = openDb(":memory:");
  try {
    const repo = new SqliteRepository(db);
    const now = "2026-10-17T09:00:00Z";
    for (const [id, startedAt] of [
      ["second", "2026-10-17T08:00:00.100Z"],
      ["first", "2026-10-17T08:00:00Z"],
    ])
      repo.insertSession({ id, startedAt, endedAt: now, revision: 0 }, now);
    expect(repo.listSessions().map((session) => session.id)).toEqual(["first", "second"]);
    const service = new TimeKeeperService(repo);
    service.openPeriod({
      id: "period",
      sessionId: "first",
      startedAt: "2026-10-17T08:00:00Z",
      caseId: null,
      origin: "unresolved",
      mode: "recovery",
    });
    for (const [id, recordedAt] of [
      ["second", "2026-10-17T08:01:00.100Z"],
      ["first", "2026-10-17T08:01:00Z"],
    ]) {
      repo.insertSource({
        id,
        workPeriodId: "period",
        instanceId: "test",
        contentType: "screen",
        externalId: id,
        recordedAt,
        ingestedAt: now,
        validationStatus: "unvalidated",
        validatedAt: null,
        availabilityStatus: "unknown",
        availabilityCheckedAt: null,
      });
      db.prepare(
        "INSERT INTO retrieval_progress(id,session_id,screenpipe_instance_id,requested_start_at,requested_end_at,status) VALUES (?,'first','test',?,?,'pending')",
      ).run(id, recordedAt, now);
    }
    expect(repo.listSources("period").map((source) => source.id)).toEqual(["first", "second"]);
    expect(repo.allSources().map((source) => source.id)).toEqual(["first", "second"]);
    expect(repo.coverageGaps().map((gap) => gap.id)).toEqual(["first", "second"]);
  } finally {
    db.close();
  }
});

it("exposes the canonical period identity separately from its numeric compatibility alias", () => {
  const db = openDb(":memory:");
  try {
    const repo = new SqliteRepository(db);
    const service = new TimeKeeperService(repo);
    service.start({
      producerId: "test",
      commandId: "start",
      sessionId: "s",
      occurredAt: "2026-10-17T08:00:00Z",
    });
    service.openPeriod({
      id: "opaque-period-id",
      sessionId: "s",
      startedAt: "2026-10-17T08:00:00Z",
      caseId: null,
      origin: "unresolved",
      mode: "current",
    });
    const alias = ensureCompatibilityEntryId(db, "opaque-period-id");
    expect(typeof alias).toBe("number");
    expect(entries(db)).toMatchObject([{ id: alias, work_period_id: "opaque-period-id" }]);
    expect(ensureCompatibilityEntryId(db, "opaque-period-id")).toBe(alias);
  } finally {
    db.close();
  }
});

it("projects compatibility fields and booleans independently of the historical SQL schema", () => {
  const db = openDb(":memory:");
  try {
    db.exec(readFileSync("src/backend/adapters/sqlite/schema.sql", "utf8"));
    // Alter only this isolated database to prove payloads no longer follow old table metadata.
    db.exec(
      "ALTER TABLE client ADD COLUMN obsolete_field TEXT; ALTER TABLE client RENAME COLUMN billing_address TO obsolete_address",
    );
    const client = insert(db, "client", {
      name: "Fictional client",
      code: "REVIEW",
      type: "individual",
      mode: "hourly",
      rate_cents: 0,
      vat_applicable: false,
      billing_address: "Address",
    });
    expect(client).toEqual({
      id: 1,
      name: "Fictional client",
      code: "REVIEW",
      type: "individual",
      mode: "hourly",
      rate_cents: 0,
      vat_applicable: false,
      billing_address: "Address",
    });
    expect(update(db, "client", 1, { vat_applicable: true, rate_cents: null })).toMatchObject({
      vat_applicable: true,
      rate_cents: null,
    });
    expect(one(db, "setting", 1)?.notifications).toBe(true);
    expect(one(db, "firm", 1)?.currency).toBe("USD");
    expect(one(db, "client", 1)).not.toHaveProperty("created_at");
  } finally {
    db.close();
  }
});

it("upgrades extension invariants without rewriting historical data and enforces them after reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "timekeeper-integrity-"));
  const path = join(dir, "upgrade.db");
  let db: ReturnType<typeof openDb> | undefined;
  try {
    db = openDb(path);
    // Simulate a pre-9 file with values that were previously permitted.
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
    db.exec(
      "DELETE FROM schema_migrations WHERE version=9; UPDATE settings SET vat_rate=150,notifications=3,next_number=0",
    );
    db.exec(
      "INSERT INTO clients(id,name,type,mode,created_at,updated_at) VALUES ('historical','Fictional','invalid-type','invalid-mode','','')",
    );
    migrate(db);
    expect(
      db.prepare("SELECT vat_rate,notifications,next_number FROM settings").get(),
    ).toMatchObject({ vat_rate: 150, notifications: 3, next_number: 0 });
    db.close();
    db = openDb(path);
    expect(
      db.prepare("SELECT vat_rate,notifications,next_number FROM settings").get(),
    ).toMatchObject({ vat_rate: 150, notifications: 3, next_number: 0 });
    db.prepare("UPDATE settings SET address='Preserved'").run();
    expect(() => db!.prepare("UPDATE settings SET vat_rate=101").run()).toThrow(
      "settings extension constraint",
    );
    // Full saves can retain unchanged historical values; no new invalid value is introduced.
    db.exec(
      "UPDATE settings SET vat_rate=150,notifications=3,next_number=0,address='Still preserved'",
    );
    const app = createApp(db);
    const patch = (path: string, body: unknown) =>
      app.request(`/api/${path}/1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    // Firm and preference forms expose different fields from the same stored row.
    expect((await patch("firm", { vat_rate: 20 })).status).toBe(200);
    expect(
      db.prepare("SELECT vat_rate,notifications,next_number FROM settings").get(),
    ).toMatchObject({ vat_rate: 20, notifications: 3, next_number: 0 });
    expect((await patch("setting", { notifications: false })).status).toBe(200);
    expect(db.prepare("SELECT notifications,next_number FROM settings").get()).toMatchObject({
      notifications: 0,
      next_number: 0,
    });
    expect((await patch("setting", { next_number: 1 })).status).toBe(200);
    db.exec("UPDATE clients SET type='individual',mode='invalid-mode' WHERE id='historical'");
    expect(db.prepare("SELECT type,mode FROM clients WHERE id='historical'").get()).toMatchObject({
      type: "individual",
      mode: "invalid-mode",
    });
    db.exec("UPDATE clients SET mode='hourly' WHERE id='historical'");
    for (const change of [
      "vat_rate=-1",
      "confidence_threshold=1.1",
      "notifications=2",
      "next_number=0",
      "next_number=1.5",
      "base_unit='day'",
      "global_hourly_rate_cents=1.5",
    ])
      expect(() => db!.exec(`UPDATE settings SET ${change}`), change).toThrow();
    expect(() =>
      db!.exec(
        "INSERT INTO clients(id,name,type,created_at,updated_at) VALUES ('bad','Fictional','invalid','','')",
      ),
    ).toThrow("clients extension constraint");
    const repo = new SqliteRepository(db);
    repo.createClient("client", "Fictional", "2026-10-17T08:00:00Z");
    repo.createCase("case", "client", "CASE", "Fictional", null, "2026-10-17T08:00:00Z");
    expect(() => db!.exec("UPDATE cases SET success_fee_percent=101 WHERE id='case'")).toThrow();
    expect(() =>
      db!.exec(
        "INSERT INTO markers(case_id,type,value,weight,learned,hits) VALUES ('case','keyword','fictional',1,2,0)",
      ),
    ).toThrow();
    expect(() =>
      db!.exec(
        "INSERT INTO client_rules(client_id,type,value,label) VALUES ('client','invalid',0,'')",
      ),
    ).toThrow();
    expect(() =>
      db!.exec(
        "INSERT INTO expenses(case_id,date,label,type,amount_cents) VALUES ('case','','','invalid',0)",
      ),
    ).toThrow();
    expect(() =>
      db!.exec(
        "INSERT INTO invoices(case_id,number,date,type,status) VALUES ('case','I','','invalid','issued')",
      ),
    ).toThrow();
    db.exec(
      "INSERT INTO invoices(id,case_id,number,date,type,status) VALUES (1,'case','I','','final','issued')",
    );
    expect(() =>
      db!.exec(
        "INSERT INTO invoice_lines(invoice_id,origin,origin_id,label,billed_minutes,rate_cents,amount_cents,vat) VALUES (1,'invalid','1','',0,0,0,0)",
      ),
    ).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='one_open_session'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='period_bounds_insert'").get(),
    ).toBeDefined();
    for (const table of [
      "invoice_lines",
      "expenses",
      "invoices",
      "audit_events",
      "source_relocations",
    ])
      expect(
        db
          .prepare(`PRAGMA index_list(${table})`)
          .all()
          .some((index) => String(index.name).endsWith("_id_idx")),
        table,
      ).toBe(true);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates legacy reconstruction proposals without inventing a transition identity", () => {
  const db = openDb(":memory:");
  try {
    const repo = new SqliteRepository(db);
    const service = new TimeKeeperService(repo);
    service.start({
      producerId: "fixture",
      commandId: "start",
      sessionId: "s",
      occurredAt: "2026-10-17T08:00:00Z",
    });
    service.openPeriod({
      id: "p",
      sessionId: "s",
      caseId: null,
      startedAt: "2026-10-17T08:00:00Z",
      origin: "unresolved",
      mode: "current",
    });
    // Reconstruct the immediately preceding schema to exercise the additive migration.
    db.exec(
      "ALTER TABLE reconstruction_conflicts DROP COLUMN transition_fingerprint; DELETE FROM schema_migrations WHERE version=11",
    );
    db.prepare(
      "INSERT INTO reconstruction_conflicts(id,protected_period_id,expected_revision,proposed_started_at,source_references_json) VALUES (?,?,?,?,?)",
    ).run("legacy", "p", 0, "2026-10-17T08:30:00Z", "[]");
    migrate(db);
    migrate(db);
    expect(repo.reconstructionFingerprint("legacy")).toBeNull();
    expect(repo.reconstructionFingerprint("absent")).toBeUndefined();
    expect(service.reconstructionConflicts()).toMatchObject([{ id: "legacy", periodId: "p" }]);
    expect(() =>
      service.recordCaseTransition({
        id: "legacy",
        sessionId: "s",
        caseId: null,
        startedAt: "2026-10-17T08:30:00Z",
        origin: "unresolved",
        mode: "current",
        expectedActivePeriodId: "p",
        expectedAssignmentRevision: 0,
      }),
    ).toThrow("legacy proposal identity is unknown");
    expect(() =>
      db
        .prepare(
          "UPDATE reconstruction_conflicts SET transition_fingerprint='bad' WHERE id='legacy'",
        )
        .run(),
    ).toThrow();
    repo.insertConflict("new", "p", 0, "2026-10-17T08:45:00Z", null, "[]", "a".repeat(64));
    expect(repo.reconstructionFingerprint("new")).toBe("a".repeat(64));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
