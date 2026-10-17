// CLI: Screenpipe -> MCP -> JEV -> result.
// Usage (from this folder): bun jev-check.ts [--watch | --session-bound] [--dry-run] [--json] [--window <min>] [--case <id>]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpStdioClient, MCP_PACKAGE_DEFAULT } from "./mcp-client.ts";
import { parseInputEvents, isRelevant, StabilityTimer } from "./context.ts";
import { callJev, parseAllowedFields, type CaseRecord } from "./jev.ts";
import { runCheck, type CheckOptions, type CheckResult } from "./check.ts";
import { acquireWatchLock, releaseWatchLock, sessionState } from "./session-bound.ts";

const here = import.meta.dir;

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim(); // literal values, no expansion
  }
  return env;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

const fileEnv = loadEnvFile(join(here, ".env"));
const env = (k: string) => process.env[k] || fileEnv[k] || "";

const dryRun = flag("--dry-run");
const asJson = flag("--json");
// --session-bound: started by the TimeKeeper start_session tool; single instance, stops when the session ends.
const sessionBound = flag("--session-bound");
const watch = flag("--watch") || sessionBound;
const apiKey = env("TYPESAFE_API_KEY");
if (!dryRun && !apiKey) {
  console.error("TYPESAFE_API_KEY is missing (set it in .env beside this script). Use --dry-run to test without JEV.");
  process.exit(2);
}

let allowed: Set<string>;
try {
  allowed = parseAllowedFields(env("JEV_ALLOWED_FIELDS"));
} catch (e: any) {
  console.error(`${e.message}. Set JEV_ALLOWED_FIELDS in .env; see .env.example.`);
  process.exit(2);
}

const casesPath = env("CASES_FILE") ? env("CASES_FILE") : join(here, "cases.json");
const cases: CaseRecord[] = existsSync(casesPath) ? JSON.parse(readFileSync(casesPath, "utf8")) : [];
const currentCaseId = arg("--case") ?? null;
if (currentCaseId && !cases.some((c) => c.id === currentCaseId)) {
  console.error(`--case ${currentCaseId} is not in ${casesPath}`);
  process.exit(2);
}

const opts: CheckOptions = {
  windowMinutes: Number(arg("--window") ?? env("WINDOW_MINUTES") ?? 5) || 5,
  stabilityMs: (Number(env("STABILITY_SECONDS")) || 10) * 1000,
  maxTextChars: Number(env("MAX_TEXT_CHARS")) || 600,
  allowed,
  model: env("TYPESAFE_MODEL") || "jev-latest",
  minConfidence: Number(env("JEV_MIN_CONFIDENCE")) || 0.7,
  cases,
  currentCaseId,
  dryRun,
};

const mcpEnv: Record<string, string> = { SCREENPIPE_API_URL: env("SCREENPIPE_API_URL") || "http://localhost:3030" };
if (env("SCREENPIPE_API_KEY")) mcpEnv.SCREENPIPE_LOCAL_API_KEY = env("SCREENPIPE_API_KEY");
const mcp = new McpStdioClient([process.execPath, "x", env("MCP_PACKAGE") || MCP_PACKAGE_DEFAULT], mcpEnv);

const deps = {
  callTool: mcp.callTool,
  jev: (body: unknown) => callJev(body, apiKey),
  now: () => Date.now(),
};

function print(r: CheckResult) {
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  const line = (c: CheckResult["current"]) => (c ? `${c.app ?? "?"} | ${c.window_title ?? "?"} (${c.ts})` : "none");
  console.log(`\n[${r.checked_at}] status=${r.status}${r.error ? ` error=${r.error}` : ""}${r.wait_ms ? ` wait_ms=${r.wait_ms}` : ""}`);
  if (r.status === "not_stable") return;
  console.log(`  detection:  ${r.detection}`);
  console.log(`  previous:   ${line(r.previous)}`);
  console.log(`  current:    ${line(r.current)}`);
  if (r.passed_through.length) console.log(`  passed through: ${r.passed_through.join(" ; ")}`);
  if (r.requests) console.log(`  request that would be sent to TypeSafe:\n${JSON.stringify(r.requests, null, 2)}`);
  if (r.tab_change) {
    const t = r.tab_change;
    const probs = Object.entries(t.probabilities).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
    console.log(`  tab change: ${t.answer.toUpperCase()}${t.reason ? ` (${t.reason}, model chose ${t.choice})` : ""} | ${probs} | confidence=${t.confidence.toFixed(2)} | ${t.model}`);
  }
  if (r.assignment) {
    const a: any = r.assignment;
    if (a.status === "proposal") console.log(`  proposal:   ${a.reference} - ${a.title} (case ${a.case_id}, client ${a.client_id}) p=${a.probability.toFixed(2)} confidence=${a.confidence.toFixed(2)}`);
    else console.log(`  assignment: ${a.status} (${a.reason})`);
  }
  if (r.still_current !== null) console.log(`  still current: ${r.still_current} -> display proposal: ${r.display_proposal}`);
  console.log("  applied: false (no assignment was changed)");
}

async function once() {
  // Wait for stability (up to one minute) instead of failing immediately.
  for (let i = 0; i < 6; i++) {
    const r = await runCheck(deps, opts);
    if (r.status !== "not_stable") return print(r);
    if (!asJson) console.log(`Not stable yet, waiting ${r.wait_ms} ms...`);
    await Bun.sleep(Math.min(r.wait_ms ?? 1000, 10_000) + 250);
  }
  console.log("Context never became stable within one minute.");
}

const timekeeperApi = env("TIMEKEEPER_API_URL") || `http://127.0.0.1:${env("TIMEKEEPER_PORT") || 8787}/api`;

async function watchLoop() {
  const timer = new StabilityTimer(opts.stabilityMs);
  let since = Date.now();
  const seen = new Set<string>();
  let lastSessionCheck = 0;
  console.log(`[${new Date().toISOString()}] Watching Screenpipe focus events. Stability delay: ${opts.stabilityMs / 1000}s.` +
    (sessionBound ? ` Stops when the TimeKeeper session ends (${timekeeperApi}).` : " Ctrl+C to stop."));
  for (;;) {
    const now = Date.now();
    if (sessionBound && now - lastSessionCheck >= 10_000) {
      lastSessionCheck = now;
      const s = await sessionState(timekeeperApi);
      if (s.state === "ended") {
        console.log(`[${new Date().toISOString()}] TimeKeeper session ended: tab detection stopped.`);
        return;
      }
    }
    try {
      const out = await mcp.callTool("search-content", {
        content_type: "input", start_time: new Date(since - 2000).toISOString(), end_time: new Date(now).toISOString(), limit: 20,
      });
      for (const e of parseInputEvents(out).filter(isRelevant)) {
        const k = `${e.ts}|${e.type}|${e.title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        timer.observe(e.ts);
        if (!asJson) console.log(`  update: ${e.type} ${e.app ?? "?"} | ${e.title ?? "?"} -> timer reset`);
      }
      since = now;
      if (timer.due(Date.now())) {
        timer.consume();
        print(await runCheck(deps, opts));
      }
    } catch (e: any) {
      console.error(`  read failed: ${e.message}`);
    }
    await Bun.sleep(1000);
  }
}

if (sessionBound) {
  const lock = acquireWatchLock();
  if (!lock.ok) {
    console.log(`Tab detection already running (pid ${lock.pid}).`);
    process.exit(0);
  }
  const release = () => releaseWatchLock();
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { release(); process.exit(0); });
}

try {
  await mcp.start();
  const tools = await mcp.listTools();
  if (!tools.includes("search-content")) throw new Error("Screenpipe MCP does not expose search-content");
  if (watch) await watchLoop();
  else await once();
} catch (e: any) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await mcp.close();
  if (sessionBound) releaseWatchLock();
}
