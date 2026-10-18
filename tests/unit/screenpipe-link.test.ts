import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initialLinkState,
  LINK_PRODUCER_ID,
  linkStatus,
  loadLinkState,
  linkTick,
  readScreenpipe,
  saveLinkState,
  type LinkDeps,
  type LinkState,
  type ScreenpipeState,
} from "../../src/mcp/screenpipe-link.js";
import type { SessionDeps } from "../../src/mcp/session.js";

type Session = { id: string; startedAt: string; endedAt: string | null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** In-memory application API: one active session, idempotent start, end at the requested boundary. */
function harness(options: { active?: Session | null; openPeriodStart?: string } = {}) {
  const api = {
    up: true,
    active: options.active ?? (null as Session | null),
    starts: [] as Record<string, unknown>[],
    ends: [] as Record<string, unknown>[],
    n: 0,
  };
  let clock = Date.parse("2026-10-18T08:00:00.000Z");
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (!api.up) throw new TypeError("fetch failed: connection refused");
    const path = url.replace("http://tk/api", "");
    if (path === "/health") return json({ status: "ok" });
    if (path === "/sessions/active") return json(api.active);
    if (path.startsWith("/work-periods")) {
      return json(
        api.active && options.openPeriodStart
          ? [
              {
                id: "p1",
                sessionId: api.active.id,
                caseId: null,
                startedAt: options.openPeriodStart,
                endedAt: null,
              },
            ]
          : [],
      );
    }
    if (path === "/commands/start" && init?.method === "POST") {
      const c = JSON.parse(String(init.body));
      api.starts.push(c);
      api.active ??= { id: c.sessionId, startedAt: c.occurredAt, endedAt: null };
      return json({
        status: "applied",
        sessionId: api.active.id,
        startedAt: api.active.startedAt,
        endedAt: null,
      });
    }
    if (path === "/commands/end" && init?.method === "POST") {
      const c = JSON.parse(String(init.body));
      api.ends.push(c);
      const ended = { ...api.active!, endedAt: c.occurredAt };
      api.active = null;
      return json({
        status: "applied",
        sessionId: ended.id,
        startedAt: ended.startedAt,
        endedAt: ended.endedAt,
      });
    }
    return json({ error: "not-found" }, 404);
  }) as typeof fetch;
  const session: SessionDeps = {
    apiBase: "http://tk/api",
    fetch: fetchImpl,
    now: () => new Date(clock),
    newId: () => `2026-10-18-${String(++api.n).padStart(8, "0")}`,
    sleep: async () => {},
    readyTimeoutMs: 0,
  };
  let screenpipe: ScreenpipeState = { running: false };
  const deps: LinkDeps = {
    session,
    readScreenpipe: async () => screenpipe,
    graceMs: 60_000,
    log: () => {},
  };
  const at = (iso: string) => {
    clock = Date.parse(iso);
  };
  const run = (engineStartedAt: string) => {
    screenpipe = { running: true, engineStartedAt };
  };
  const stop = () => {
    screenpipe = { running: false };
  };
  return { api, deps, at, run, stop };
}

const ENGINE_1 = "2026-10-18T07:59:00.000Z";

describe("Screenpipe session link", () => {
  it("starts a session when Screenpipe starts, once per Screenpipe run", async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    expect(h.api.starts).toHaveLength(1);
    expect(h.api.starts[0]).toMatchObject({
      producerId: LINK_PRODUCER_ID,
      occurredAt: "2026-10-18T08:00:00.000Z",
    });
    expect(s).toMatchObject({
      started: true,
      engineStartedAt: ENGINE_1,
      lastRunningAt: "2026-10-18T08:00:00.000Z",
    });

    // The lawyer ends the session with the End button while Screenpipe keeps recording: no new session.
    h.api.active = null;
    h.at("2026-10-18T09:00:00.000Z");
    s = await linkTick(h.deps, s);
    expect(h.api.starts).toHaveLength(1);
  });

  it("leaves an active session unchanged when Screenpipe starts", async () => {
    const active = { id: "session-kept", startedAt: "2026-10-18T07:00:00.000Z", endedAt: null };
    const h = harness({ active });
    h.run(ENGINE_1);
    const s = await linkTick(h.deps, initialLinkState());
    expect(h.api.starts).toHaveLength(0);
    expect(h.api.active).toEqual(active);
    expect(s.started).toBe(true);
  });

  it("ends the session at the last time Screenpipe was running, only after the grace period", async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    h.at("2026-10-18T12:00:00.000Z");
    s = await linkTick(h.deps, s);

    h.stop();
    h.at("2026-10-18T12:00:30.000Z");
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(0);

    h.at("2026-10-18T12:01:10.000Z");
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toEqual([
      expect.objectContaining({
        producerId: LINK_PRODUCER_ID,
        occurredAt: "2026-10-18T12:00:00.000Z",
      }),
    ]);
    expect(s).toMatchObject({ ended: true, started: false });

    h.at("2026-10-18T12:05:00.000Z");
    await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(1);
  });

  it("keeps the session through a short Screenpipe restart", async () => {
    const h = harness();
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    h.stop();
    h.at("2026-10-18T08:00:30.000Z");
    s = await linkTick(h.deps, s);
    h.run("2026-10-18T08:00:40.000Z");
    h.at("2026-10-18T08:00:50.000Z");
    s = await linkTick(h.deps, s);
    expect(h.api.ends).toHaveLength(0);
    expect(h.api.starts).toHaveLength(1);
    expect(s).toMatchObject({ started: true, engineStartedAt: "2026-10-18T08:00:40.000Z" });
  });

  it("after a stop it did not see (reboot), ends the old session at its last time and starts a new one", async () => {
    const active = {
      id: "session-yesterday",
      startedAt: "2026-10-17T08:00:00.000Z",
      endedAt: null,
    };
    const h = harness({ active });
    const saved: LinkState = {
      engineStartedAt: "2026-10-17T07:59:00.000Z",
      started: true,
      lastRunningAt: "2026-10-17T18:30:00.000Z",
      ended: false,
    };
    h.run(ENGINE_1);
    const s = await linkTick(h.deps, saved);
    expect(h.api.ends).toEqual([
      expect.objectContaining({
        sessionId: "session-yesterday",
        occurredAt: "2026-10-17T18:30:00.000Z",
      }),
    ]);
    expect(h.api.starts).toHaveLength(1);
    expect(s).toMatchObject({ started: true, engineStartedAt: ENGINE_1 });
  });

  it("never ends a session that started after Screenpipe was last seen", async () => {
    const active = {
      id: "session-from-button",
      startedAt: "2026-10-18T12:05:00.000Z",
      endedAt: null,
    };
    const h = harness({ active });
    const saved: LinkState = {
      engineStartedAt: ENGINE_1,
      started: true,
      lastRunningAt: "2026-10-18T12:00:00.000Z",
      ended: false,
    };
    h.at("2026-10-18T12:10:00.000Z");
    const s = await linkTick(h.deps, saved);
    expect(h.api.ends).toHaveLength(0);
    expect(h.api.active).toEqual(active);
    expect(s.ended).toBe(true);
  });

  it("does not end before the open work period, which the API would refuse", async () => {
    const active = { id: "session-1", startedAt: "2026-10-18T08:00:00.000Z", endedAt: null };
    const h = harness({ active, openPeriodStart: "2026-10-18T12:00:05.000Z" });
    const saved: LinkState = {
      engineStartedAt: ENGINE_1,
      started: true,
      lastRunningAt: "2026-10-18T12:00:00.000Z",
      ended: false,
    };
    h.at("2026-10-18T12:10:00.000Z");
    await linkTick(h.deps, saved);
    expect(h.api.ends[0].occurredAt).toBe("2026-10-18T12:00:05.000Z");
  });

  it("retries start and end while TimeKeeper is closed, keeping the end boundary", async () => {
    const h = harness();
    h.api.up = false;
    h.run(ENGINE_1);
    let s = await linkTick(h.deps, initialLinkState());
    expect(s.started).toBe(false);
    h.api.up = true;
    h.at("2026-10-18T08:00:10.000Z");
    s = await linkTick(h.deps, s);
    expect(s.started).toBe(true);

    h.stop();
    h.api.up = false;
    h.at("2026-10-18T09:00:00.000Z");
    s = await linkTick(h.deps, s);
    expect(s.ended).toBe(false);
    h.api.up = true;
    h.at("2026-10-18T09:30:00.000Z");
    s = await linkTick(h.deps, s);
    expect(h.api.ends[0].occurredAt).toBe("2026-10-18T08:00:10.000Z");
    expect(s.ended).toBe(true);
  });
});

describe("linkStatus", () => {
  it("reports the link as running only while it keeps writing its state", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-link-"));
    try {
      const path = join(dir, "screenpipe-link.json");
      expect(linkStatus(path, new Date())).toMatchObject({
        running: false,
        lastCheckAt: null,
        screenpipeLastSeenRunningAt: null,
      });
      saveLinkState(path, {
        engineStartedAt: ENGINE_1,
        started: true,
        lastRunningAt: "2026-10-18T08:00:00.000Z",
        ended: false,
      });
      expect(linkStatus(path, new Date())).toMatchObject({
        running: true,
        screenpipeLastSeenRunningAt: "2026-10-18T08:00:00.000Z",
        sessionStartDelivered: true,
        sessionEndDelivered: false,
      });
      expect(linkStatus(path, new Date(Date.now() + 60_000)).running).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readScreenpipe", () => {
  const at = (body: unknown, status = 200) =>
    (async () => json(body, status)) as unknown as typeof fetch;
  it("treats a reachable engine as running unless capture is stopped", async () => {
    expect(
      await readScreenpipe(
        "http://sp",
        at({ capture_status: { status: "recording" }, startup: { engine_started_at: 1792311134 } }),
      ),
    ).toEqual({ running: true, engineStartedAt: new Date(1792311134 * 1000).toISOString() });
    expect(await readScreenpipe("http://sp", at({ capture_status: { status: "paused" } }))).toEqual(
      { running: true, engineStartedAt: null },
    );
    expect(
      await readScreenpipe(
        "http://sp",
        at({ capture_status: { status: "recording" }, startup: { engine_started_at: 1e20 } }),
      ),
    ).toEqual({ running: true, engineStartedAt: null });
    expect(await readScreenpipe("http://sp", at({ status: "unhealthy" }, 503))).toEqual({
      running: true,
      engineStartedAt: null,
    });
    expect(
      await readScreenpipe("http://sp", at({ capture_status: { status: "stopped" } })),
    ).toEqual({ running: false });
    const refused = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await readScreenpipe("http://sp", refused)).toEqual({ running: false });
  });
});

it("retains the command identity and original time after an uncertain start delivery", async () => {
  const h = harness();
  const fetcher = h.deps.session.fetch;
  const attempts: Record<string, unknown>[] = [];
  let loseFirst = true;
  h.deps.session.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/commands/start")) {
      attempts.push(JSON.parse(String(init?.body)));
      if (loseFirst) {
        loseFirst = false;
        throw new TypeError("Connection reset");
      }
    }
    return fetcher(url, init);
  }) as typeof fetch;
  h.run(ENGINE_1);
  let state = await linkTick(h.deps, initialLinkState());
  expect(state.started).toBe(false);
  h.at("2026-10-18T08:01:00Z");
  state = await linkTick(h.deps, state);
  expect(state.started).toBe(true);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1]?.occurredAt).toBe("2026-10-18T08:00:00.000Z");
});

it("retains an uncertain end target and boundary when capture resumes before its confirmation", async () => {
  const h = harness();
  h.run(ENGINE_1);
  let state = await linkTick(h.deps, initialLinkState());
  const originalSessionId = state.sessionId;
  const fetcher = h.deps.session.fetch;
  const attempts: Record<string, unknown>[] = [];
  let loseFirst = true;
  h.deps.session.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/commands/end")) {
      attempts.push(JSON.parse(String(init?.body)));
      if (loseFirst) {
        loseFirst = false;
        throw new TypeError("Connection reset");
      }
    }
    return fetcher(url, init);
  }) as typeof fetch;
  h.stop();
  h.at("2026-10-18T08:01:00Z");
  state = await linkTick(h.deps, state);
  expect(state.ended).toBe(false);
  h.run(ENGINE_1);
  h.at("2026-10-18T08:02:00Z");
  state = await linkTick(h.deps, state);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1]).toMatchObject({
    sessionId: originalSessionId,
    occurredAt: "2026-10-18T08:00:00.000Z",
  });
  expect(state.started).toBe(true);
  expect(state.sessionId).not.toBe(originalSessionId);
  expect(h.api.active?.id).toBe(state.sessionId);
});

it("freezes the effective end payload before delivery even if a later work period appears during a retry", async () => {
  const source = { openPeriodStart: "2026-10-18T08:00:05.000Z" };
  const h = harness(source);
  h.run(ENGINE_1);
  let state = await linkTick(h.deps, initialLinkState());
  const fetcher = h.deps.session.fetch;
  const attempts: Record<string, unknown>[] = [];
  h.deps.session.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/commands/end")) {
      attempts.push(JSON.parse(String(init?.body)));
      throw new TypeError("Connection reset");
    }
    return fetcher(url, init);
  }) as typeof fetch;
  h.stop();
  h.at("2026-10-18T08:01:00Z");
  state = await linkTick(h.deps, state);
  expect(state.endAttempt).toMatchObject({
    occurredAt: source.openPeriodStart,
    sessionId: state.sessionId,
    boundaryPrepared: true,
  });
  source.openPeriodStart = "2026-10-18T08:01:05.000Z";
  h.at("2026-10-18T08:02:00Z");
  await linkTick(h.deps, state);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.occurredAt).toBe("2026-10-18T08:00:05.000Z");
  expect(attempts[1]).toEqual(attempts[0]);
});

it("ignores malformed provider health instead of ending a recording session", async () => {
  expect(
    await readScreenpipe("http://sp", (async () => json({ unrelated: true })) as typeof fetch),
  ).toEqual({ running: null });
  const h = harness();
  h.run(ENGINE_1);
  const before = await linkTick(h.deps, initialLinkState());
  h.at("2026-10-18T09:00:00Z");
  h.deps.readScreenpipe = async () => ({ running: null });
  expect(await linkTick(h.deps, before)).toEqual(before);
  expect(h.api.ends).toHaveLength(0);
});

describe("link state recovery", () => {
  const withStatePath = (run: (path: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "tk-link-recovery-"));
    try {
      run(join(dir, "state.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("starts fresh only when neither state copy exists", () => {
    withStatePath((path) => expect(loadLinkState(path)).toEqual(initialLinkState()));
  });

  it("loads the original state format without losing retry identities", () => {
    withStatePath((path) => {
      const state: LinkState = {
        ...initialLinkState(),
        sessionId: "original-session",
        lastRunningAt: "2026-10-18T08:00:00.000Z",
        endAttempt: {
          commandId: "original-command",
          occurredAt: "2026-10-18T08:00:05.000Z",
          sessionId: "original-session",
          boundaryPrepared: true,
        },
      };
      writeFileSync(path, JSON.stringify(state));
      expect(loadLinkState(path)).toEqual(state);
      saveLinkState(path, state);
      writeFileSync(path, '{"truncated":');
      expect(loadLinkState(path)).toEqual(state);
    });
  });

  it("recovers an interrupted replacement from the newer complete backup", () => {
    withStatePath((path) => {
      const previous = initialLinkState();
      saveLinkState(path, previous);
      const oldPrimary = readFileSync(path, "utf8");
      const prepared = { ...previous, startAttempt: { id: "stable-start", occurredAt: ENGINE_1 } };
      saveLinkState(path, prepared);
      // A crash after replacing the backup but before replacing the primary.
      writeFileSync(path, oldPrimary);
      expect(loadLinkState(path)).toEqual(prepared);
      rmSync(path);
      expect(loadLinkState(path)).toEqual(prepared);
    });
  });

  it("refuses corrupt existing state without exposing its contents or overwriting it", () => {
    withStatePath((path) => {
      const secret = "private-recording-metadata";
      writeFileSync(path, secret);
      expect(() => loadLinkState(path)).toThrow("Screenpipe link state cannot be recovered");
      expect(() => loadLinkState(path)).not.toThrow(secret);
      expect(() => saveLinkState(path, initialLinkState())).toThrow("cannot be recovered");
      expect(readFileSync(path, "utf8")).toBe(secret);
    });
  });

  it("rejects syntactically valid state with unusable boundaries", () => {
    withStatePath((path) => {
      writeFileSync(path, JSON.stringify({ ...initialLinkState(), lastRunningAt: "invalid" }));
      expect(() => loadLinkState(path)).toThrow("cannot be recovered");
    });
  });
});

it("persists prepared start and end intents before sending their commands", async () => {
  const h = harness({ openPeriodStart: "2026-10-18T08:00:05.000Z" });
  let durable: LinkState | undefined;
  h.deps.persistState = (state) => {
    durable = structuredClone(state);
  };
  const fetcher = h.deps.session.fetch;
  h.deps.session.fetch = (async (url: string, init?: RequestInit) => {
    const command = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.endsWith("/commands/start")) {
      expect(`start-${durable?.startAttempt?.id}`).toBe(command.commandId);
      expect(durable?.startAttempt?.occurredAt).toBe(command.occurredAt);
    }
    if (url.endsWith("/commands/end")) {
      expect(durable?.endAttempt).toMatchObject({
        commandId: command.commandId,
        sessionId: command.sessionId,
        occurredAt: command.occurredAt,
        boundaryPrepared: true,
      });
    }
    return fetcher(url, init);
  }) as typeof fetch;
  h.run(ENGINE_1);
  const state = await linkTick(h.deps, initialLinkState());
  h.stop();
  h.at("2026-10-18T08:01:00Z");
  await linkTick(h.deps, state);
  expect(h.api.starts).toHaveLength(1);
  expect(h.api.ends).toHaveLength(1);
});

it("does not send a command when its prepared intent cannot be persisted", async () => {
  const h = harness();
  h.deps.persistState = () => {
    throw new Error("State storage unavailable");
  };
  h.run(ENGINE_1);
  await expect(linkTick(h.deps, initialLinkState())).rejects.toThrow("State storage unavailable");
  expect(h.api.starts).toHaveLength(0);
});

it("replays the exact persisted end after restart and protects a replacement session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-link-restart-"));
  const path = join(dir, "state.json");
  try {
    const h = harness({ openPeriodStart: "2026-10-18T08:00:05.000Z" });
    h.deps.persistState = (state) => saveLinkState(path, state);
    h.run(ENGINE_1);
    const started = await linkTick(h.deps, initialLinkState());
    const fetcher = h.deps.session.fetch;
    const attempts: unknown[] = [];
    h.deps.session.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/commands/end")) {
        attempts.push(JSON.parse(String(init?.body)));
        throw new TypeError("Connection reset");
      }
      return fetcher(url, init);
    }) as typeof fetch;
    h.stop();
    h.at("2026-10-18T08:01:00Z");
    await linkTick(h.deps, started);
    writeFileSync(path, "{");
    const recovered = loadLinkState(path);
    h.at("2026-10-18T09:00:00Z");
    await linkTick(h.deps, recovered);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    h.api.active = { id: "newer-session", startedAt: "2026-10-18T08:30:00Z", endedAt: null };
    const completed = await linkTick(h.deps, loadLinkState(path));
    expect(completed.ended).toBe(true);
    expect(h.api.active.id).toBe("newer-session");
    expect(attempts).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
