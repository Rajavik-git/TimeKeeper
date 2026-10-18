import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, state } from "../../src/backend/adapters/sqlite/repository.js";
import { createApp } from "../../src/backend/api/app.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";

describe("empty application startup", () => {
  it("serves empty business records with editable neutral preferences", async () => {
    const db = openDb(":memory:");
    try {
      const historicalTables = [
        "firm",
        "setting",
        "task",
        "client",
        "matter",
        "marker",
        "client_rule",
        "block",
        "source",
        "pause",
        "jev_review",
        "invoice",
        "time_entry",
        "expense",
        "invoice_line",
        "audit_event",
        "source_export",
        "schema_version",
      ];
      const storedTables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => row.name),
      );
      expect(historicalTables.filter((name) => storedTables.has(name))).toEqual([]);
      const app = createApp(db);
      const response = await app.request("/api/state");
      expect(response.status).toBe(200);
      const result = await response.json();
      for (const table of [
        "client",
        "matter",
        "block",
        "source",
        "time_entry",
        "invoice",
        "invoice_line",
        "expense",
        "marker",
        "client_rule",
        "pause",
        "jev_review",
        "audit_event",
        "source_export",
      ])
        expect(result[table], table).toEqual([]);
      expect(result.firm[0]).toMatchObject({ lawyer_name: "", base_rate_cents: 0, vat_rate: 0 });
      expect(result.setting[0]).toMatchObject({ invoice_prefix: "F-", next_number: 1 });
      expect(result.task).toHaveLength(10);
      const repo = new SqliteRepository(db);
      expect(repo.activeSession()).toBeNull();
      expect(repo.allPeriods()).toEqual([]);
      expect((await app.request("/api/demo/reset", { method: "POST" })).status).toBe(404);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("preserves saved records and settings on reopen without importing legacy samples", () => {
    const dir = mkdtempSync(join(tmpdir(), "timekeeper-empty-"));
    const path = join(dir, "nested", "timekeeper.db");
    try {
      let db = openDb(path);
      const workspace = db.prepare("SELECT workspace_id FROM settings").get()?.workspace_id;
      db.exec("UPDATE settings SET lawyer_name='Saved name', global_hourly_rate_cents=24000");
      db.exec("UPDATE task_types SET label='Saved category' WHERE id=1");
      // Simulate an existing historical file; canonical rows must still own reads.
      db.exec(readFileSync("src/backend/adapters/sqlite/schema.sql", "utf8"));
      // Old compatibility rows must never trigger another sample import.
      db.exec(
        `INSERT INTO client VALUES (999,'Legacy sample','LEGACY','individual','hourly',0,0,'')`,
      );
      db.close();
      db = openDb(path);
      try {
        expect(state(db).client).toEqual([]);
        expect(state(db).firm[0]).toMatchObject({
          lawyer_name: "Saved name",
          base_rate_cents: 24000,
        });
        expect(state(db).task[0].label).toBe("Saved category");
        expect(db.prepare("SELECT workspace_id FROM settings").get()?.workspace_id).toBe(workspace);
        db.prepare("INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)").run(
          "saved-client",
          "Saved client",
          "2026-10-17T10:00:00Z",
          "2026-10-17T10:00:00Z",
        );
      } finally {
        db.close();
      }
      db = openDb(path);
      try {
        expect(state(db).client.map((client) => client.id)).toEqual(["saved-client"]);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
