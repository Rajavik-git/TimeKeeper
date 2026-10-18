import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireWatchLock,
  releaseWatchLock,
  runningWatcher,
  sessionState,
} from "../../integrations/screenpipe/jev-check/session-bound.js";
import {
  parseWatchLog,
  startTabDetection,
  tabDetectionStatus,
} from "../../src/mcp/tab-detection.js";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "tk-tab-"));
  dirs.push(d);
  return d;
};
// Windows keeps a folder busy briefly while a process started in it exits.
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deadPid = 2 ** 22 - 3; // far above typical PID ranges

describe("watch lock", () => {
  it("allows one watcher, ignores stale locks, and releases only its own lock", () => {
    const lock = join(tempDir(), ".watch.pid");
    expect(runningWatcher(lock)).toBeNull();
    expect(acquireWatchLock(lock)).toEqual({ ok: true });
    expect(runningWatcher(lock)).toBe(process.pid);
    expect(acquireWatchLock(lock, process.pid + 1)).toEqual({ ok: false, pid: process.pid });
    releaseWatchLock(lock, process.pid + 1);
    expect(runningWatcher(lock)).toBe(process.pid);
    releaseWatchLock(lock);
    expect(runningWatcher(lock)).toBeNull();
    writeFileSync(lock, String(deadPid));
    expect(runningWatcher(lock)).toBeNull();
    expect(acquireWatchLock(lock)).toEqual({ ok: true });
  });

  it.each([false, true])(
    "allows only one process to acquire the watcher lock concurrently, stale owner = %s",
    async (staleOwner) => {
      const dir = tempDir();
      const lock = join(dir, ".watch.pid");
      if (staleOwner) writeFileSync(lock, String(deadPid));
      const start = join(dir, "start");
      const release = join(dir, "release");
      const workerPath = join(dir, "lock-worker.mjs");
      const moduleUrl = new URL(
        "../../integrations/screenpipe/jev-check/session-bound.ts",
        import.meta.url,
      ).href;
      writeFileSync(
        workerPath,
        `import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireWatchLock, releaseWatchLock } from ${JSON.stringify(moduleUrl)};
const [lock, start, release] = process.argv.slice(2);
async function waitFor(path) {
  const deadline = Date.now() + 10000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("Test coordination timed out");
    await sleep(10);
  }
}
console.log("ready");
await waitFor(start);
const result = acquireWatchLock(lock);
console.log(JSON.stringify({ ...result, workerPid: process.pid }));
try { await waitFor(release); } finally { if (result.ok) releaseWatchLock(lock); }
`,
      );
      const workers = Array.from({ length: 3 }, () => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", workerPath, lock, start, release],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let readyResolve: () => void;
        let resultResolve: (value: { ok: boolean; pid?: number; workerPid: number }) => void;
        const ready = new Promise<void>((resolve) => {
          readyResolve = resolve;
        });
        const result = new Promise<{ ok: boolean; pid?: number; workerPid: number }>((resolve) => {
          resultResolve = resolve;
        });
        let output = "";
        child.stdout!.on("data", (chunk) => {
          output += String(chunk);
          for (;;) {
            const newline = output.indexOf("\n");
            if (newline < 0) break;
            const line = output.slice(0, newline);
            output = output.slice(newline + 1);
            if (line === "ready") readyResolve();
            else resultResolve(JSON.parse(line));
          }
        });
        const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
        return { child, ready, result, exited };
      });
      try {
        await Promise.all(workers.map((worker) => worker.ready));
        writeFileSync(start, "go");
        const results = await Promise.all(workers.map((worker) => worker.result));
        const winners = results.filter((result) => result.ok);
        expect(winners).toHaveLength(1);
        expect(runningWatcher(lock)).toBe(winners[0]!.workerPid);
        for (const result of results.filter((result) => !result.ok))
          if (result.pid !== null) expect(result.pid).toBe(winners[0]!.workerPid);
      } finally {
        writeFileSync(release, "go");
        expect(await Promise.all(workers.map((worker) => worker.exited))).toEqual([0, 0, 0]);
      }
      expect(runningWatcher(lock)).toBeNull();
    },
    20_000,
  );

  it("recovers after the owner dies during a transaction and ignores abandoned recovery directories", async () => {
    const dir = tempDir();
    const lock = join(dir, ".watch.pid");
    mkdirSync(`${lock}.recovery`);
    const moduleUrl = new URL(
      "../../integrations/screenpipe/jev-check/watch-lock.ts",
      import.meta.url,
    ).href;
    const workerPath = join(dir, "crash-worker.mjs");
    writeFileSync(
      workerPath,
      `import { DatabaseSync } from "node:sqlite";
import { acquireWatchLock } from ${JSON.stringify(moduleUrl)};
const lock = process.argv[2];
if (!acquireWatchLock(lock).ok) process.exit(1);
const db = new DatabaseSync(lock + ".sqlite");
db.exec("BEGIN IMMEDIATE");
db.exec("UPDATE watcher_owner SET token = 'uncommitted-crash-test' WHERE id = 1");
console.log("locked");
setInterval(() => {}, 1000);
`,
    );
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, lock], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.stdout!.once("data", () => resolve());
        child.once("close", () => reject(new Error("Lock worker exited before acquisition")));
      });
      expect(runningWatcher(lock)).toBe(child.pid);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
    expect(runningWatcher(lock)).toBeNull();
    expect(acquireWatchLock(lock)).toEqual({ ok: true });
    expect(runningWatcher(lock)).toBe(process.pid);
    releaseWatchLock(lock);
    expect(runningWatcher(lock)).toBeNull();
  }, 20_000);
});

describe("session state for the watcher", () => {
  it("distinguishes active, ended, and unreachable (closed TimeKeeper keeps the session)", async () => {
    const at = (body: unknown, status = 200) =>
      (async () => json(body, status)) as unknown as typeof fetch;
    expect(
      await sessionState("http://tk/api", at({ id: "s1", startedAt: "x", endedAt: null })),
    ).toEqual({ state: "active", sessionId: "s1" });
    expect(await sessionState("http://tk/api", at(null))).toEqual({ state: "ended" });
    expect(await sessionState("http://tk/api", at({ error: "internal" }, 500))).toEqual({
      state: "unreachable",
    });
    const refused = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await sessionState("http://tk/api", refused)).toEqual({ state: "unreachable" });
  });
});

describe("tab detection status", () => {
  const LOG = [
    "[2026-10-18T08:46:48.655Z] Watching Screenpipe focus events. Stability delay: 10s.",
    "  update: window_focus Notepad.exe | Letter.txt -> timer reset",
    "[2026-10-18T08:47:28.848Z] stable for 10s -> checking",
    "",
    "[2026-10-18T08:47:28.872Z] status=checked",
    "  detection:  focus_change",
    "  previous:   Code.exe | Editor (2026-10-18T10:47:05+02:00)",
    "  current:    Notepad.exe | 2026-009-DAWSON letter.txt (2026-10-18T10:47:19+02:00)",
    "  tab change: YES | yes=1.00 no=0.00 uncertain=0.00 | confidence=1.00 | jev-1.13.0",
    "  proposal:   2026-009-DAWSON - Commercial lease (case 2, client 1) p=0.93 confidence=0.92",
    "  still current: true -> display proposal: true",
    "  timekeeper: record_case_transition -> applied period auto-x case 2",
    "[2026-10-18T08:38:51.597Z] status=insufficient_data error=missing observation",
    "[2026-10-18T08:48:22.524Z] TimeKeeper session ended: tab detection stopped.",
  ].join("\n");

  it("parses the latest checks and the last event from watch.log", () => {
    const { lastEvent, checks } = parseWatchLog(LOG);
    expect(lastEvent).toBe("2026-10-18T08:48:22.524Z session-ended");
    expect(checks).toEqual([
      {
        checkedAt: "2026-10-18T08:47:28.872Z",
        status: "checked",
        previous: "[redacted]",
        current: "[redacted]",
        tabChange: "[redacted]",
        proposal: "[redacted]",
        timekeeper: "[redacted]",
      },
      {
        checkedAt: "2026-10-18T08:38:51.597Z",
        status: "insufficient_data",
      },
    ]);
    expect(parseWatchLog(LOG, 1).checks).toHaveLength(1);
  });

  it("reports whether the watcher runs and reads only the log end", () => {
    const dir = tempDir();
    expect(tabDetectionStatus({ dir })).toEqual({
      running: false,
      pid: null,
      log: join(dir, "watch.log"),
      lastEvent: null,
      recentChecks: [],
    });
    writeFileSync(join(dir, "watch.log"), "x".repeat(300_000) + "\n" + LOG);
    writeFileSync(join(dir, ".watch.pid"), String(process.pid));
    const s = tabDetectionStatus({ dir });
    expect(s).toMatchObject({ running: true, pid: process.pid });
    expect(s.recentChecks).toHaveLength(2);
  });
});

describe("startTabDetection", () => {
  const opts = (dir: string) => ({
    enabled: true,
    node: process.execPath,
    apiBase: "http://tk/api",
    dir,
    environment: {},
    startupTimeoutMs: 3000,
  });

  it("is skipped when disabled", async () => {
    expect(await startTabDetection({ ...opts(tempDir()), enabled: false })).toEqual({
      status: "disabled",
    });
  });

  it("reports missing JEV configuration instead of starting a watcher that would fail", async () => {
    const saved = { key: process.env.TYPESAFE_API_KEY, fields: process.env.JEV_ALLOWED_FIELDS };
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_ALLOWED_FIELDS;
    try {
      const dir = tempDir();
      expect(await startTabDetection(opts(dir))).toMatchObject({ status: "not_configured" });
      writeFileSync(join(dir, ".env"), "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=\n");
      expect(await startTabDetection(opts(dir))).toMatchObject({ status: "not_configured" });
    } finally {
      if (saved.key !== undefined) process.env.TYPESAFE_API_KEY = saved.key;
      if (saved.fields !== undefined) process.env.JEV_ALLOWED_FIELDS = saved.fields;
    }
  });

  it("does not start a second watcher", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".watch.pid"), String(process.pid));
    expect(await startTabDetection(opts(dir))).toEqual({
      status: "already_running",
      pid: process.pid,
    });
  });

  it("starts the watcher in the background with the session flag and API address", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".env"),
      "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n",
    );
    // Stand-in publishes readiness only after its simulated initialization.
    writeFileSync(
      join(dir, "jev-check.js"),
      `const fs = require('node:fs');
fs.writeFileSync('started.json', JSON.stringify({ args: process.argv.slice(2), api: process.env.TIMEKEEPER_API_URL }));
fs.writeFileSync('.watch.pid', String(process.pid));
setTimeout(() => fs.unlinkSync('.watch.pid'), 600);\n`,
    );
    const r = await startTabDetection(opts(dir));
    expect(r).toMatchObject({ status: "started", log: join(dir, "watch.log") });
    let started: Record<string, unknown> = null;
    // Process start can take several seconds while the whole suite runs in parallel.
    for (let i = 0; i < 400 && !started; i++) {
      try {
        started = JSON.parse(readFileSync(join(dir, "started.json"), "utf8"));
      } catch {
        await new Promise((res) => setTimeout(res, 50));
      }
    }
    expect(started).toEqual({
      args: ["--session-bound", "--api", "http://tk/api"],
      api: "http://tk/api",
    });
    // Let the background process exit so the temporary folder can be removed.
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && alive((r as Record<string, unknown>).pid); i++)
      await new Promise((res) => setTimeout(res, 100));
  }, 30_000);

  it("reports failure when the spawned process exits before publishing readiness", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".env"),
      "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n",
    );
    writeFileSync(join(dir, "jev-check.js"), "process.exit(2);\n");
    expect(await startTabDetection(opts(dir))).toMatchObject({ status: "failed" });
    expect(tabDetectionStatus({ dir }).running).toBe(false);
  });

  it("times out an unready process instead of reporting it as started", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".env"),
      "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n",
    );
    writeFileSync(join(dir, "jev-check.js"), "setInterval(() => {}, 1000);\n");
    expect(await startTabDetection({ ...opts(dir), startupTimeoutMs: 150 })).toMatchObject({
      status: "failed",
    });
  });

  it("preserves an explicitly empty inherited field selection instead of using a broader local one", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".env"), "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.text\n");
    expect(
      await startTabDetection({ ...opts(dir), environment: { JEV_ALLOWED_FIELDS: "" } }),
    ).toMatchObject({ status: "not_configured" });
  });

  it("rejects invalid numeric configuration before spawning", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".env"),
      "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\nSTABILITY_SECONDS=-1\n",
    );
    expect(await startTabDetection(opts(dir))).toMatchObject({ status: "not_configured" });
  });

  it.skipIf(process.platform !== "win32")(
    "on Windows, starts the watcher through WMI with the API address as an argument",
    async () => {
      const dir = tempDir();
      writeFileSync(
        join(dir, ".env"),
        "TYPESAFE_API_KEY=k\nJEV_ALLOWED_FIELDS=observation.window_title\n",
      );
      writeFileSync(
        join(dir, "jev-check.js"),
        `const fs = require('node:fs');
fs.writeFileSync('started.json', JSON.stringify({ args: process.argv.slice(2), pid: process.pid, ppid: process.ppid, fields: process.env.JEV_ALLOWED_FIELDS, keyMatches: process.env.TYPESAFE_API_KEY === 'process-only-key' }));
fs.writeFileSync('.watch.pid', String(process.pid));
setTimeout(() => fs.unlinkSync('.watch.pid'), 600);\n`,
      );
      const r = await startTabDetection({
        ...opts(dir),
        launch: "wmi",
        environment: {
          ...process.env,
          TYPESAFE_API_KEY: "process-only-key",
          JEV_ALLOWED_FIELDS: "observation.app_name",
        },
      });
      expect(r).toMatchObject({ status: "started", pid: expect.any(Number) });
      let started: Record<string, unknown> = null;
      for (let i = 0; i < 200 && !started; i++) {
        try {
          started = JSON.parse(readFileSync(join(dir, "started.json"), "utf8"));
        } catch {
          await new Promise((res) => setTimeout(res, 50));
        }
      }
      expect(started?.args).toEqual(["--session-bound", "--api", "http://tk/api"]);
      expect(started?.pid).toBe((r as Record<string, unknown>).pid);
      expect(started?.ppid).not.toBe(process.pid);
      expect(started?.fields).toBe("observation.app_name");
      expect(started?.keyMatches).toBe(true);
      // Let the hidden process exit so the temporary folder can be removed.
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 100 && alive((r as Record<string, unknown>).pid); i++)
        await new Promise((res) => setTimeout(res, 100));
    },
    30_000,
  );
});
