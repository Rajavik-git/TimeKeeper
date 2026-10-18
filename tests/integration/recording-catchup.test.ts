import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { RetrievalService } from "../../src/backend/application/retrieval.js";
import { retrievalStore } from "../../src/backend/adapters/sqlite/retrieval.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { catchUpRecordings } from "../../src/backend/workers/recording-catchup.js";
import type { MemoryObservation, ScreenpipeMemory } from "../../src/backend/ports/index.js";

const repos: SqliteRepository[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});

function fixture(secondPeriod = true) {
  const repo = new SqliteRepository(new DatabaseSync(":memory:"));
  repos.push(repo);
  let now = "2026-10-17T13:00:00.000Z";
  const created = "2026-10-17T08:00:00Z";
  repo.db
    .prepare("INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)")
    .run("client", "Fictional Client", created, created);
  for (const id of ["A", "B"])
    repo.db
      .prepare(
        "INSERT INTO cases(id,client_id,reference,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, "client", id, `Fictional ${id}`, created, created);
  const service = new TimeKeeperService(repo, { now: () => now });
  service.start({
    producerId: "pipe",
    commandId: "start",
    sessionId: "s1",
    occurredAt: "2026-10-17T09:00:00Z",
  });
  service.openPeriod({
    id: "p-a",
    sessionId: "s1",
    caseId: "A",
    startedAt: "2026-10-17T09:00:00Z",
    origin: "automatic",
    mode: "current",
  });
  if (secondPeriod)
    service.openPeriod({
      id: "p-b",
      sessionId: "s1",
      caseId: "B",
      startedAt: "2026-10-17T10:00:00Z",
      origin: "automatic",
      mode: "current",
    });
  const recovery = new RetrievalService(repo, retrievalStore(repo.db), service, { now: () => now });
  const sourcesOf = () =>
    repo.db
      .prepare(
        "SELECT external_id AS id, work_period_id AS period FROM sources ORDER BY recorded_at",
      )
      .all();
  return {
    repo,
    service,
    recovery,
    sourcesOf,
    setNow: (value: string) => {
      now = value;
    },
  };
}

const at = (externalId: string, recordedAt: string): MemoryObservation => ({
  instanceId: "laptop",
  contentType: "ocr",
  externalId,
  recordedAt: new Date(recordedAt).toISOString(),
});

/** A stand-in for the Screenpipe adapter: returns the observations inside the requested window, or fails on demand. */
function memory(
  observations: MemoryObservation[],
  failOnCall?: number,
): ScreenpipeMemory & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async read(startAt, endAt) {
      calls.push(`${startAt}..${endAt}`);
      if (failOnCall === calls.length)
        throw new Error("Screenpipe is not reachable at http://localhost:3030");
      return observations.filter((o) => o.recordedAt >= startAt && o.recordedAt <= endAt);
    },
  };
}

describe("catching up missed recordings (docs/API.md D8 step 4)", () => {
  it("reads an ended session in one-hour windows and attaches each reference to its period", async () => {
    const { service, recovery, sourcesOf } = fixture();
    service.end({
      producerId: "pipe",
      commandId: "end",
      sessionId: "s1",
      occurredAt: "2026-10-17T12:00:00Z",
    });
    const m = memory([
      at("f1", "2026-10-17T09:30:00Z"),
      at("f2", "2026-10-17T10:30:00Z"),
      at("f3", "2026-10-17T11:59:00Z"),
    ]);
    const result = await catchUpRecordings(m, recovery, "laptop", "2026-10-17T13:00:00.000Z");
    expect(result).toEqual({ windows: 3, imported: 3, unchanged: 0, skipped: 0 });
    expect(m.calls).toEqual([
      "2026-10-17T09:00:00.000Z..2026-10-17T10:00:00.000Z",
      "2026-10-17T10:00:00.000Z..2026-10-17T11:00:00.000Z",
      "2026-10-17T11:00:00.000Z..2026-10-17T12:00:00.000Z",
    ]);
    expect(sourcesOf()).toEqual([
      { id: "f1", period: "p-a" },
      { id: "f2", period: "p-b" },
      { id: "f3", period: "p-b" },
    ]);
    expect(service.coverageGaps()).toEqual([]);
    expect(
      (await catchUpRecordings(m, recovery, "laptop", "2026-10-17T14:00:00.000Z")).windows,
    ).toBe(1);
  });

  it("continues an active session from its checkpoint, re-reading the last five minutes", async () => {
    const { recovery } = fixture();
    const m = memory([at("f1", "2026-10-17T10:27:00Z"), at("f2", "2026-10-17T10:45:00Z")]);
    await catchUpRecordings(m, recovery, "laptop", "2026-10-17T10:30:00.000Z");
    const second = await catchUpRecordings(m, recovery, "laptop", "2026-10-17T11:00:00.000Z");
    expect(m.calls.at(-1)).toBe("2026-10-17T10:25:00.000Z..2026-10-17T11:00:00.000Z");
    expect(second).toEqual({ windows: 1, imported: 1, unchanged: 1, skipped: 0 });
  });

  it("marks a failed read as a coverage gap, stops, and closes the gap on a later successful run", async () => {
    const { service, recovery } = fixture();
    service.end({
      producerId: "pipe",
      commandId: "end",
      sessionId: "s1",
      occurredAt: "2026-10-17T12:00:00Z",
    });
    const failing = await catchUpRecordings(
      memory([at("f1", "2026-10-17T10:30:00Z")], 2),
      recovery,
      "laptop",
      "2026-10-17T13:00:00.000Z",
    );
    expect(failing).toMatchObject({
      windows: 1,
      stoppedBy: "Screenpipe read failed",
      retryable: true,
    });
    expect(service.coverageGaps()).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        startedAt: "2026-10-17T10:00:00.000Z",
        status: "failed",
      }),
    ]);
    const m = memory([at("f1", "2026-10-17T10:30:00Z")]);
    const retry = await catchUpRecordings(m, recovery, "laptop", "2026-10-17T14:00:00.000Z");
    // Restarts five minutes before the checkpoint (10:00), so the windows no longer line up with the failed one.
    expect(m.calls[0]).toBe("2026-10-17T09:55:00.000Z..2026-10-17T10:55:00.000Z");
    expect(retry).toEqual({ windows: 3, imported: 1, unchanged: 0, skipped: 0 });
    expect(service.coverageGaps()).toEqual([]);
  });

  it("links an existing unlinked reference when one existing period matches", async () => {
    const { service, recovery, sourcesOf } = fixture();
    service.end({
      producerId: "pipe",
      commandId: "end",
      sessionId: "s1",
      occurredAt: "2026-10-17T12:00:00Z",
    });
    service.importSource({
      id: "manual",
      periodId: null,
      instanceId: "laptop",
      contentType: "ocr",
      externalId: "f1",
      recordedAt: "2026-10-17T09:30:00.000Z",
    });
    const result = await catchUpRecordings(
      memory([at("f1", "2026-10-17T09:30:00Z")]),
      recovery,
      "laptop",
      "2026-10-17T13:00:00.000Z",
    );
    expect(result).toMatchObject({ imported: 0, updated: 1 });
    expect(sourcesOf()).toEqual([{ id: "f1", period: "p-a" }]);
  });

  it("catches up the newest session before older ones", async () => {
    const { service, recovery } = fixture();
    service.end({
      producerId: "pipe",
      commandId: "end",
      sessionId: "s1",
      occurredAt: "2026-10-17T12:00:00Z",
    });
    service.start({
      producerId: "pipe",
      commandId: "start-2",
      sessionId: "s2",
      occurredAt: "2026-10-17T14:00:00Z",
    });
    const m = memory([]);
    await catchUpRecordings(m, recovery, "laptop", "2026-10-17T14:30:00.000Z", {
      windowMs: 60 * 60_000,
      overlapMs: 5 * 60_000,
      maxWindows: 2,
    });
    expect(m.calls).toEqual([
      "2026-10-17T14:00:00.000Z..2026-10-17T14:30:00.000Z",
      "2026-10-17T09:00:00.000Z..2026-10-17T10:00:00.000Z",
    ]);
  });

  it("reads at most the configured number of windows per run", async () => {
    const { recovery } = fixture();
    const m = memory([]);
    const result = await catchUpRecordings(m, recovery, "laptop", "2026-10-17T20:00:00.000Z", {
      windowMs: 60 * 60_000,
      overlapMs: 5 * 60_000,
      maxWindows: 3,
    });
    expect(result.windows).toBe(3);
    expect(m.calls.at(-1)).toBe("2026-10-17T11:00:00.000Z..2026-10-17T12:00:00.000Z");
  });
});

it("revisits an ended session tail for evidence indexed after its final successful read", async () => {
  const { service, recovery, sourcesOf } = fixture();
  service.end({
    producerId: "pipe",
    commandId: "end",
    sessionId: "s1",
    occurredAt: "2026-10-17T12:00:00Z",
  });
  await catchUpRecordings(memory([]), recovery, "laptop", "2026-10-17T13:00:00.000Z");
  const late = memory([at("late", "2026-10-17T11:59:00Z")]);
  expect(
    await catchUpRecordings(late, recovery, "laptop", "2026-10-17T14:00:00.000Z"),
  ).toMatchObject({ windows: 1, imported: 1 });
  expect(late.calls).toEqual(["2026-10-17T11:55:00.000Z..2026-10-17T12:00:00.000Z"]);
  expect(sourcesOf()).toEqual([{ id: "late", period: "p-b" }]);
});

it("keeps a gap incomplete when later coverage does not cover its beginning", () => {
  const { repo, recovery } = fixture();
  const missing = {
    id: "missing",
    sessionId: "s1",
    instanceId: "laptop",
    startAt: "2026-10-17T09:00:00.000Z",
    endAt: "2026-10-17T12:00:00.000Z",
  };
  recovery.failRetrieval(missing);
  recovery.completeRetrieval({ ...missing, id: "later", startAt: "2026-10-17T11:00:00.000Z" });
  expect(repo.coverageGaps()).toEqual([
    expect.objectContaining({ id: "missing", status: "failed" }),
  ]);
  expect(
    recovery.retrievalPlan("laptop", "2026-10-17T13:00:00.000Z", {
      windowMs: 3600000,
      overlapMs: 300000,
      maxWindows: 1,
    })[0].startAt,
  ).toBe(missing.startAt);
});

it("does not swallow an unexpected source identity change as completed coverage", async () => {
  const { service, recovery } = fixture();
  service.importSource({
    id: "old",
    periodId: "p-a",
    instanceId: "laptop",
    contentType: "ocr",
    externalId: "same",
    recordedAt: "2026-10-17T09:20:00.000Z",
  });
  await expect(
    catchUpRecordings(
      memory([at("same", "2026-10-17T09:30:00Z")]),
      recovery,
      "laptop",
      "2026-10-17T10:00:00.000Z",
    ),
  ).rejects.toThrow("source identity changed");
  expect(service.coverageGaps()).toEqual([expect.objectContaining({ status: "failed" })]);
});

it("clips an in-flight read and skips obsolete later windows after an original-time End", async () => {
  const { service, recovery, sourcesOf, repo } = fixture(false);
  const calls: string[] = [];
  const delayed: ScreenpipeMemory = {
    async read(startAt, endAt) {
      calls.push(`${startAt}..${endAt}`);
      service.end({
        producerId: "pipe",
        commandId: "late-end",
        sessionId: "s1",
        occurredAt: "2026-10-17T09:30:00.000Z",
      });
      return [at("inside", "2026-10-17T09:20:00Z"), at("outside", "2026-10-17T09:45:00Z")];
    },
  };
  expect(
    await catchUpRecordings(delayed, recovery, "laptop", "2026-10-17T12:00:00.000Z"),
  ).toMatchObject({ windows: 1, imported: 1, skipped: 1 });
  expect(calls).toHaveLength(1);
  expect(sourcesOf()).toEqual([{ id: "inside", period: "p-a" }]);
  expect(repo.db.prepare("SELECT requested_end_at FROM retrieval_progress").all()).toEqual([
    { requested_end_at: "2026-10-17T09:30:00.000Z" },
  ]);
});

it("reconciles saved unlinked references without re-reading their provider history", async () => {
  const { repo, service, recovery } = fixture();
  service.importSource({
    id: "saved",
    periodId: null,
    instanceId: "laptop",
    contentType: "ocr",
    externalId: "saved",
    recordedAt: "2026-10-17T09:30:00Z",
  });
  service.validateSource("laptop", "ocr", "saved");
  service.setSourceAvailability("laptop", "ocr", "saved", "available");
  const beforePeriod = repo.period("p-a");
  const beforeSource = repo.sourceByIdentity("laptop", "ocr", "saved")!;
  const noReads = {
    read: async () => {
      throw new Error("provider unavailable");
    },
  };
  const result = await catchUpRecordings(noReads, recovery, "laptop", "2026-10-17T13:00:00Z");
  expect(result.updated).toBe(1);
  expect(repo.sourceByIdentity("laptop", "ocr", "saved")).toEqual({
    ...beforeSource,
    workPeriodId: "p-a",
  });
  expect(repo.period("p-a")).toEqual(beforePeriod);
});

it("does not guess across overlapping periods, gaps, or another provider instance", () => {
  const { repo, service, recovery } = fixture();
  repo.db.prepare("UPDATE work_periods SET ended_at=? WHERE id='p-a'").run("2026-10-17T11:00:00Z");
  expect(recovery.periodIdAt("s1", "2026-10-17T12:30:00+02:00")).toBeNull();
  expect(recovery.periodIdAt("s1", "2026-10-17T08:59:59Z")).toBeNull();
  service.importSource({
    id: "other",
    periodId: null,
    instanceId: "other",
    contentType: "ocr",
    externalId: "other",
    recordedAt: "2026-10-17T09:30:00Z",
  });
  expect(recovery.reconcileUnlinked("laptop")).toEqual([]);
  expect(repo.sourceByIdentity("other", "ocr", "other")!.workPeriodId).toBeNull();
});

it("uses numeric timestamp boundaries and includes the exact final session end", () => {
  const { service, recovery } = fixture();
  service.end({
    producerId: "pipe",
    commandId: "end-boundary",
    sessionId: "s1",
    occurredAt: "2026-10-17T12:00:00Z",
  });
  expect(recovery.periodIdAt("s1", "2026-10-17T12:00:00+02:00")).toBe("p-b");
  expect(recovery.periodIdAt("s1", "2026-10-17T14:00:00+02:00")).toBe("p-b");
  expect(recovery.periodIdAt("s1", "2026-10-17T14:00:00.001+02:00")).toBeNull();
});

it("fills bounded context without replacing a corrected attachment or reviewed source", () => {
  const { repo, service, recovery } = fixture();
  service.importSource({
    id: "context",
    periodId: "p-a",
    instanceId: "laptop",
    contentType: "ocr",
    externalId: "context",
    recordedAt: "2026-10-17T09:30:00Z",
  });
  service.validateSource("laptop", "ocr", "context");
  repo.db.prepare("UPDATE sources SET work_period_id='p-b' WHERE id='context'").run();
  const reviewed = repo.sourceByIdentity("laptop", "ocr", "context")!;
  expect(
    recovery.importSource({
      id: "ignored-id",
      periodId: "p-a",
      instanceId: "laptop",
      contentType: "ocr",
      externalId: "context",
      recordedAt: "2026-10-17T09:30:00.000Z",
      excerpt: "Literal " + "x".repeat(1100),
      appName: "a".repeat(350),
      windowName: "Original window",
    }).status,
  ).toBe("updated");
  const enriched = repo.sourceByIdentity("laptop", "ocr", "context")!;
  expect(enriched).toMatchObject({
    ...reviewed,
    excerpt: expect.any(String),
    appName: expect.any(String),
    windowName: "Original window",
  });
  expect(enriched.excerpt).toHaveLength(1000);
  expect(enriched.appName).toHaveLength(300);
  expect(
    recovery.importSource({
      id: "ignored-id",
      periodId: "p-a",
      instanceId: "laptop",
      contentType: "ocr",
      externalId: "context",
      recordedAt: "2026-10-17T09:30:00Z",
      excerpt: "Replacement",
      appName: "Replacement",
      windowName: "Replacement",
    }).status,
  ).toBe("unchanged");
  expect(repo.sourceByIdentity("laptop", "ocr", "context")).toEqual(enriched);
  expect(() =>
    service.importSource({
      id: "context",
      periodId: "p-a",
      instanceId: "laptop",
      contentType: "ocr",
      externalId: "context",
      recordedAt: "2026-10-17T09:30:00Z",
    }),
  ).toThrow("source identity changed");
});

it("replays legacy completed windows in bounded batches once to retain descriptions", async () => {
  const { repo, service, recovery } = fixture();
  service.end({
    producerId: "pipe",
    commandId: "end-backfill",
    sessionId: "s1",
    occurredAt: "2026-10-17T12:00:00Z",
  });
  const legacy = {
    id: "legacy",
    sessionId: "s1",
    instanceId: "laptop",
    startAt: "2026-10-17T09:00:00Z",
    endAt: "2026-10-17T12:00:00Z",
  };
  retrievalStore(repo.db).save(legacy, "complete", "2026-10-17T13:00:00Z");
  repo.db.prepare("UPDATE retrieval_progress SET content_version=0").run();
  const provider = memory([
    {
      ...at("old", "2026-10-17T09:30:00Z"),
      excerpt: "Existing search text",
      appName: "Editor",
      windowName: "Document",
    },
  ]);
  for (let i = 0; i < 3; i++)
    await catchUpRecordings(provider, recovery, "laptop", "2026-10-17T13:00:00Z", {
      windowMs: 3600000,
      overlapMs: 0,
      maxWindows: 1,
    });
  expect(provider.calls).toHaveLength(3);
  expect(repo.sourceByIdentity("laptop", "ocr", "old")).toMatchObject({
    excerpt: "Existing search text",
    appName: "Editor",
    windowName: "Document",
    workPeriodId: "p-a",
  });
  expect(
    recovery.retrievalPlan("laptop", "2026-10-17T13:00:00Z", {
      windowMs: 3600000,
      overlapMs: 0,
      maxWindows: 1,
    }),
  ).toEqual([]);
});

it("leaves ambiguous overlapping sessions unlinked for both existing and newly read references", () => {
  const { repo, service, recovery } = fixture();
  repo.db
    .prepare(
      "INSERT INTO sessions(id,started_at,ended_at,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
    .run(
      "overlap",
      "2026-10-17T09:00:00Z",
      "2026-10-17T10:00:00Z",
      "2026-10-17T09:00:00Z",
      "2026-10-17T10:00:00Z",
    );
  service.importSource({
    id: "ambiguous",
    periodId: null,
    instanceId: "laptop",
    contentType: "ocr",
    externalId: "ambiguous",
    recordedAt: "2026-10-17T09:30:00Z",
  });
  expect(recovery.periodIdAt("s1", "2026-10-17T09:30:00Z")).toBeNull();
  expect(recovery.reconcileUnlinked("laptop")).toEqual([]);
});

it("rolls back all local links if a later saved reference fails", () => {
  const { repo, service, recovery } = fixture();
  for (const id of ["first", "second"])
    service.importSource({
      id,
      periodId: null,
      instanceId: "laptop",
      contentType: "ocr",
      externalId: id,
      recordedAt: "2026-10-17T09:30:00Z",
    });
  const save = repo.saveSource.bind(repo);
  let writes = 0;
  repo.saveSource = (source) => {
    if (++writes === 2) throw new Error("test write failure");
    save(source);
  };
  expect(() => recovery.reconcileUnlinked("laptop")).toThrow("test write failure");
  repo.saveSource = save;
  expect(repo.allSources().map((source) => source.workPeriodId)).toEqual([null, null]);
});

it("counts one reference once when the same sync links and enriches it", async () => {
  const { service, recovery } = fixture();
  service.importSource({
    id: "both",
    periodId: null,
    instanceId: "laptop",
    contentType: "ocr",
    externalId: "both",
    recordedAt: "2026-10-17T09:30:00Z",
  });
  const provider = memory([{ ...at("both", "2026-10-17T09:30:00Z"), excerpt: "literal excerpt" }]);
  const result = await catchUpRecordings(provider, recovery, "laptop", "2026-10-17T13:00:00Z");
  expect(result.updated).toBe(1);
});
