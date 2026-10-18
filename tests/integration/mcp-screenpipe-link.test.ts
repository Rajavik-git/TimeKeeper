import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import {
  initialLinkState,
  linkTick,
  loadLinkState,
  readScreenpipe,
  type LinkDeps,
  type ScreenpipeState,
} from "../../src/mcp/screenpipe-link.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** A link against Michel's real API, with a controllable clock and Screenpipe state. */
function setup() {
  const db = memoryDb();
  databases.push(db);
  const app = createApp(db);
  let now = Date.parse("2026-10-18T09:00:00Z");
  let screenpipe: ScreenpipeState = { running: true, engineStartedAt: "2026-10-18T08:59:00.000Z" };
  let next = 0;
  const logs: string[] = [];
  const deps: LinkDeps = {
    session: {
      apiOrigin: "http://127.0.0.1:8787",
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        app.request(String(input), init)) as typeof fetch,
      now: () => new Date(now),
      newId: () => `link-${++next}`,
      sleep: async () => undefined,
    },
    readScreenpipe: async () => screenpipe,
    graceMs: 60_000,
    log: (message) => logs.push(message),
  };
  const active = async () =>
    (await (await app.request("/api/sessions/active")).json()) as {
      id: string;
      endedAt: string | null;
    } | null;
  return {
    deps,
    active,
    logs,
    advance: (ms: number) => (now += ms),
    setScreenpipe: (state: ScreenpipeState) => (screenpipe = state),
  };
}

it("ends the session at the last running time once Screenpipe stays stopped past the grace period", async () => {
  const link = setup();
  let state = await linkTick(link.deps, initialLinkState());
  expect(state).toMatchObject({
    started: true,
    ended: false,
    lastRunningAt: "2026-10-18T09:00:00.000Z",
  });
  expect((await link.active())?.id).toBe("demo-2026-10-16");

  link.setScreenpipe({ running: false });
  link.advance(30_000);
  state = await linkTick(link.deps, state);
  expect(state.ended).toBe(false);
  expect(await link.active()).not.toBeNull();

  link.advance(31_000);
  state = await linkTick(link.deps, state);
  expect(state).toMatchObject({ ended: true, started: false });
  expect(await link.active()).toBeNull();
  const sessions = (await (
    await link.deps.session.fetch("http://127.0.0.1:8787/api/sessions/demo-2026-10-16")
  ).json()) as { endedAt: string };
  expect(sessions.endedAt).toBe("2026-10-18T09:00:00.000Z");
});

it("starts a new session when Screenpipe starts a new run after a stop", async () => {
  const link = setup();
  let state = await linkTick(link.deps, initialLinkState());
  link.setScreenpipe({ running: false });
  link.advance(120_000);
  state = await linkTick(link.deps, state);
  expect(await link.active()).toBeNull();

  link.setScreenpipe({ running: true, engineStartedAt: "2026-10-18T09:05:00.000Z" });
  link.advance(5_000);
  state = await linkTick(link.deps, state);
  expect(state).toMatchObject({ started: true, engineStartedAt: "2026-10-18T09:05:00.000Z" });
  const started = (await link.active())?.id;
  expect(started).toMatch(/^session-link-/);

  // A further tick of the same run does not start again.
  state = await linkTick(link.deps, state);
  expect((await link.active())?.id).toBe(started);
  expect(link.logs.filter((line) => line.includes("start_session -> started"))).toHaveLength(1);
});

it("keeps the session through a restart shorter than the grace period", async () => {
  const link = setup();
  let state = await linkTick(link.deps, initialLinkState());
  link.setScreenpipe({ running: false });
  link.advance(20_000);
  state = await linkTick(link.deps, state);
  link.setScreenpipe({ running: true, engineStartedAt: "2026-10-18T09:00:25.000Z" });
  link.advance(10_000);
  state = await linkTick(link.deps, state);
  expect(state).toMatchObject({ started: true, ended: false });
  expect((await link.active())?.id).toBe("demo-2026-10-16");
});

it("reads Screenpipe health without credentials", async () => {
  const fake = (body: unknown) =>
    (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
  expect(
    await readScreenpipe("http://sp", fake({ startup: { engine_started_at: 1_760_000_000 } })),
  ).toEqual({
    running: true,
    engineStartedAt: new Date(1_760_000_000_000).toISOString(),
  });
  expect(
    await readScreenpipe("http://sp", fake({ capture_status: { status: "stopped" } })),
  ).toEqual({
    running: false,
  });
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  expect(await readScreenpipe("http://sp", offline)).toEqual({ running: false });
});

it("treats a failing Screenpipe health answer as stopped", async () => {
  const failing = (async () =>
    new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
  expect(await readScreenpipe("http://sp", failing)).toEqual({ running: false });
});

it("starts over from a malformed link state file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-link-"));
  try {
    const path = join(dir, "link.json");
    writeFileSync(path, JSON.stringify({ started: "yes", lastRunningAt: 42 }));
    expect(loadLinkState(path)).toEqual(initialLinkState());
    writeFileSync(path, "not json");
    expect(loadLinkState(path)).toEqual(initialLinkState());
    const valid = {
      engineStartedAt: null,
      started: true,
      lastRunningAt: "2026-10-18T09:00:00.000Z",
      ended: false,
    };
    writeFileSync(path, JSON.stringify({ ...valid, extra: 1 }));
    expect(loadLinkState(path)).toEqual(valid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
