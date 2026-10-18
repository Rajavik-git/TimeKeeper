import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { initializeDatabase } from "../../src/backend/adapters/sqlite/initialize.js";
import { createApp } from "../../src/backend/api/app.js";

const databases: DatabaseSync[] = [];
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  initializeDatabase(db);
  const repo = new SqliteRepository(db);
  let now = "2026-10-18T12:00:00Z";
  const service = new TimeKeeperService(repo, { now: () => now });
  service.createClient("client", "Fixture client");
  for (const id of ["A", "B"]) service.createCase(id, "client", id, `Fixture ${id}`, null);
  service.start({
    producerId: "fixture",
    commandId: "start",
    sessionId: "session",
    occurredAt: "2026-10-17T08:00:00Z",
  });
  const transition = {
    id: "p1",
    sessionId: "session",
    caseId: "A",
    startedAt: "2026-10-17T08:00:00Z",
    origin: "automatic" as const,
    mode: "current" as const,
    expectedActivePeriodId: null,
    expectedAssignmentRevision: null,
  };
  return {
    db,
    repo,
    service,
    transition,
    setNow: (value: string) => {
      now = value;
    },
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("guards delayed transitions and preserves replay after manual assignment", () => {
  const { service, transition } = fixture();
  service.recordCaseTransition(transition);
  service.assignPeriod("p1", "B", 0, "lawyer");
  expect(service.recordCaseTransition(transition)).toMatchObject({ id: "p1", caseId: "B" });
  expect(() =>
    service.recordCaseTransition({
      ...transition,
      id: "p2",
      startedAt: "2026-10-17T09:00:00Z",
      expectedActivePeriodId: "p1",
      expectedAssignmentRevision: 0,
    }),
  ).toThrow("active period assignment changed");
  expect(() => service.recordCaseTransition({ ...transition, caseId: "B" })).toThrow(
    "period ID reused",
  );
  expect(
    service.recordCaseTransition({
      ...transition,
      id: "same",
      caseId: "B",
      startedAt: "2026-10-17T09:00:00Z",
      expectedActivePeriodId: "p1",
      expectedAssignmentRevision: 1,
    }),
  ).toMatchObject({ id: "p1" });
  expect(service.allPeriods()).toHaveLength(1);
});

it("imports batches atomically and removes source validation idempotently", () => {
  const { service } = fixture();
  const source = {
    id: "source",
    periodId: null,
    instanceId: "fixture",
    contentType: "ocr",
    externalId: "1",
    recordedAt: "2026-10-17T09:00:00Z",
  };
  expect(() =>
    service.importSources([source, { ...source, id: "bad", externalId: "2", periodId: "absent" }]),
  ).toThrow("period not found");
  expect(service.allSources()).toHaveLength(0);
  expect(service.importSources([source, source])).toEqual([
    { id: "source", status: "imported" },
    { id: "source", status: "unchanged" },
  ]);
  service.validateSource("fixture", "ocr", "1");
  service.validateSource("fixture", "ocr", "1", false);
  service.validateSource("fixture", "ocr", "1", false);
  expect(service.allSources()[0]).toMatchObject({
    validationStatus: "unvalidated",
    validatedAt: null,
  });
});

it("requires finished past-day periods and rolls back bulk validation", () => {
  const { service, transition, setNow } = fixture();
  service.recordCaseTransition(transition);
  service.setDetectedDuration("p1", 1000);
  expect(() => service.validatePeriod("p1", 1)).toThrow("running period");
  service.end({
    producerId: "fixture",
    commandId: "end",
    sessionId: "session",
    occurredAt: "2026-10-17T10:00:00Z",
  });
  setNow("2026-10-17T12:00:00Z");
  expect(() => service.validatePeriod("p1", 1)).toThrow("only past days");
  setNow("2026-10-18T12:00:00Z");
  expect(() =>
    service.validatePeriods([
      { id: "p1", expectedEffectiveRevision: 1 },
      { id: "missing", expectedEffectiveRevision: 0 },
    ]),
  ).toThrow("period not found");
  expect(service.getPeriod("p1").timeValidated).toBe(false);
  service.validatePeriod("p1", 1);
  expect(() => service.clearTimeValidation("p1", 0)).toThrow("stale effective revision");
  const cleared = service.clearTimeValidation("p1", 1);
  expect(service.clearTimeValidation("p1", 1)).toEqual(cleared);
});

it("exposes canonical reads, readiness, guarded validation and atomic source contracts", async () => {
  const { db } = fixture();
  const app = createApp(db);
  expect((await app.request("/api/health")).status).toBe(200);
  expect(await (await app.request("/api/cases?clientId=client")).json()).toMatchObject([
    { id: "A", clientName: "Fixture client" },
    { id: "B", clientName: "Fixture client" },
  ]);
  expect(
    (
      await app.request("/api/work-periods/absent/validate-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ validated: false }),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      })
    ).status,
  ).toBe(400);
});

it("combines session and question-status filters without crossing sessions", async () => {
  const { db, service, transition } = fixture();
  service.recordCaseTransition({ ...transition, caseId: null, origin: "unresolved" });
  service.end({
    producerId: "fixture",
    commandId: "end",
    sessionId: "session",
    occurredAt: "2026-10-17T10:00:00Z",
  });
  service.start({
    producerId: "fixture",
    commandId: "start2",
    sessionId: "session2",
    occurredAt: "2026-10-17T11:00:00Z",
  });
  service.recordCaseTransition({
    ...transition,
    id: "p2",
    sessionId: "session2",
    caseId: null,
    origin: "unresolved",
    startedAt: "2026-10-17T11:00:00Z",
  });
  const app = createApp(db);
  expect(await (await app.request("/api/work-periods?sessionId=session")).json()).toMatchObject([
    { id: "p1" },
  ]);
  const questions = await (
    await app.request("/api/questions?sessionId=session2&status=pending")
  ).json();
  expect(questions).toMatchObject([{ periodId: "p2", sessionId: "session2" }]);
  expect(questions).toHaveLength(1);
  expect(
    await (await app.request("/api/questions?sessionId=session2&status=answered")).json(),
  ).toEqual([]);
  expect((await app.request("/api/questions?status=invalid")).status).toBe(400);
});

it("requires current inference snapshots over HTTP and preserves source undo's optional body", async () => {
  const { db, transition } = fixture();
  const app = createApp(db);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const {
    expectedActivePeriodId: _period,
    expectedAssignmentRevision: _revision,
    ...unguarded
  } = transition;
  expect((await post("/api/work-periods", unguarded)).status).toBe(400);
  expect((await post("/api/work-periods", transition)).status).toBe(200);
  expect(
    (
      await post("/api/work-periods", {
        ...transition,
        id: "next",
        startedAt: "2026-10-17T09:00:00Z",
      })
    ).status,
  ).toBe(409);
  const source = {
    id: "source",
    periodId: "p1",
    instanceId: "fixture",
    contentType: "ocr",
    externalId: "1",
    recordedAt: "2026-10-17T09:00:00Z",
  };
  expect(await (await post("/api/sources", source)).json()).toEqual({
    id: "source",
    status: "imported",
  });
  expect(
    (await app.request("/api/sources/fixture/ocr/1/validate", { method: "POST" })).status,
  ).toBe(200);
  expect((await post("/api/sources/fixture/ocr/1/validate", { validated: false })).status).toBe(
    200,
  );
  expect((await post("/api/sources/fixture/ocr/1/validate", { validated: "false" })).status).toBe(
    400,
  );
});

it("keeps a duration correction made while inference is pending and replays its review proposal", () => {
  const { service, transition } = fixture();
  service.recordCaseTransition(transition);
  const snapshot = service.getPeriod("p1");
  service.setDurationOverride("p1", 90000, snapshot.revision);
  expect(service.getPeriod("p1").assignmentRevision).toBe(snapshot.assignmentRevision);
  const corrected = service.getPeriod("p1");
  const pending = {
    ...transition,
    id: "late-jev",
    caseId: "B",
    startedAt: "2026-10-17T09:00:00Z",
    expectedActivePeriodId: snapshot.id,
    expectedAssignmentRevision: snapshot.assignmentRevision,
  };
  expect(service.recordCaseTransition(pending)).toEqual({
    status: "pending",
    conflictId: "late-jev",
  });
  expect(service.recordCaseTransition(pending)).toEqual({
    status: "pending",
    conflictId: "late-jev",
  });
  expect(service.getPeriod("p1")).toEqual(corrected);
  expect(service.allPeriods()).toHaveLength(1);
  expect(service.reconstructionConflicts()).toHaveLength(1);
  for (const changed of [
    { caseId: null },
    { startedAt: "2026-10-17T09:01:00Z" },
    { origin: "unresolved" as const },
    { mode: "recovery" as const },
    { sessionId: "different-session" },
  ])
    expect(() => service.recordCaseTransition({ ...pending, ...changed })).toThrow(
      "proposal ID reused",
    );
  // Replay depends on original identity, not the mutable active snapshot.
  expect(service.recordCaseTransition({ ...pending, expectedAssignmentRevision: 999 })).toEqual({
    status: "pending",
    conflictId: "late-jev",
  });
});
