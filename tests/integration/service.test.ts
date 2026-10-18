import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { AppError, TimeKeeperService } from "../../src/backend/application/service.js";
import { summarize } from "../../src/frontend/calculations/summary.js";

const repos: SqliteRepository[] = [];
function fixture() {
  const repo = new SqliteRepository(new DatabaseSync(":memory:"));
  repos.push(repo);
  const now = "2026-10-17T09:00:00Z";
  repo.db
    .prepare("INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)")
    .run("client", "Fictional Client", now, now);
  for (const id of ["A", "B"])
    repo.db
      .prepare(
        "INSERT INTO cases(id,client_id,reference,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, "client", id, `Fictional ${id}`, now, now);
  return { repo, service: new TimeKeeperService(repo, { now: () => now }) };
}
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});
const start = (
  commandId = "start",
  sessionId = "s1",
  occurredAt = "2026-10-17T09:00:00Z",
  prerequisiteCommandId?: string,
) => ({
  producerId: "screenpipe",
  commandId,
  sessionId,
  occurredAt,
  ...(prerequisiteCommandId ? { prerequisiteCommandId } : {}),
});
const end = (
  commandId = "end",
  sessionId = "s1",
  occurredAt = "2026-10-17T12:00:00Z",
  prerequisiteCommandId?: string,
) => ({
  producerId: "screenpipe",
  commandId,
  sessionId,
  occurredAt,
  ...(prerequisiteCommandId ? { prerequisiteCommandId } : {}),
});

it("covers repeated starts, first end, missing targets, and source replay", () => {
  const { repo, service } = fixture();
  const first = service.start(start());
  expect(service.start(start())).toEqual(first);
  expect(service.start(start("other-start", "s2", "2026-10-17T10:00:00Z"))).toEqual(first);
  expect(service.getSession("s1").startedAt).toBe("2026-10-17T09:00:00Z");
  service.openPeriod({
    id: "p1",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  const source = {
    id: "e1",
    periodId: "p1",
    instanceId: "fake-instance",
    contentType: "ocr",
    externalId: "frame-1",
    recordedAt: "2026-10-17T09:05:00Z",
  };
  service.importSource(source);
  service.importSource({ ...source, id: "retry-id" });
  expect(repo.db.prepare("SELECT count(*) AS n FROM sources").get()).toMatchObject({ n: 1 });
  expect(service.end(end()).status).toBe("applied");
  expect(service.end(end("later", "s1", "2026-10-17T12:05:00Z"))).toMatchObject({
    endedAt: "2026-10-17T12:00:00Z",
  });
  expect(() => service.end(end("missing", "", "2026-10-17T12:00:00Z"))).toThrow(AppError);
  expect(() => service.end(end("unknown", "absent"))).toThrow(AppError);
  expect(repo.db.prepare("SELECT count(*) AS n FROM sessions").get()).toMatchObject({ n: 1 });
});

it("applies known prerequisites before dependent end and new start", () => {
  const { service } = fixture();
  expect(service.end(end("end-first", "s1", "2026-10-17T12:00:00Z", "start-first"))).toMatchObject({
    status: "pending",
  });
  expect(service.start(start("next", "s2", "2026-10-17T13:00:00Z", "end-first"))).toMatchObject({
    status: "pending",
  });
  service.start(start("start-first"));
  expect(service.getSession("s1").endedAt).toBe("2026-10-17T12:00:00Z");
  expect(service.getSession("s2").startedAt).toBe("2026-10-17T13:00:00Z");
  expect(service.getSession("s2").endedAt).toBeNull();
});

it("completes journey steps 1-4 and 7-8 without deriving duration from observations", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p-a1",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.openPeriod({
    id: "p-unknown",
    sessionId: "s1",
    caseId: null,
    startedAt: "2026-10-17T10:00:00Z",
    origin: "unresolved",
    mode: "current",
  });
  expect(service.allQuestions()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ questionId: "period:p-unknown", status: "pending" }),
    ]),
  );
  expect(
    service.askQuestion({
      questionId: "retry-q",
      sessionId: "s1",
      periodId: "p-unknown",
      expectedAssignmentRevision: 0,
    }),
  ).toBe("period:p-unknown");
  service.importSource({
    id: "e1",
    periodId: "p-unknown",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "f1",
    recordedAt: "2026-10-17T10:05:00Z",
  });
  service.openPeriod({
    id: "p-b",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T10:15:00Z",
    origin: "automatic",
    mode: "current",
  });
  const answer = {
    questionId: "period:p-unknown",
    sessionId: "s1",
    periodId: "p-unknown",
    expectedAssignmentRevision: 0,
    caseId: "A",
    responseCommandId: "answer1",
  };
  expect(service.answerQuestion(answer).caseId).toBe("A");
  expect(service.answerQuestion(answer).caseId).toBe("A");
  expect(service.getPeriod("p-b").caseId).toBe("B");
  service.setDurationOverride("p-unknown", 12 * 60000);
  service.validatePeriod("p-unknown");
  service.setDetectedDuration("p-unknown", 15 * 60000);
  expect(service.getPeriod("p-unknown").timeValidated).toBe(true);
  const p = service.getPeriod("p-unknown");
  const result = summarize([
    {
      id: p.id,
      caseId: p.caseId,
      clientId: "client",
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      detectedDurationMs: p.detectedDurationMs,
      durationOverrideMs: p.durationOverrideMs,
      coverage: "incomplete",
    },
  ]);
  expect(result).toMatchObject({ preciseDurationMs: 720000, roundedMinutes: 12, complete: false });
  expect(repo.db.prepare("SELECT count(*) AS n FROM pending_questions").get()).toMatchObject({
    n: 1,
  });
});

it("rejects stale answers, preserves manual corrections, and protects reviewed splits", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: null,
    startedAt: "2026-10-17T09:00:00Z",
    origin: "unresolved",
    mode: "current",
  });
  service.assignPeriod("p", "B", 0, "lawyer");
  service.setDurationOverride("p", 720000);
  service.validatePeriod("p");
  expect(() =>
    service.answerQuestion({
      questionId: "period:p",
      sessionId: "s1",
      periodId: "p",
      expectedAssignmentRevision: 0,
      caseId: "A",
      responseCommandId: "late",
    }),
  ).toThrowError(/stale/);
  expect(() => service.assignPeriod("p", "A", 1, "automatic")).toThrowError(/manual/);
  service.setDetectedDuration("p", 900000);
  expect(service.getPeriod("p").timeValidated).toBe(true);
  const revision = repo.period("p")!.revision;
  service.proposeReconstruction({
    id: "conflict",
    periodId: "p",
    expectedRevision: revision,
    startedAt: "2026-10-17T09:10:00Z",
    endedAt: "2026-10-17T09:20:00Z",
    sourceReferences: ["fake:f1"],
  });
  expect(repo.db.prepare("SELECT count(*) AS n FROM work_periods").get()).toMatchObject({ n: 1 });
  expect(repo.db.prepare("SELECT count(*) AS n FROM reconstruction_conflicts").get()).toMatchObject(
    { n: 1 },
  );
});

it("keeps source review, time review and billing separate; marks missing evidence without deleting time", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.setGlobalRate(25000, "EUR", "test-workspace");
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.importSource({
    id: "source",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "f1",
    recordedAt: "2026-10-17T09:05:00Z",
  });
  service.setDurationOverride("p", 600000);
  service.validateSource("fake", "ocr", "f1");
  expect(service.getPeriod("p").timeValidated).toBe(false);
  expect(() => service.setBillingStatus("p", "billed")).toThrow(/time validation/);
  service.validatePeriod("p");
  expect(service.getPeriod("p").billingStatus).toBe("unbilled");
  service.setBillingStatus("p", "billed");
  service.setSourceAvailability("fake", "ocr", "f1", "unavailable");
  expect(repo.sourceByIdentity("fake", "ocr", "f1")).toMatchObject({
    validationStatus: "validated",
    availabilityStatus: "unavailable",
  });
  expect(service.getPeriod("p")).toMatchObject({
    timeValidated: true,
    billingStatus: "billed",
    durationOverrideMs: 600000,
  });
});

it("accepts late in-bound evidence but excludes post-end evidence", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.end(end());
  service.importSource({
    id: "inside",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "f1",
    recordedAt: "2026-10-17T11:45:00Z",
  });
  expect(() =>
    service.importSource({
      id: "outside",
      periodId: "p",
      instanceId: "fake",
      contentType: "ocr",
      externalId: "f2",
      recordedAt: "2026-10-17T12:15:00Z",
    }),
  ).toThrow();
  expect(service.getSession("s1").endedAt).toBe("2026-10-17T12:00:00Z");
  expect(repo.db.prepare("SELECT count(*) AS n FROM sources").get()).toMatchObject({ n: 1 });
});

it("invalidates detected-duration changes and preserves identical replay after validation", () => {
  const { service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.setDetectedDuration("p", 720000);
  service.validatePeriod("p");
  service.setDetectedDuration("p", 900000);
  expect(service.getPeriod("p").timeValidated).toBe(false);
  service.validatePeriod("p");
  const revision = service.getPeriod("p").effectiveRevision;
  service.setDetectedDuration("p", 900000);
  expect(service.getPeriod("p")).toMatchObject({
    timeValidated: true,
    effectiveRevision: revision,
  });
});

it.skip("derives periods and durations from screenshots once the interval rule is agreed in docs/REQUIREMENTS.md", () => {});
it.skip("delivers end while the app is closed once the durable transport is chosen in docs/REQUIREMENTS.md", () => {});
it.skip("freezes historical rates once the snapshot boundary is agreed in docs/REQUIREMENTS.md", () => {});
it.skip("edits billed periods once the billing transition is agreed in docs/REQUIREMENTS.md", () => {});

it("uses a configured global rate unless the case has an explicit zero rate", () => {
  const { repo, service } = fixture();
  service.setGlobalRate(25000, "EUR", "workspace");
  expect(service.currentRateForCase("A")).toBe(25000);
  repo.db.prepare("UPDATE cases SET hourly_rate_cents=0 WHERE id=?").run("B");
  expect(service.currentRateForCase("B")).toBe(0);
});

it("preserves a committed start when a dependent end is invalid", () => {
  const { repo, service } = fixture();
  service.end(end("bad", "s1", "2026-10-17T08:00:00Z", "start-later"));
  service.start(start("start-later"));
  expect(service.getSession("s1").endedAt).toBeNull();
  expect(repo.command("screenpipe", "bad")?.status).toBe("rejected");
});

it("protects historical splits, permits current transitions, and rejects evidence outside a period", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p1",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.setDurationOverride("p1", 600000);
  service.validatePeriod("p1");
  const current = service.openPeriod({
    id: "p2",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T10:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  expect(current).toMatchObject({ id: "p2", caseId: "B" });
  const recovered = service.openPeriod({
    id: "late",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T09:30:00Z",
    origin: "automatic",
    mode: "recovery",
  });
  expect(recovered).toMatchObject({ status: "pending", conflictId: "late" });
  expect(repo.db.prepare("SELECT count(*) AS n FROM work_periods").get()).toMatchObject({ n: 2 });
  expect(() =>
    service.importSource({
      id: "bad",
      periodId: "p1",
      instanceId: "fake",
      contentType: "ocr",
      externalId: "later",
      recordedAt: "2026-10-17T11:00:00Z",
    }),
  ).toThrowError(/outside period/);
  expect(
    service.openPeriod({
      id: "p1",
      sessionId: "s1",
      caseId: "A",
      startedAt: "2026-10-17T09:00:00Z",
      origin: "automatic",
      mode: "current",
    }),
  ).toMatchObject({ id: "p1", durationOverrideMs: 600000 });
});

it("rejects superseded questions without assigning their periods", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: null,
    startedAt: "2026-10-17T09:00:00Z",
    origin: "unresolved",
    mode: "current",
  });
  repo.db
    .prepare("UPDATE pending_questions SET status='superseded' WHERE question_id='period:p'")
    .run();
  expect(() =>
    service.answerQuestion({
      questionId: "period:p",
      sessionId: "s1",
      periodId: "p",
      expectedAssignmentRevision: 0,
      caseId: "A",
      responseCommandId: "answer",
    }),
  ).toThrowError(/superseded/);
  expect(service.getPeriod("p").caseId).toBeNull();
});

it("splits an unprotected ended period inside its original bounds without overlap", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "old",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.end(end());
  service.openPeriod({
    id: "recovered",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T10:00:00Z",
    origin: "automatic",
    mode: "recovery",
  });
  expect(service.getPeriod("old").endedAt).toBe("2026-10-17T10:00:00Z");
  expect(service.getPeriod("recovered").endedAt).toBe("2026-10-17T12:00:00Z");
  expect(repo.db.prepare("SELECT count(*) AS n FROM reconstruction_conflicts").get()).toMatchObject(
    { n: 0 },
  );
});

it("does not infer elapsed duration from observations thirty seconds apart", () => {
  const { service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.importSource({
    id: "one",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "one",
    recordedAt: "2026-10-17T09:01:00Z",
  });
  service.importSource({
    id: "two",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "two",
    recordedAt: "2026-10-17T09:01:30Z",
  });
  expect(service.getPeriod("p").detectedDurationMs).toBeNull();
});

it.skip("identifies a folder transition and matches a case after the folder-identification rule in docs/REQUIREMENTS.md is agreed", () => {});
it.skip("verifies one provider tag target for all aliases after the Screenpipe target mapping contract in docs/REQUIREMENTS.md is verified", () => {});

it("protects lawyer case corrections during recovered transitions", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.assignPeriod("p", "B", 0, "lawyer");
  expect(
    service.openPeriod({
      id: "late",
      sessionId: "s1",
      caseId: "A",
      startedAt: "2026-10-17T10:00:00Z",
      origin: "automatic",
      mode: "recovery",
    }),
  ).toEqual({ status: "pending", conflictId: "late" });
  expect(service.getPeriod("p")).toMatchObject({ caseId: "B", endedAt: null });
  expect(repo.db.prepare("SELECT count(*) AS count FROM work_periods").get()?.count).toBe(1);
});

it("moves late evidence and its aliases atomically on a safe split and accepts original import replay", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  const source = {
    id: "late-source",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "frame-1",
    recordedAt: "2026-10-17T11:00:00Z",
  };
  service.importSource(source);
  service.importSource({ ...source, id: "alias", contentType: "screen" });
  repo.db
    .prepare(
      "INSERT INTO tag_targets(id,screenpipe_instance_id,target_type,target_id,work_period_id) VALUES ('t','fake','frame','frame-1','p')",
    )
    .run();
  repo.db.prepare("UPDATE sources SET tag_target_id='t'").run();
  service.openPeriod({
    id: "q",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T10:00:00Z",
    origin: "automatic",
    mode: "recovery",
  });
  expect(service.listSources("p")).toHaveLength(0);
  expect(service.listSources("q")).toHaveLength(2);
  expect(
    repo.db.prepare("SELECT work_period_id,target_revision FROM tag_targets WHERE id='t'").get(),
  ).toMatchObject({ work_period_id: "q", target_revision: 1 });
  expect(() => service.importSource(source)).not.toThrow();
  expect(() => service.importSource({ ...source, periodId: "q" })).not.toThrow();
  expect(() => service.importSource({ ...source, periodId: "unrelated" })).toThrow();
  expect(repo.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("blocks a split when provider target aliases straddle its boundary in current mode", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  for (const [id, time] of [
    ["before", "09:30"],
    ["after", "11:00"],
  ])
    service.importSource({
      id,
      periodId: "p",
      instanceId: "fake",
      contentType: "ocr",
      externalId: id,
      recordedAt: `2026-10-17T${time}:00Z`,
    });
  repo.db
    .prepare(
      "INSERT INTO tag_targets(id,screenpipe_instance_id,target_type,target_id,work_period_id) VALUES ('t','fake','frame','frame-1','p')",
    )
    .run();
  repo.db.prepare("UPDATE sources SET tag_target_id='t'").run();
  expect(
    service.openPeriod({
      id: "q",
      sessionId: "s1",
      caseId: "B",
      startedAt: "2026-10-17T10:00:00Z",
      origin: "automatic",
      mode: "current",
    }),
  ).toMatchObject({ status: "pending" });
  expect(service.getPeriod("p").endedAt).toBeNull();
  expect(service.listSources("p")).toHaveLength(2);
});

it("snapshots the configured currency when marking a period billed", () => {
  const { service } = fixture();
  service.setGlobalRate(0, "EUR", "workspace");
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.setDurationOverride("p", 60000);
  service.validatePeriod("p");
  expect(service.setBillingStatus("p", "billed")).toMatchObject({
    appliedCurrency: "EUR",
    appliedHourlyRateCents: 0,
  });
});

it("preserves provider delivery intent when a split would move a tagged target", () => {
  const { repo, service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  service.importSource({
    id: "e",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "e",
    recordedAt: "2026-10-17T11:00:00Z",
  });
  repo.db
    .prepare(
      "INSERT INTO tag_targets(id,screenpipe_instance_id,target_type,target_id,work_period_id) VALUES ('t','fake','frame','frame-1','p')",
    )
    .run();
  repo.db.prepare("UPDATE sources SET tag_target_id='t'").run();
  repo.db
    .prepare(
      "INSERT INTO assignment_deliveries(id,tag_target_id,target_revision,intended_tags_json,status) VALUES ('d','t',0,'[\"existing-tag\"]','verified')",
    )
    .run();
  expect(
    service.openPeriod({
      id: "q",
      sessionId: "s1",
      caseId: "B",
      startedAt: "2026-10-17T10:00:00Z",
      origin: "automatic",
      mode: "recovery",
    }),
  ).toMatchObject({ status: "pending" });
  expect(
    repo.db.prepare("SELECT work_period_id,target_revision FROM tag_targets WHERE id='t'").get(),
  ).toMatchObject({ work_period_id: "p", target_revision: 0 });
  expect(
    repo.db
      .prepare("SELECT intended_tags_json,status FROM assignment_deliveries WHERE id='d'")
      .get(),
  ).toMatchObject({ intended_tags_json: '["existing-tag"]', status: "verified" });
});

it("preserves source replay through successive safe splits and rejects new evidence at the old boundary", () => {
  const { service } = fixture();
  service.start(start());
  service.openPeriod({
    id: "p",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  const source = {
    id: "e",
    periodId: "p",
    instanceId: "fake",
    contentType: "ocr",
    externalId: "e",
    recordedAt: "2026-10-17T11:30:00Z",
  };
  service.importSource(source);
  service.openPeriod({
    id: "q",
    sessionId: "s1",
    caseId: "B",
    startedAt: "2026-10-17T10:00:00Z",
    origin: "automatic",
    mode: "recovery",
  });
  service.openPeriod({
    id: "r",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T11:00:00Z",
    origin: "automatic",
    mode: "recovery",
  });
  expect(() => service.importSource(source)).not.toThrow();
  expect(() => service.importSource({ ...source, periodId: "q" })).not.toThrow();
  expect(service.listSources("r")).toHaveLength(1);
  expect(() =>
    service.importSource({
      ...source,
      id: "new",
      externalId: "new",
      recordedAt: "2026-10-17T10:00:00Z",
    }),
  ).toThrow("source outside period");
});
