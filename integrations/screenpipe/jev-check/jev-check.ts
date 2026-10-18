import { formatCheckLog, safeCheckResult } from "./logging.js";
import type { StatusResult } from "../../../src/mcp/session.js";
import type { CaseInfo, TransitionResult } from "../../../src/mcp/workflow.js";
import {
  captureTransitionContext,
  transitionInput,
  type TransitionContext,
} from "./transition-input.js";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
// CLI: Screenpipe -> MCP -> JEV -> result.
// Usage (from this folder): node --import tsx jev-check.ts [--watch | --session-bound] [--dry-run] [--json] [--window <min>] [--case <id>]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { McpStdioClient, MCP_PACKAGE_DEFAULT } from "./mcp-client.js";
import { parseInputEvents, isRelevant, type FocusEvent } from "./context.js";
import { callJev, parseAllowedFields, type CaseRecord } from "./jev.js";
import { runCheck, type CheckOptions, type CheckResult } from "./check.js";
import { acquireWatchLock, releaseWatchLock, sessionState } from "./session-bound.js";
import { decideTransition } from "./decide.js";
import { checkSettings } from "./config.js";
import { workflowEnvironment } from "./environment.js";
import { WatchCheck } from "./watch-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = import.meta.url.endsWith(".ts");
const runtimeArgs = source ? ["--import", "tsx"] : [];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

const settings = workflowEnvironment(here);
const env = (k: string) => settings[k] ?? "";

const dryRun = flag("--dry-run");
const asJson = flag("--json");
// --session-bound: started by the TimeKeeper start_session tool; single instance, stops when the session ends.
const sessionBound = flag("--session-bound");
const watch = flag("--watch") || sessionBound;
const apiKey = env("TYPESAFE_API_KEY");
if (!dryRun && !apiKey) {
  console.error(
    "TYPESAFE_API_KEY is missing (set it in .env beside this script). Use --dry-run to test without JEV.",
  );
  process.exit(2);
}

let allowed: Set<string>;
try {
  allowed = parseAllowedFields(env("JEV_ALLOWED_FIELDS"));
} catch {
  console.error("Invalid JEV_ALLOWED_FIELDS. Review configured fields; see .env.example.");
  process.exit(2);
}

const casesPath = env("CASES_FILE") ? env("CASES_FILE") : join(here, "cases.json");
let cases: CaseRecord[] = [];
try {
  cases = existsSync(casesPath) ? JSON.parse(readFileSync(casesPath, "utf8")) : [];
  if (!Array.isArray(cases)) throw new Error("Invalid catalogue");
} catch {
  console.error(
    "Cannot read the configured case catalogue. Check its JSON format and file access.",
  );
  process.exit(2);
}
const currentCaseId = arg("--case") ?? null;
if (currentCaseId && !cases.some((c) => c.id === currentCaseId)) {
  console.error("The selected case is not in the configured case catalogue.");
  process.exit(2);
}

let numericSettings: ReturnType<typeof checkSettings>;
try {
  numericSettings = checkSettings(settings, arg("--window"));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid numeric workflow settings.");
  process.exit(2);
}

const opts: CheckOptions = {
  ...numericSettings,
  allowed,
  model: env("TYPESAFE_MODEL") || "jev-latest",
  cases,
  currentCaseId,
  dryRun,
};

const mcpEnv: Record<string, string> = {
  SCREENPIPE_API_URL: env("SCREENPIPE_API_URL") || "http://localhost:3030",
};
if (env("SCREENPIPE_API_KEY")) mcpEnv.SCREENPIPE_LOCAL_API_KEY = env("SCREENPIPE_API_KEY");
const mcpPackage = env("MCP_PACKAGE") || MCP_PACKAGE_DEFAULT;
if (!/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?$/.test(mcpPackage)) {
  throw new Error("MCP_PACKAGE must be a package name with an optional version");
}
const mcp = new McpStdioClient(
  process.platform === "win32"
    ? ["cmd.exe", "/d", "/s", "/c", `npx --no-install ${mcpPackage}`]
    : ["npx", "--no-install", mcpPackage],
  mcpEnv,
);

const deps = {
  callTool: mcp.callTool,
  jev: (body: unknown) => callJev(body, apiKey),
  now: () => Date.now(),
};

function print(r: CheckResult) {
  if (asJson) console.log(JSON.stringify(safeCheckResult(r), null, 2));
  else console.log(formatCheckLog(r));
  // Only an explicit interactive dry run can display approved request fields.
  if (dryRun && !watch && !asJson && process.stdout.isTTY && r.requests) {
    console.log(
      `Approved dry-run request preview (terminal only):\n${JSON.stringify(r.requests, null, 2)}`,
    );
  }
}

// --api comes first: a watcher started through WMI on Windows does not inherit the caller's environment.
const timekeeperApi =
  arg("--api") ||
  env("TIMEKEEPER_API_URL") ||
  `http://127.0.0.1:${env("TIMEKEEPER_PORT") || 8787}/api`;

// --apply (implied by --session-bound): send confirmed changes to the TimeKeeper session through its MCP server.
const apply =
  (flag("--apply") || sessionBound) && !/^(0|false|off|no)$/i.test(env("TIMEKEEPER_APPLY"));
const tk: McpStdioClient | null = apply
  ? new McpStdioClient(
      [
        process.execPath,
        ...runtimeArgs,
        join(here, "..", "..", "..", "src", "mcp", source ? "server.ts" : "server.js"),
      ],
      { TIMEKEEPER_API_URL: timekeeperApi, TIMEKEEPER_TAB_DETECTION: "off" },
    )
  : null;

type TkContext = TransitionContext;
const stamp = () => new Date().toISOString();

/** Candidates and the current case come from TimeKeeper, so JEV compares against the real catalogue. */
async function syncFromTimekeeper(): Promise<TkContext | null> {
  if (!tk) return null;
  try {
    const st = (await tk.callToolJson<StatusResult>("timekeeper_status", {})).value;
    if (st?.timekeeper !== "running") return null;
    if (st.activeSession === null) return { sessionId: null, period: null };
    if (!st.activeSession?.id) return null;
    const cs = await tk.callToolJson<CaseInfo[]>("list_cases", {});
    if (cs.isError || !Array.isArray(cs.value)) return null;
    opts.cases = cs.value.map((c) => ({
      id: c.id,
      client_id: c.clientId,
      reference: c.reference,
      title: c.title,
      client_name: c.clientName,
    }));
    opts.currentCaseId = st.activePeriod?.caseId ?? null;
    return captureTransitionContext({
      activeSession: st.activeSession,
      activePeriod: st.activePeriod,
    });
  } catch {
    console.error("TimeKeeper status retrieval failed.");
    return null;
  }
}

async function applyResult(r: CheckResult, ctx: TkContext | null) {
  if (!tk || r.status !== "checked") return;
  if (!ctx?.sessionId)
    return console.log("  timekeeper: no active session reachable, nothing sent");
  const d = decideTransition(r, ctx.period, opts.minConfidence);
  if (d.action === "none") return console.log(`  timekeeper: nothing sent (${d.reason})`);
  try {
    const out = await tk.callToolJson(
      "record_case_transition",
      transitionInput(ctx, d.transitionAt, d.caseId),
    );
    const v = out.value as TransitionResult;
    const status = [
      "applied",
      "no_change",
      "stale",
      "pending",
      "timekeeper_not_running",
      "unconfirmed",
      "error",
    ].includes(v.status)
      ? v.status
      : "error";
    console.log(`  timekeeper: record_case_transition -> ${status}`);
  } catch {
    console.error("TimeKeeper transition delivery failed; application is unconfirmed.");
  }
}

async function checkAndApply(): Promise<CheckResult> {
  const ctx = await syncFromTimekeeper();
  const r = await runCheck(deps, opts);
  if (r.status !== "not_stable") {
    print(r);
    await applyResult(r, ctx);
  }
  return r;
}

async function once() {
  // Wait for stability (up to one minute) instead of failing immediately.
  for (let i = 0; i < 6; i++) {
    const r = await checkAndApply();
    if (r.status !== "not_stable") return;
    if (!asJson) console.log(`Not stable yet, waiting ${r.wait_ms} ms...`);
    await sleep(Math.min(r.wait_ms ?? 1000, 10_000) + 250);
  }
  console.log("Context never became stable within one minute.");
}

async function watchLoop() {
  let latestFocus: FocusEvent | undefined;
  const runner = new WatchCheck(
    {
      now: () => Date.now(),
      context: syncFromTimekeeper,
      check: () => runCheck(deps, { ...opts, focusEvent: latestFocus }),
      deliver: async (input) => {
        const out = await tk!.callToolJson<TransitionResult>("record_case_transition", input);
        const receivedStatus = out.value?.status;
        const status = [
          "applied",
          "no_change",
          "stale",
          "pending",
          "timekeeper_not_running",
          "unconfirmed",
          "error",
        ].includes(receivedStatus)
          ? receivedStatus
          : "unconfirmed";
        console.log(`  timekeeper: record_case_transition -> ${status}`);
        return { status };
      },
      report: print,
    },
    opts.stabilityMs,
    opts.minConfidence,
    apply,
  );
  let since = Date.now();
  const seen = new Set<string>();
  let lastSessionCheck = 0;
  console.log(
    `[${new Date().toISOString()}] Watching Screenpipe focus events. Stability delay: ${opts.stabilityMs / 1000}s.` +
      (sessionBound ? " Stops when the TimeKeeper session ends." : " Ctrl+C to stop."),
  );
  for (;;) {
    const now = Date.now();
    if (sessionBound && now - lastSessionCheck >= 10_000) {
      lastSessionCheck = now;
      const s = await sessionState(timekeeperApi);
      if (s.state === "ended") {
        console.log(
          `[${new Date().toISOString()}] TimeKeeper session ended: tab detection stopped.`,
        );
        return;
      }
    }
    try {
      const out = await mcp.callTool("search-content", {
        content_type: "input",
        start_time: new Date(since - 2000).toISOString(),
        end_time: new Date(now).toISOString(),
        limit: 20,
      });
      for (const e of parseInputEvents(out).filter(isRelevant)) {
        const k = `${e.timestampMs}|${e.type}|${e.app}|${e.title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!latestFocus || e.timestampMs >= latestFocus.timestampMs) latestFocus = e;
        runner.observe(e.timestampMs);
        if (!asJson) console.log("  update: focus change observed; stability timer reset");
      }
      since = now;
      await runner.tick();
    } catch {
      console.error("Screenpipe evidence read failed.");
    }
    await sleep(1000);
  }
}

// Cleanup also applies while dependency handshakes are still in progress.
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    releaseWatchLock();
    void Promise.allSettled([mcp.close(), tk?.close()]).finally(() => process.exit(0));
  });
process.on("exit", () => releaseWatchLock());

try {
  await mcp.start();
  const tools = await mcp.listTools();
  if (!tools.includes("search-content"))
    throw new Error("Screenpipe MCP does not expose search-content");
  if (tk) {
    await tk.start();
    const tkTools = await tk.listTools();
    if (!tkTools.includes("record_case_transition"))
      throw new Error("TimeKeeper MCP has no record_case_transition tool");
    console.log(
      `[${stamp()}] Connected to TimeKeeper MCP: confirmed changes are sent to the session.`,
    );
  }
  if (stopping) throw new Error("Watcher stopped during startup");
  // The lock is the readiness signal: dependency handshakes must finish first.
  if (sessionBound) {
    const lock = acquireWatchLock();
    if (!lock.ok) {
      console.log(`Tab detection already running (pid ${lock.pid}).`);
      process.exitCode = 0;
    } else await watchLoop();
  } else if (watch) await watchLoop();
  else await once();
} catch {
  console.error("JEV watcher failed. Check local configuration and dependency availability.");
  process.exitCode = 1;
} finally {
  await mcp.close();
  await tk?.close();
  if (sessionBound) releaseWatchLock();
}
