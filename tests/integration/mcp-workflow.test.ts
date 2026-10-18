// MCP tools against the real application API (Hono app, SQLite in memory, application services).
import { describe, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { ensureSession, getStatus, type SessionDeps } from "../../src/mcp/session.js";
import { initialLinkState, linkTick, type ScreenpipeState } from "../../src/mcp/screenpipe-link.js";
import {
  answerQuestion,
  endSession,
  listCases,
  listQuestions,
  listWorkPeriods,
  recordCaseTransition as guardedTransition,
} from "../../src/mcp/workflow.js";

async function recordCaseTransition(deps: SessionDeps, input: Record<string, unknown>) {
  const status = await getStatus(deps).catch(() => null);
  return guardedTransition(deps, {
    expectedActivePeriodId: status?.activePeriod?.id ?? null,
    expectedAssignmentRevision: status?.activePeriod?.assignmentRevision ?? null,
    ...input,
  });
}

function realApi() {
  const app = createApp(memoryDb());
  let clock = Date.parse("2026-10-17T09:00:00.000Z");
  let n = 0;
  const deps: SessionDeps = {
    apiBase: "http://tk/api",
    fetch: ((url: string, init?: RequestInit) =>
      app.request(String(url).replace("http://tk", ""), init)) as typeof fetch,
    now: () => new Date(clock),
    newId: () => `test-${++n}`,
    sleep: async () => {},
  };
  return {
    app,
    deps,
    at: (iso: string) => {
      clock = Date.parse(iso);
    },
  };
}

const periods = async (app: ReturnType<typeof createApp>, sessionId: string) =>
  ((await (await app.request("/api/work-periods")).json()) as Record<string, unknown>[])
    .filter((p) => p.sessionId === sessionId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

describe("MCP workflow against the application API", () => {
  it("creates a fresh active session when capture resumes within the same Screenpipe engine", async () => {
    const { deps, at } = realApi();
    await endSession(deps);
    const engineStartedAt = "2026-10-17T08:59:00.000Z";
    let screenpipe: ScreenpipeState = { running: true, engineStartedAt };
    const link = {
      session: deps,
      readScreenpipe: async () => screenpipe,
      graceMs: 60_000,
      log: () => {},
    };
    let state = await linkTick(link, initialLinkState());
    const firstSession = (await getStatus(deps)).activeSession;
    expect(state).toMatchObject({ started: true, sessionId: firstSession?.id });

    at("2026-10-17T09:01:00.000Z");
    screenpipe = { running: false };
    state = await linkTick(link, state);
    expect(state).toMatchObject({ ended: true, started: false });
    expect((await getStatus(deps)).activeSession).toBeNull();

    at("2026-10-17T09:02:00.000Z");
    screenpipe = { running: true, engineStartedAt };
    state = await linkTick(link, state);
    const resumedSession = (await getStatus(deps)).activeSession;
    expect(state).toMatchObject({ started: true, sessionId: resumedSession?.id });
    expect(resumedSession).toMatchObject({
      startedAt: "2026-10-17T09:02:00.000Z",
      endedAt: null,
    });
    expect(resumedSession?.id).not.toBe(firstSession?.id);
  });

  it("does not claim a replayed start is active after that session ended", async () => {
    const { deps, at } = realApi();
    await endSession(deps);
    const retry = { id: "replayed-start", occurredAt: deps.now().toISOString() };
    expect(await ensureSession(deps, undefined, retry)).toMatchObject({ status: "started" });
    at("2026-10-17T09:01:00.000Z");
    expect(await endSession(deps)).toMatchObject({ status: "ended" });
    expect(await ensureSession(deps, undefined, retry)).toMatchObject({
      status: "error",
      started: false,
      error: "session-not-active",
    });
    expect((await getStatus(deps)).activeSession).toBeNull();
  });

  it("returns a confirmed session end when watcher diagnostics cannot be read", async () => {
    const { deps, at } = realApi();
    await ensureSession(deps);
    at("2026-10-17T10:00:00.000Z");
    // Reading a directory as a PID file fails on the supported desktop platforms.
    expect(await endSession(deps, new URL("../", import.meta.url).pathname)).toMatchObject({
      status: "ended",
      ended: true,
    });
    expect((await getStatus(deps)).activeSession).toBeNull();
  });

  it("start, record JEV transitions, ask about an unknown folder, end, and refuse stale writes", async () => {
    const { app, deps, at } = realApi();

    // The demo seed leaves yesterday's session active: the End button ends it first.
    at("2026-10-17T08:00:00.000Z");
    expect(await endSession(deps)).toMatchObject({
      status: "ended",
      session: { id: "demo-2026-10-16", endedAt: "2026-10-17T08:00:00.000Z" },
    });
    at("2026-10-17T09:00:00.000Z");

    // Start button: one session, a second press changes nothing.
    const start = await ensureSession(deps);
    expect(start.status).toBe("started");
    const sessionId = (start as Record<string, unknown>).session.id as string;
    expect(await ensureSession(deps)).toMatchObject({
      status: "already_active",
      session: { id: sessionId },
    });

    // Candidates come from the canonical case table.
    const cases = await listCases(deps);
    expect(cases.length).toBeGreaterThanOrEqual(2);
    expect(cases[0]).toEqual({
      id: expect.any(String),
      clientId: expect.any(String),
      clientName: expect.any(String),
      reference: expect.any(String),
      title: expect.any(String),
    });
    const [a, b] = cases;

    // JEV confirmed a change to case A, then stayed on A, then moved to B.
    const toA = await recordCaseTransition(deps, {
      sessionId,
      transitionAt: "2026-10-17T09:05:00.000Z",
      caseId: a!.id,
    });
    expect(toA).toMatchObject({
      status: "applied",
      period: { caseId: a!.id, startedAt: "2026-10-17T09:05:00.000Z" },
      questionId: null,
    });
    expect(
      await recordCaseTransition(deps, {
        sessionId,
        transitionAt: "2026-10-17T09:07:00.000Z",
        caseId: a!.id,
      }),
    ).toMatchObject({ status: "no_change", reason: "same_case" });
    const toB = await recordCaseTransition(deps, {
      sessionId,
      transitionAt: "2026-10-17T09:20:00.000Z",
      caseId: b!.id,
    });
    expect(toB).toMatchObject({ status: "applied", period: { caseId: b!.id } });

    // Unknown folder: unresolved period and a question for the lawyer.
    const unknown = await recordCaseTransition(deps, {
      sessionId,
      transitionAt: "2026-10-17T09:40:00.000Z",
      caseId: null,
    });
    expect(unknown).toMatchObject({ status: "applied", period: { caseId: null } });
    const questionId = (unknown as Record<string, unknown>).questionId;
    const questions = (await (await app.request("/api/questions")).json()) as Record<
      string,
      unknown
    >[];
    expect(questions).toContainEqual(
      expect.objectContaining({ questionId, status: "pending", sessionId }),
    );

    // A retried call has no further effect; a delayed result older than the open period is refused.
    expect(
      await recordCaseTransition(deps, {
        sessionId,
        transitionAt: "2026-10-17T09:40:00.000Z",
        caseId: null,
      }),
    ).toMatchObject({
      status: "applied",
      period: { id: (unknown as Record<string, unknown>).period.id },
    });
    expect(
      await recordCaseTransition(deps, {
        sessionId,
        transitionAt: "2026-10-17T09:30:00.000Z",
        caseId: a!.id,
      }),
    ).toMatchObject({ status: "stale", reason: "newer_period" });
    expect(
      await recordCaseTransition(deps, {
        sessionId,
        transitionAt: "2026-10-17T09:50:00.000Z",
        caseId: "no-such-case",
      }),
    ).toMatchObject({ status: "error", error: "not-found" });

    // Periods follow the transitions: each one closes the previous at the new capture time.
    const ps = await periods(app, sessionId);
    expect(ps.map((p) => [p.caseId, p.startedAt, p.endedAt])).toEqual([
      [a!.id, "2026-10-17T09:05:00.000Z", "2026-10-17T09:20:00.000Z"],
      [b!.id, "2026-10-17T09:20:00.000Z", "2026-10-17T09:40:00.000Z"],
      [null, "2026-10-17T09:40:00.000Z", null],
    ]);
    expect(await getStatus(deps)).toMatchObject({
      activeSession: { id: sessionId },
      activePeriod: { caseId: null },
    });

    // End button: ends the session at the press time and closes the open period there.
    at("2026-10-17T10:00:00.000Z");
    const end = await endSession(deps);
    expect(end).toMatchObject({
      status: "ended",
      ended: true,
      session: { id: sessionId, endedAt: "2026-10-17T10:00:00.000Z" },
    });
    expect((await periods(app, sessionId)).at(-1)?.endedAt).toBe("2026-10-17T10:00:00.000Z");
    expect(await endSession(deps)).toMatchObject({ status: "no_active_session", ended: false });

    // Results arriving after the end change nothing; the next start is a new session.
    expect(
      await recordCaseTransition(deps, {
        sessionId,
        transitionAt: "2026-10-17T09:55:00.000Z",
        caseId: a!.id,
      }),
    ).toMatchObject({ status: "stale", reason: "session_not_active" });
    at("2026-10-17T11:00:00.000Z");
    const again = await ensureSession(deps);
    expect(again).toMatchObject({ status: "started" });
    expect((again as Record<string, unknown>).session.id).not.toBe(sessionId);
  });

  it("lists periods and questions, answers a question, refuses a stale answer, and ends at a known earlier time", async () => {
    const { deps, at } = realApi();
    at("2026-10-17T08:00:00.000Z");
    await endSession(deps);
    at("2026-10-17T09:00:00.000Z");
    const sessionId = ((await ensureSession(deps)) as Record<string, unknown>).session.id as string;
    const [a, b] = await listCases(deps);

    await recordCaseTransition(deps, {
      sessionId,
      transitionAt: "2026-10-17T09:05:00.000Z",
      caseId: a!.id,
    });
    const unknown = (await recordCaseTransition(deps, {
      sessionId,
      transitionAt: "2026-10-17T09:30:00.000Z",
      caseId: null,
    })) as Record<string, unknown>;

    const listed = await listWorkPeriods(deps);
    expect(listed).toMatchObject({ status: "ok", session: { id: sessionId } });
    expect((listed as Record<string, unknown>).periods).toEqual([
      expect.objectContaining({
        caseId: a!.id,
        case: `${a!.reference} - ${a!.title}`,
        startedAt: "2026-10-17T09:05:00.000Z",
        endedAt: "2026-10-17T09:30:00.000Z",
        timeValidated: false,
      }),
      expect.objectContaining({
        caseId: null,
        case: null,
        startedAt: "2026-10-17T09:30:00.000Z",
        endedAt: null,
        assignmentRevision: 0,
      }),
    ]);
    const pending = await listQuestions(deps);
    expect(pending).toMatchObject({
      status: "ok",
      questions: [
        {
          questionId: unknown.questionId,
          status: "pending",
          startedAt: "2026-10-17T09:30:00.000Z",
        },
      ],
    });

    let loseAnswerResponse = true;
    const uncertainDeps: SessionDeps = {
      ...deps,
      fetch: (async (url, init) => {
        const response = await deps.fetch(url, init);
        if (String(url).endsWith("/questions/answer") && loseAnswerResponse) {
          loseAnswerResponse = false;
          throw new Error("response lost after commit");
        }
        return response;
      }) as typeof fetch,
    };
    expect(
      await answerQuestion(uncertainDeps, { questionId: unknown.questionId, caseId: b!.id }),
    ).toMatchObject({ status: "unconfirmed", questionId: unknown.questionId });

    // Replaying the lawyer's answer recovers the committed result.
    expect(
      await answerQuestion(deps, { questionId: unknown.questionId, caseId: b!.id }),
    ).toMatchObject({
      status: "answered",
      period: {
        id: unknown.period.id,
        caseId: b!.id,
        case: `${b!.reference} - ${b!.title}`,
        assignmentRevision: 1,
      },
    });
    // An identical answer is also safe after a lost response or a process restart.
    const replayDeps = { ...deps, newId: () => "another-process-id" };
    expect(
      await answerQuestion(replayDeps, { questionId: unknown.questionId, caseId: b!.id }),
    ).toMatchObject({ status: "answered", period: { id: unknown.period.id, caseId: b!.id } });
    expect(
      await answerQuestion(deps, { questionId: unknown.questionId, caseId: a!.id }),
    ).toMatchObject({ status: "error", error: "conflict" });
    expect(await listQuestions(deps)).toMatchObject({ questions: [] });
    expect(await answerQuestion(deps, { questionId: "nope", caseId: a!.id })).toMatchObject({
      status: "error",
      error: "not-found",
    });

    // Screenpipe session link: an end at a known earlier time never goes before the open period.
    at("2026-10-17T12:00:00.000Z");
    expect(
      await endSession(deps, undefined, {
        producerId: "screenpipe-session-link",
        at: "2026-10-17T09:10:00.000Z",
      }),
    ).toMatchObject({
      status: "ended",
      session: { id: sessionId, endedAt: "2026-10-17T09:30:00.000Z" },
    });
    // With no active session, the most recent one is listed.
    expect(await listWorkPeriods(deps)).toMatchObject({ session: { id: sessionId } });
  });

  it("rejects malformed transitions without calling the API", async () => {
    const { deps } = realApi();
    expect(
      await recordCaseTransition(deps, { sessionId: "s", transitionAt: "yesterday", caseId: null }),
    ).toMatchObject({ status: "error", error: "invalid-request" });
    expect(
      await recordCaseTransition(deps, {
        sessionId: "s",
        transitionAt: "2026-10-17T09:00:00Z",
        caseId: 7,
      }),
    ).toMatchObject({ status: "error", error: "invalid-request" });
  });

  it("reports a closed TimeKeeper without claiming an end", async () => {
    const { deps } = realApi();
    deps.fetch = (async () => {
      throw new TypeError("connection refused");
    }) as typeof fetch;
    expect(await endSession(deps)).toMatchObject({
      status: "timekeeper_not_running",
      ended: false,
    });
    expect(
      await recordCaseTransition(deps, {
        sessionId: "s",
        transitionAt: "2026-10-17T09:00:00Z",
        caseId: null,
      }),
    ).toMatchObject({ status: "timekeeper_not_running" });
  });
});

describe("write acknowledgement recovery", () => {
  const failures = [
    "invalid-json",
    "null",
    "empty-object",
    "wrong-target",
    "lost-body",
    "invalid-pending",
  ] as const;
  function damage(
    response: Response,
    failure: (typeof failures)[number],
  ): Promise<Response> | Response {
    if (failure === "invalid-pending") return new Response("{}", { status: 202 });
    if (failure === "lost-body")
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body lost after commit"));
          },
        }),
      );
    if (failure === "wrong-target")
      return response.json().then((body) => Response.json({ ...body, id: "another-period" }));
    return new Response(failure === "invalid-json" ? "{" : failure === "null" ? "null" : "{}");
  }

  it.each(failures)(
    "replays the original transition after a committed %s response",
    async (failure) => {
      const { app, deps, at } = realApi();
      await endSession(deps);
      at("2026-10-17T09:00:00.000Z");
      const start = await ensureSession(deps);
      if (start.status !== "started") throw new Error("Expected isolated session");
      const [caseInfo] = await listCases(deps);
      const input = {
        sessionId: start.session.id,
        transitionAt: "2026-10-17T09:05:00.000Z",
        caseId: caseInfo!.id,
        expectedActivePeriodId: null,
        expectedAssignmentRevision: null,
      };
      const sent: unknown[] = [];
      const unstable: SessionDeps = {
        ...deps,
        fetch: (async (url, init) => {
          const result = await deps.fetch(url, init);
          if (String(url).endsWith("/work-periods") && init?.method === "POST") {
            sent.push(JSON.parse(String(init.body)));
            if (sent.length === 1) return damage(result, failure);
          }
          return result;
        }) as typeof fetch,
      };
      const first = await guardedTransition(unstable, input);
      expect(first).toMatchObject({ status: "unconfirmed" });
      const recovered = await guardedTransition(unstable, input);
      expect(recovered).toMatchObject({ status: "applied", period: { caseId: caseInfo!.id } });
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      const stored = await periods(app, start.session.id);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe((sent[0] as { id: string }).id);
    },
  );

  it.each(failures)(
    "replays the original answer after a committed %s response",
    async (failure) => {
      const { deps, at } = realApi();
      await endSession(deps);
      at("2026-10-17T09:00:00.000Z");
      const start = await ensureSession(deps);
      if (start.status !== "started") throw new Error("Expected isolated session");
      const [caseInfo] = await listCases(deps);
      const transition = await guardedTransition(deps, {
        sessionId: start.session.id,
        transitionAt: "2026-10-17T09:05:00.000Z",
        caseId: null,
        expectedActivePeriodId: null,
        expectedAssignmentRevision: null,
      });
      if (transition.status !== "applied") throw new Error("Expected question");
      const input = { questionId: transition.questionId, caseId: caseInfo!.id };
      const sent: unknown[] = [];
      const unstable: SessionDeps = {
        ...deps,
        fetch: (async (url, init) => {
          const result = await deps.fetch(url, init);
          if (String(url).endsWith("/questions/answer")) {
            sent.push(JSON.parse(String(init?.body)));
            if (sent.length === 1) return damage(result, failure);
          }
          return result;
        }) as typeof fetch,
      };
      expect(await answerQuestion(unstable, input)).toMatchObject({ status: "unconfirmed" });
      expect(await answerQuestion(unstable, input)).toMatchObject({
        status: "answered",
        period: { id: transition.period.id, caseId: caseInfo!.id, assignmentRevision: 1 },
      });
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
    },
  );
});

describe("guarded inference results", () => {
  it("rejects an in-flight result after a lawyer answer and preserves deterministic replay", async () => {
    const { deps, at } = realApi();
    at("2026-10-17T08:00:00.000Z");
    await endSession(deps);
    at("2026-10-17T09:00:00.000Z");
    const start = await ensureSession(deps);
    if (start.status !== "started") throw new Error("Expected isolated session");
    const [a, b] = await listCases(deps);
    const original = {
      sessionId: start.session.id,
      transitionAt: "2026-10-17T09:05:00Z",
      caseId: null,
      expectedActivePeriodId: null,
      expectedAssignmentRevision: null,
    };
    const applied = await guardedTransition(deps, original);
    expect(applied.status).toBe("applied");
    expect(await guardedTransition(deps, original)).toMatchObject({ status: "applied" });
    const before = await getStatus(deps);
    if (
      before.timekeeper !== "running" ||
      !before.activePeriod ||
      applied.status !== "applied" ||
      !applied.questionId
    )
      throw new Error("Expected unresolved snapshot");
    const inFlight = {
      sessionId: start.session.id,
      transitionAt: "2026-10-17T09:15:00Z",
      caseId: a!.id,
      expectedActivePeriodId: before.activePeriod.id,
      expectedAssignmentRevision: before.activePeriod.assignmentRevision,
    };
    expect(
      await answerQuestion(deps, { questionId: applied.questionId, caseId: b!.id }),
    ).toMatchObject({ status: "answered" });
    expect(await guardedTransition(deps, inFlight)).toMatchObject({
      status: "stale",
      reason: "assignment_changed",
    });
    expect(await getStatus(deps)).toMatchObject({
      activePeriod: { id: before.activePeriod.id, caseId: b!.id },
    });
  });
});
