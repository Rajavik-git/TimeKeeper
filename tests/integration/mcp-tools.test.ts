import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { handle } from "../../src/mcp/server.js";
import type { SessionDeps } from "../../src/mcp/session.js";

const databases: ReturnType<typeof memoryDb>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const origin = "http://127.0.0.1:8787";

/** MCP tools against Michel's real API on the fixture database, without network. */
function setup(overrides: Partial<SessionDeps> = {}) {
  const db = memoryDb();
  databases.push(db);
  const app = createApp(db);
  const dir = mkdtempSync(join(tmpdir(), "tk-mcp-"));
  directories.push(dir);
  let next = 0;
  const deps: SessionDeps = {
    apiOrigin: origin,
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      app.request(String(input), init)) as typeof fetch,
    now: () => new Date(),
    newId: () => `test-${++next}`,
    sleep: async () => undefined,
    ...overrides,
  };
  const context = { deps, linkStatePath: join(dir, "link.json") };
  let id = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = (await handle(
      { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } },
      context,
    )) as { result: { content: Array<{ text: string }>; isError: boolean } };
    return {
      ...(JSON.parse(response.result.content[0].text) as Record<string, unknown>),
      isError: response.result.isError,
    };
  };
  return { call, context, db };
}

it("lists only the ported tools, without JEV tab detection", async () => {
  const { context } = setup();
  const response = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, context)) as {
    result: { tools: Array<{ name: string }> };
  };
  expect(response.result.tools.map((tool) => tool.name)).toEqual([
    "timekeeper_status",
    "start_session",
    "end_session",
    "list_cases",
    "list_work_periods",
    "list_questions",
    "answer_question",
    "screenpipe_link_status",
  ]);
  expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, context)).toBeNull();
});

it("reports the active session and keeps start idempotent", async () => {
  const { call } = setup();
  expect(await call("timekeeper_status")).toMatchObject({
    timekeeper: "running",
    activeSession: { id: "demo-2026-10-16" },
  });
  expect(await call("start_session")).toMatchObject({
    status: "already_active",
    session: { id: "demo-2026-10-16" },
    isError: false,
  });
});

it("ends the active session once, then starts a new one through the command routes", async () => {
  const { call } = setup();
  const ended = await call("end_session");
  expect(ended).toMatchObject({
    status: "ended",
    session: { id: "demo-2026-10-16" },
    isError: false,
  });
  expect((ended.session as { endedAt: string }).endedAt).toBeTruthy();
  expect(await call("end_session")).toMatchObject({ status: "no_active_session", isError: true });
  const started = await call("start_session");
  expect(started).toMatchObject({ status: "started", session: { id: "session-test-2" } });
  expect(await call("start_session")).toMatchObject({
    status: "already_active",
    session: { id: "session-test-2" },
  });
});

it("lists active cases, periods and pending questions, and answers a question once", async () => {
  const { call } = setup();
  const cases = (await call("list_cases")).cases as Array<Record<string, string>>;
  expect(cases).toContainEqual(
    expect.objectContaining({ id: "1", title: "Dawson v Martin", clientName: "Paul Dawson" }),
  );
  const periods = (await call("list_work_periods")).periods as Array<{ startedAt: string }>;
  expect(periods.length).toBeGreaterThan(0);
  expect(periods.map((p) => p.startedAt)).toEqual([...periods.map((p) => p.startedAt)].sort());
  const questions = (await call("list_questions")).questions as Array<{ questionId: string }>;
  expect(questions).toContainEqual(expect.objectContaining({ questionId: "demo-question-13" }));

  const answered = await call("answer_question", { questionId: "demo-question-13", caseId: "5" });
  expect(answered).toMatchObject({ status: "answered", period: { id: "13", caseId: "5" } });
  expect(
    await call("answer_question", { questionId: "demo-question-13", caseId: "2" }),
  ).toMatchObject({
    status: "error",
    isError: true,
  });
  expect(await call("answer_question", { questionId: "demo-question-13" })).toMatchObject({
    status: "error",
    error: "invalid-request",
  });
});

it("reports a closed TimeKeeper instead of claiming success", async () => {
  const closed = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const { call } = setup({ fetch: closed });
  expect(await call("timekeeper_status")).toMatchObject({ timekeeper: "not_running" });
  expect(await call("start_session")).toMatchObject({
    status: "timekeeper_not_running",
    isError: true,
  });
  expect(await call("end_session")).toMatchObject({ status: "timekeeper_not_running" });
  expect(await call("list_cases")).toMatchObject({ status: "timekeeper_not_running" });
});
