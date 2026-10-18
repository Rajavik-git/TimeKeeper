import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { PillService } from "../../src/backend/application/pill.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type Period = {
  id: string;
  caseId: string | null;
  endedAt: string | null;
  excluded: boolean;
  label: string;
  demoApp: string | null;
  demoWindowTitle: string | null;
  assignmentRevision: number;
  effectiveRevision: number;
  timeValidated: boolean;
};
type Question = { periodId: string; status: string; expectedAssignmentRevision: number };
const brief = "2025-031 Opposition Brief v3.docx";

function setup() {
  const db = memoryDb();
  databases.push(db);
  const app = createApp(db);
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const get = async <T>(path: string) => (await (await app.request(`/api${path}`)).json()) as T;
  return { db, post, get };
}

it("records a confirmed document switch as a visible canonical period", async () => {
  const { post, get } = setup();
  const recognition = await post("/recognize", { windowTitle: brief, appName: "Word" });
  expect(await recognition.json()).toMatchObject({
    confidence: "high",
    suggestion: { caseId: "1", title: "Dawson v Martin" },
  });
  const response = await post("/periods/switch", {
    caseId: "1",
    windowTitle: brief,
    appName: "Word",
    at: "2026-10-16T16:43:00Z",
  });
  expect(response.status).toBe(200);
  const period = (await response.json()) as Period;
  const day = await get<Period[]>("/work-periods?date=2026-10-16&timeZone=UTC");
  expect(day).toContainEqual(
    expect.objectContaining({
      id: period.id,
      caseId: "1",
      label: brief,
      demoApp: "Word",
      demoWindowTitle: brief,
      endedAt: null,
    }),
  );
  expect(day.filter((item) => item.endedAt === null)).toHaveLength(1);
});

it("opens non-client work already excluded, without a pending question", async () => {
  const { post, get } = setup();
  const response = await post("/periods/switch", {
    caseId: null,
    notClientWork: true,
    windowTitle: "Private notes",
    appName: "Editor",
    at: "2026-10-16T16:43:00Z",
  });
  expect(response.status).toBe(200);
  const period = (await response.json()) as Period;
  expect(period.excluded).toBe(true);
  const questions = await get<Question[]>("/questions");
  expect(questions.some((q) => q.periodId === period.id && q.status === "pending")).toBe(false);
});

it("asks which case an unknown document belongs to", async () => {
  const { post, get } = setup();
  const period = (await (
    await post("/periods/switch", {
      caseId: null,
      windowTitle: "Untitled.docx",
      appName: "Word",
      at: "2026-10-16T16:43:00Z",
    })
  ).json()) as Period;
  expect(period.caseId).toBeNull();
  expect(await get<Question[]>("/questions")).toContainEqual(
    expect.objectContaining({ periodId: period.id, status: "pending" }),
  );
});

it("rejects switches without an active session or with invalid input", async () => {
  const { db, post } = setup();
  const body = { caseId: "1", windowTitle: brief, appName: "Word", at: "2026-10-16T16:43:00Z" };
  expect((await post("/periods/switch", { ...body, at: "16:43" })).status).toBe(400);
  expect((await post("/periods/switch", { ...body, caseId: "missing" })).status).toBe(404);
  expect(
    (await post("/periods/switch", { ...body, caseId: "1", notClientWork: true })).status,
  ).toBe(400);
  db.prepare("UPDATE sessions SET ended_at=? WHERE ended_at IS NULL").run("2026-10-16T17:00:00Z");
  expect((await post("/periods/switch", body)).status).toBe(404);
});

it("undoes an answer without reviving its stale question", async () => {
  const { post, get } = setup();
  const answer = await post("/pill/decision", {
    kind: "assign",
    periodId: "13",
    caseId: "5",
    expectedAssignmentRevision: 0,
  });
  expect(answer.status).toBe(200);
  const { undoToken } = (await answer.json()) as { undoToken: string };
  expect((await get<Period>("/work-periods/13")).caseId).toBe("5");
  expect((await post("/pill/undo", { undoToken })).status).toBe(200);
  const period = await get<Period>("/work-periods/13");
  expect(period.caseId).toBeNull();
  expect(period.assignmentRevision).toBe(2);
  expect(await get<Question[]>("/questions")).toContainEqual(
    expect.objectContaining({ periodId: "13", status: "pending", expectedAssignmentRevision: 2 }),
  );
  expect((await post("/pill/undo", { undoToken })).status).toBe(409);
});

it("undoes a file switch only while its new period is unchanged", async () => {
  const { post, get } = setup();
  const before = await get<Period[]>("/work-periods");
  const prior = before.find((period) => period.endedAt === null);
  const switchBody = {
    kind: "switch",
    caseId: "1",
    windowTitle: brief,
    appName: "Word",
    at: "2026-10-16T16:43:00Z",
  };
  const result = await post("/pill/decision", switchBody);
  expect(result.status).toBe(200);
  const { period, undoToken } = (await result.json()) as { period: Period; undoToken: string };
  expect(await get<Period[]>("/work-periods")).toHaveLength(before.length + 1);
  expect((await post("/pill/undo", { undoToken })).status).toBe(200);
  expect((await get<{ error: string }>(`/work-periods/${period.id}`)).error).toBe("not-found");
  expect(await get<Period[]>("/work-periods")).toHaveLength(before.length);
  if (prior) expect((await get<Period>(`/work-periods/${prior.id}`)).endedAt).toBeNull();

  const next = (await (await post("/pill/decision", switchBody)).json()) as {
    period: Period;
    undoToken: string;
  };
  expect(
    (
      await post(`/work-periods/${next.period.id}/assignment`, {
        caseId: "2",
        expectedAssignmentRevision: 0,
        origin: "lawyer",
      })
    ).status,
  ).toBe(200);
  expect((await post("/pill/undo", { undoToken: next.undoToken })).status).toBe(409);
});

it("undoes exclusion and validation", async () => {
  const { post, get } = setup();
  const period = await get<Period>("/work-periods/13");
  const excluded = await post("/pill/decision", {
    kind: "exclude",
    periodId: "13",
    expectedAssignmentRevision: period.assignmentRevision,
    expectedEffectiveRevision: period.effectiveRevision,
  });
  expect(excluded.status).toBe(200);
  expect((await get<Period>("/work-periods/13")).excluded).toBe(true);
  const excludedToken = ((await excluded.json()) as { undoToken: string }).undoToken;
  expect((await post("/pill/undo", { undoToken: excludedToken })).status).toBe(200);
  expect((await get<Period>("/work-periods/13")).excluded).toBe(period.excluded);

  const before = await get<Period>("/work-periods/14");
  const validated = await post("/pill/decision", {
    kind: "validate",
    periodIds: ["14"],
    expectedEffectiveRevisions: { "14": before.effectiveRevision },
  });
  expect(validated.status).toBe(200);
  expect((await get<Period>("/work-periods/14")).timeValidated).toBe(true);
  const validatedToken = ((await validated.json()) as { undoToken: string }).undoToken;
  expect((await post("/pill/undo", { undoToken: validatedToken })).status).toBe(200);
  expect((await get<Period>("/work-periods/14")).timeValidated).toBe(before.timeValidated);
});

it("rejects stale pill decisions", async () => {
  const { post } = setup();
  expect(
    (
      await post("/pill/decision", {
        kind: "assign",
        periodId: "13",
        caseId: "5",
        expectedAssignmentRevision: 7,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post("/pill/decision", {
        kind: "validate",
        periodIds: ["14"],
        expectedEffectiveRevisions: { "14": 99 },
      })
    ).status,
  ).toBe(409);
});

it("expires undo tokens after five seconds", () => {
  const db = memoryDb();
  databases.push(db);
  const repository = new SqliteRepository(db);
  let now = Date.parse("2026-10-16T16:43:00Z");
  const pill = new PillService(repository, new TimeKeeperService(repository), () => now);
  const { undoToken } = pill.decision({
    kind: "assign",
    periodId: "13",
    caseId: "5",
    expectedAssignmentRevision: 0,
  });
  now += 5001;
  expect(() => pill.undo(undoToken)).toThrow(/expired/);
  expect(repository.period("13")!.caseId).toBe("5");
});
