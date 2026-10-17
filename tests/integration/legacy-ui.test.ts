import { afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createApp } from "../../src/backend/api/app.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { memoryDb } from "../fixtures/database.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function remember(db: DatabaseSync): DatabaseSync {
  databases.push(db);
  return db;
}

const jsonHeaders = { "content-type": "application/json" };

it("leaves an unknown historical invoice currency blank in CSV", async () => {
  const db = remember(memoryDb());
  db.exec("UPDATE invoices SET currency=NULL WHERE id=1; UPDATE settings SET currency='EUR'");
  const response = await createApp(db).request("/api/invoices/1/csv");
  expect(response.status).toBe(200);
  const { csv } = (await response.json()) as { csv: string };
  const lines = csv.split("\n").slice(1);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line.split(";")[8]).toBe('""');
  expect(csv).not.toContain('"null"');
  expect(csv).not.toContain("EUR");
});

it.each(["empty workspace", "fictional fixture"])(
  "rejects legacy manual entries without writing data in an %s",
  async (workspace) => {
    const db = remember(workspace === "empty workspace" ? openDb(":memory:") : memoryDb());
    const app = createApp(db);
    const before = db.prepare("SELECT total_changes() AS count").get();
    const response = await app.request("/api/time-entries/manual", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        matter_id: 1,
        task_id: 1,
        date: "2026-10-16",
        tenths_of_hour: 1,
        label: "Explicitly unsupported legacy entry",
      }),
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: "unavailable",
      message:
        "Legacy manual entries are unavailable. Use explicit session and work-period boundaries.",
    });
    expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(before);
  },
);

it("records pause annotations without attaching them to fixture period 14 or changing periods", async () => {
  const db = remember(memoryDb());
  const app = createApp(db);
  const before = db.prepare("SELECT * FROM work_periods ORDER BY id").all();
  const recorded = await app.request("/api/pauses", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ date: "2026-10-16", start_time: "10:00", reason: "Annotation" }),
  });
  expect(recorded.status).toBe(200);
  const pause = (await recorded.json()) as { id: number };
  const ended = await app.request(`/api/pauses/${pause.id}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ end_time: "10:15" }),
  });
  expect(ended.status).toBe(200);
  expect(await ended.json()).toMatchObject({ id: pause.id, end_time: "10:15" });
  expect(db.prepare("SELECT * FROM work_periods ORDER BY id").all()).toEqual(before);
  expect(
    db.prepare("SELECT action,work_period_id FROM audit_events ORDER BY id DESC LIMIT 2").all(),
  ).toEqual([
    { action: "Pause annotation ended", work_period_id: null },
    { action: "Pause annotation recorded", work_period_id: null },
  ]);
});
