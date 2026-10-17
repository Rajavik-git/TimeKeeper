import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";

const repos: SqliteRepository[] = [];
function setup(): SqliteRepository {
  const repo = new SqliteRepository(new DatabaseSync(":memory:"));
  repos.push(repo);
  const now = "2026-10-17T08:00:00Z";
  repo.db
    .prepare("INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)")
    .run("client", "Fictional Client", now, now);
  repo.db
    .prepare(
      "INSERT INTO cases(id,client_id,reference,title,hourly_rate_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("case-a", "client", "A-1", "Fictional A", null, now, now);
  repo.db
    .prepare(
      "INSERT INTO cases(id,client_id,reference,title,hourly_rate_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("case-b", "client", "B-1", "Fictional B", 0, now, now);
  return repo;
}
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});
export { setup };

it("enforces one open session, no cascade, bounds, unique evidence and question target", () => {
  const r = setup(),
    now = "2026-10-17T09:00:00Z";
  r.insertSession({ id: "s1", startedAt: now, endedAt: null, revision: 0 }, now);
  expect(() =>
    r.insertSession({ id: "s2", startedAt: now, endedAt: null, revision: 0 }, now),
  ).toThrow();
  expect(() => r.db.prepare("DELETE FROM clients WHERE id=?").run("client")).toThrow();
  expect(() =>
    r.db
      .prepare(
        `INSERT INTO work_periods(id,session_id,started_at,initial_origin,assignment_origin,time_validation_status,billing_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "invalid",
        "s1",
        "2026-10-17T08:00:00Z",
        "unresolved",
        "unresolved",
        "unvalidated",
        "unbilled",
        now,
        now,
      ),
  ).toThrow();
  r.db
    .prepare(
      `INSERT INTO sources(id,screenpipe_instance_id,content_type,external_id,recorded_at,ingested_at) VALUES (?,?,?,?,?,?)`,
    )
    .run("src1", "instance", "ocr", "frame1", now, now);
  expect(() =>
    r.db
      .prepare(
        `INSERT INTO sources(id,screenpipe_instance_id,content_type,external_id,recorded_at,ingested_at) VALUES (?,?,?,?,?,?)`,
      )
      .run("src2", "instance", "ocr", "frame1", now, now),
  ).toThrow();
  expect(() =>
    r.db
      .prepare(
        `INSERT INTO sources(id,screenpipe_instance_id,content_type,external_id,recorded_at,ingested_at) VALUES (?,?,?,?,?,?)`,
      )
      .run("src3", "other", "ocr", "frame1", now, now),
  ).not.toThrow();
});

it("keeps aliases tied to the canonical target owner", () => {
  const r = setup(),
    now = "2026-10-17T09:00:00Z";
  r.insertSession({ id: "s1", startedAt: now, endedAt: null, revision: 0 }, now);
  r.db
    .prepare(
      `INSERT INTO work_periods(id,session_id,started_at,initial_origin,assignment_origin,time_validation_status,billing_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run("p1", "s1", now, "unresolved", "unresolved", "unvalidated", "unbilled", now, now);
  r.db
    .prepare(
      `INSERT INTO tag_targets(id,screenpipe_instance_id,target_type,target_id,work_period_id) VALUES (?,?,?,?,?)`,
    )
    .run("t1", "instance", "frame", "f1", "p1");
  r.db
    .prepare(
      `INSERT INTO sources(id,work_period_id,screenpipe_instance_id,content_type,external_id,tag_target_id,recorded_at,ingested_at) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run("a", "p1", "instance", "ocr", "ocr1", "t1", now, now);
  expect(() =>
    r.db
      .prepare(
        `INSERT INTO sources(id,work_period_id,screenpipe_instance_id,content_type,external_id,tag_target_id,recorded_at,ingested_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run("b", null, "instance", "frame", "f1", "t1", now, now),
  ).toThrow();
});

it.skip("overlap constraints await the duration and overlap decision in docs/DESIGN_REVIEW.md", () => {
  const r = setup(),
    now = "2026-10-17T09:00:00Z";
  r.insertSession({ id: "s", startedAt: now, endedAt: null, revision: 0 }, now);
  r.db
    .prepare(
      `INSERT INTO work_periods(id,session_id,started_at,ended_at,initial_origin,assignment_origin,time_validation_status,billing_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "p1",
      "s",
      now,
      "2026-10-17T10:00:00Z",
      "automatic",
      "automatic",
      "unvalidated",
      "unbilled",
      now,
      now,
    );
  expect(() =>
    r.db
      .prepare(
        `INSERT INTO work_periods(id,session_id,started_at,ended_at,initial_origin,assignment_origin,time_validation_status,billing_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "p2",
        "s",
        "2026-10-17T09:30:00Z",
        "2026-10-17T11:00:00Z",
        "automatic",
        "automatic",
        "unvalidated",
        "unbilled",
        now,
        now,
      ),
  ).toThrow();
});
