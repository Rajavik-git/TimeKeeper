import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { createApplicationServices } from "../../src/backend/bootstrap.js";
import { createHttpApp } from "../../src/backend/api/app.js";
import type { HistoryRunner } from "../../src/backend/ports/history.js";
import type { HistoryProposalInput } from "../../src/contracts/history.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const startAt = "2026-10-17T09:00:00.000Z";
const endAt = "2026-10-17T10:00:00.000Z";
function fixture(dispatch: HistoryRunner["dispatch"] = vi.fn(async () => "started" as const)) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrate(db);
  let now = "2026-10-17T11:00:00.000Z";
  const services = createApplicationServices(
    db,
    { now: () => now },
    { configured: true, dispatch },
  );
  services.repository.insertSession(
    { id: "session", startedAt: startAt, endedAt: endAt, revision: 0 },
    now,
  );
  services.catalog.createClient({ id: "client", name: "Test client", code: "TC" });
  services.catalog.createCase({
    id: "case",
    clientId: "client",
    title: "Test case",
    reference: "TEST",
  });
  for (const [id, recordedAt] of [
    ["source-a", "2026-10-17T09:05:00.000Z"],
    ["source-b", "2026-10-17T09:35:00.000Z"],
  ])
    services.core.importSource({
      id,
      periodId: null,
      instanceId: "local",
      contentType: "ocr",
      externalId: id,
      recordedAt,
    });
  const app = createHttpApp(services);
  const input = { sessionId: "session", startAt, endAt };
  const proposal: HistoryProposalInput = {
    caseId: "case",
    startedAt: startAt,
    endedAt: "2026-10-17T09:30:00.000Z",
    label: "Review case documents",
    confidence: 0.8,
    sourceIds: ["source-a"],
    hasGaps: true,
  };
  return {
    db,
    services,
    app,
    input,
    proposal,
    dispatch,
    at: (value: string) => {
      now = value;
    },
  };
}
async function ready(f: ReturnType<typeof fixture>, proposals = [f.proposal]) {
  const job = await f.services.history.generate(f.input);
  const claim = f.services.history.claim()!;
  f.services.history.complete(job.id, claim.claimId, proposals);
  return { job, claim, proposals: f.services.history.state().proposals };
}
const acceptInput = (p: HistoryProposalInput) => ({
  expectedRevision: 0,
  caseId: p.caseId,
  startedAt: p.startedAt,
  endedAt: p.endedAt,
  label: p.label,
  durationMs: 60_000,
});

describe("history proposal workflow", () => {
  it("creates only drafts until explicit acceptance, then preserves explicit duration and evidence validation", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    expect(f.services.core.allPeriods()).toHaveLength(0);
    f.services.core.validateSource("local", "ocr", "source-a");
    const result = f.services.history.accept(proposals[0].id, acceptInput(f.proposal));
    expect(result.period).toMatchObject({
      endedAt: f.proposal.endedAt,
      detectedDurationMs: null,
      durationOverrideMs: 60_000,
      timeValidated: false,
      billingStatus: "unbilled",
    });
    expect(f.services.core.allSources().find((s) => s.id === "source-a")).toMatchObject({
      workPeriodId: result.period.id,
      validationStatus: "validated",
    });
    expect(f.services.core.allSources().find((s) => s.id === "source-b")?.workPeriodId).toBeNull();
    expect(f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toEqual(result);
    expect(() =>
      f.services.history.accept(proposals[0].id, {
        ...acceptInput(f.proposal),
        durationMs: 120_000,
      }),
    ).toThrow("replay");
  });
  it("accepts siblings without treating its own links or periods as stale", async () => {
    const f = fixture();
    const second = {
      ...f.proposal,
      startedAt: f.proposal.endedAt,
      endedAt: endAt,
      sourceIds: ["source-b"],
    };
    const result = await ready(f, [f.proposal, second]);
    for (const p of result.proposals) f.services.history.accept(p.id, acceptInput(p));
    expect(f.services.core.allPeriods()).toHaveLength(2);
  });
  it("uses a revision-bound question when accepted without a case", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    const result = f.services.history.accept(proposals[0].id, {
      ...acceptInput(f.proposal),
      caseId: null,
    });
    expect(f.services.core.allQuestions()).toEqual([
      expect.objectContaining({
        periodId: result.period.id,
        expectedAssignmentRevision: 0,
        status: "pending",
      }),
    ]);
  });
  it("serializes concurrent dispatch and permits claim before dispatch acknowledgement", async () => {
    let resolve!: (value: "started") => void;
    const dispatch = vi.fn(
      () =>
        new Promise<"started">((r) => {
          resolve = r;
        }),
    );
    const f = fixture(dispatch);
    const generation = f.services.history.generate(f.input);
    await expect(f.services.history.generate(f.input)).rejects.toThrow("already");
    const claim = f.services.history.claim()!;
    expect(claim.job.status).toBe("running");
    resolve("started");
    expect((await generation).status).toBe("running");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(f.services.history.claim()).toBeNull();
  });
  it("expires persisted pending and running jobs without retry", async () => {
    const f = fixture();
    await f.services.history.generate(f.input);
    f.at("2026-10-17T11:02:00.000Z");
    expect(f.services.history.state().jobs[0].status).toBe("expired");
    await f.services.history.generate(f.input);
    f.services.history.claim();
    f.at("2026-10-17T11:17:00.000Z");
    const restarted = createApplicationServices(f.db, { now: () => "2026-10-17T11:17:00.000Z" });
    expect(restarted.history.state().jobs.every((j) => j.status === "expired")).toBe(true);
    expect(f.dispatch).toHaveBeenCalledTimes(2);
  });
  it("rejects late evidence and preserves drafts without a period write", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    f.services.core.importSource({
      id: "late",
      periodId: null,
      instanceId: "local",
      contentType: "ocr",
      externalId: "late",
      recordedAt: "2026-10-17T09:06:00Z",
    });
    expect(() => f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toThrow(
      "changed",
    );
    expect(f.services.core.allPeriods()).toHaveLength(0);
  });
  it("rejects changed period state and any overlapping acceptance", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    const task = f.services.catalog.createTaskType({ code: "TEST", label: "Test" });
    f.services.core.createManualPeriod({
      sessionId: "session",
      caseId: "case",
      startedAt: startAt,
      durationMs: 60_000,
      taskTypeId: task.id,
      label: "Existing",
    });
    expect(() => f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toThrow(
      "changed",
    );
    expect(f.services.core.allPeriods()).toHaveLength(1);
  });
  it("rejects malformed completion atomically and validates replay identities", async () => {
    const f = fixture();
    const job = await f.services.history.generate(f.input);
    const claim = f.services.history.claim()!;
    expect(() =>
      f.services.history.complete(job.id, claim.claimId, [
        f.proposal,
        { ...f.proposal, sourceIds: ["missing"] },
      ]),
    ).toThrow();
    expect(f.services.history.state().proposals).toHaveLength(0);
    f.services.history.complete(job.id, claim.claimId, [f.proposal]);
    expect(f.services.history.complete(job.id, claim.claimId, [f.proposal]).status).toBe("ready");
    expect(() => f.services.history.complete(job.id, claim.claimId, [])).toThrow("replay");
  });
  it("sanitizes dispatch failures and excludes claim tokens from UI state", async () => {
    const f = fixture(
      vi.fn(async () => {
        throw new Error("private provider token");
      }),
    );
    expect(await f.services.history.generate(f.input)).toMatchObject({
      status: "failed",
      error: "dispatch-failed",
    });
    const response = await f.app.request("/api/history");
    expect(await response.text()).not.toMatch(/claimId|snapshot|private provider/);
  });
  it("validates all public mutations before application execution", async () => {
    const f = fixture();
    for (const [path, body] of [
      ["generate", { ...f.input, startAt: "invalid" }],
      ["proposals/missing/accept", { ...acceptInput(f.proposal), durationMs: 0 }],
      ["jobs/missing/complete", { claimId: "x", proposals: [{ ...f.proposal, sourceIds: [] }] }],
    ]) {
      const response = await f.app.request(`/api/history/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
  it("persists stale-claim failure and releases singleflight", async () => {
    const f = fixture();
    await f.services.history.generate(f.input);
    f.services.catalog.updateCase("case", { status: "archived" });
    expect(() => f.services.history.claim()).toThrow("changed");
    expect(f.services.history.state().jobs[0]).toMatchObject({
      status: "failed",
      error: "stale-snapshot",
    });
    expect((await f.services.history.generate(f.input)).status).toBe("dispatched");
  });
  it("blocks generation and acceptance for intersecting import gaps", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    f.db
      .prepare(
        "INSERT INTO retrieval_progress(id, session_id, screenpipe_instance_id, requested_start_at, requested_end_at, status) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("gap", "session", "local", startAt, endAt, "failed");
    await expect(f.services.history.generate(f.input)).rejects.toThrow("imports");
    expect(() => f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toThrow(
      "imports",
    );
  });
  it("rolls back period insertion, source writes and proposal status together", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    const save = vi.spyOn(f.services.repository, "saveSource").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toThrow(
      "storage unavailable",
    );
    expect(f.services.core.allPeriods()).toHaveLength(0);
    expect(f.services.history.state().proposals[0].status).toBe("draft");
    expect(f.services.core.allSources().every((source) => source.workPeriodId === null)).toBe(true);
    save.mockRestore();
    expect(
      f.services.history.accept(proposals[0].id, acceptInput(f.proposal)).proposal.status,
    ).toBe("accepted");
  });
  it("blocks source ownership changes and catalog status changes after review", async () => {
    const f = fixture();
    const { proposals } = await ready(f);
    f.services.catalog.updateCase("case", { status: "archived" });
    expect(() => f.services.history.accept(proposals[0].id, acceptInput(f.proposal))).toThrow(
      "changed",
    );
    expect(f.services.core.allPeriods()).toHaveLength(0);
  });
  it("keeps unconfirmed dispatch claimable but never claims ready early", async () => {
    const f = fixture(vi.fn(async () => "unconfirmed" as const));
    const job = await f.services.history.generate(f.input);
    expect(job.status).toBe("dispatch-unconfirmed");
    expect(f.services.history.state().proposals).toHaveLength(0);
    expect(f.services.history.claim()?.job.status).toBe("running");
  });
  it.each(["not-configured", "history-too-large"] as const)(
    "persists actionable workflow failure %s through the API",
    async (error) => {
      const f = fixture();
      const job = await f.services.history.generate(f.input);
      const claim = f.services.history.claim()!;
      const response = await f.app.request(`/api/history/jobs/${job.id}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimId: claim.claimId, error }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "failed", error });
      expect(f.services.history.state().jobs[0]).toMatchObject({ status: "failed", error });
    },
  );
});
