function approvalRevisions(db: { prepare(sql: string): { all(): unknown[] } }) {
  return Object.fromEntries(
    (
      db.prepare("SELECT id,effective_revision FROM work_periods").all() as Array<{
        id: string;
        effective_revision: number;
      }>
    ).map((row) => [row.id, row.effective_revision]),
  );
}
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  openDb,
  insert,
  one,
  transaction,
  update,
} from "../../src/backend/adapters/sqlite/repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { tables } from "../../src/backend/adapters/sqlite/tables.js";
import { createApp } from "../../src/backend/api/app.js";
import { memoryDb } from "../fixtures/database.js";

it("maps each migrated column and preserves existing rows across upgrade and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "timekeeper-drizzle-"));
  const path = join(dir, "upgrade.db");
  let db: DatabaseSync | undefined;
  try {
    db = openDb(path);
    // The isolated upgrade fixture includes optional historical tables; fresh files omit them.
    db.exec(readFileSync("src/backend/adapters/sqlite/schema.sql", "utf8"));
    for (const [name, table] of Object.entries(tables)) {
      const stored = db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((column) => column.name)
        .sort();
      expect(Object.keys(getTableColumns(table)).sort(), name).toEqual(stored);
    }
    const repo = new SqliteRepository(db);
    repo.createClient("opaque-client", "Fictional upgrade client", "2026-10-17T08:00:00Z");
    repo.createCase(
      "opaque-case",
      "opaque-client",
      "UPGRADE-1",
      "Fictional upgrade case",
      0,
      "2026-10-17T08:00:00Z",
    );
    // Migration 8 only adds this trigger. Re-run its real upgrade on existing data.
    db.exec(
      "DROP TRIGGER cases_reference_immutable; DELETE FROM schema_migrations WHERE version=8",
    );
    migrate(db);
    db.close();
    db = openDb(path);
    expect(new SqliteRepository(db).rateForCase("opaque-case")?.caseRateCents).toBe(0);
    expect(one(db, "client", "opaque-client")?.name).toBe("Fictional upgrade client");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => update(db!, "matter", "opaque-case", { reference: "changed" })).toThrow();
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps Drizzle writes inside nested raw savepoints", () => {
  const db = openDb(":memory:");
  try {
    const repo = new SqliteRepository(db);
    transaction(db, () => {
      repo.createClient("outer", "Outer", "2026-10-17T08:00:00Z");
      expect(() =>
        transaction(db, () => {
          repo.createClient("inner", "Inner", "2026-10-17T08:00:00Z");
          insert(db, "client", {
            name: "Compatibility inner",
            code: "INNER",
            type: "individual",
            mode: "hourly",
            vat_applicable: true,
            billing_address: "",
          });
          throw Error("rollback inner");
        }),
      ).toThrow("rollback inner");
      expect(one(db, "client", "inner")).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM clients WHERE code='INNER'").get()).toBeUndefined();
    });
    expect(one(db, "client", "outer")?.name).toBe("Outer");
    expect(() =>
      transaction(db, () => {
        repo.createClient("rolled-back", "Removed", "2026-10-17T08:00:00Z");
        transaction(db, () =>
          repo.createCase(
            "rolled-back-case",
            "outer",
            "ROLLBACK-1",
            "Removed",
            null,
            "2026-10-17T08:00:00Z",
          ),
        );
        throw Error("rollback outer");
      }),
    ).toThrow("rollback outer");
    expect(repo.caseExists("rolled-back-case")).toBe(false);
    expect(one(db, "client", "rolled-back")).toBeUndefined();
  } finally {
    db.close();
  }
});

it("approves a compatibility entry with no task without creating a zero task reference", async () => {
  const db = memoryDb();
  try {
    const period = db
      .prepare(
        "SELECT id FROM work_periods WHERE case_id IS NOT NULL AND detected_duration_ms IS NOT NULL AND billing_status='unbilled' AND excluded=0 LIMIT 1",
      )
      .get()!;
    db.prepare(
      "UPDATE work_periods SET task_type_id=NULL,time_validation_status='unvalidated',validated_effective_revision=NULL,time_validated_at=NULL WHERE id=?",
    ).run(String(period.id));
    const { entries } = await import("../../src/backend/adapters/sqlite/entries.js");
    const entry = entries(db).find((item) => item.task_id === null)!;
    const response = await createApp(db).request("/api/day/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: entry.date,
        expected_effective_revisions: approvalRevisions(db),
      }),
    });
    expect(response.status, await response.text()).toBe(200);
    const stored = new SqliteRepository(db).period(String(period.id));
    expect(stored?.taskTypeId).toBeNull();
    expect(stored?.validatedEffectiveRevision).toBe(stored?.effectiveRevision);
  } finally {
    db.close();
  }
});
