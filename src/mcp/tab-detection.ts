// Starts the JEV tab-change detection (integrations/screenpipe/jev-check) alongside a TimeKeeper session.
// The watcher submits guarded transitions and stops when the session ends.
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { workflowEnvironment } from "../../integrations/screenpipe/jev-check/environment.js";
import { checkSettings } from "../../integrations/screenpipe/jev-check/config.js";
import { parseAllowedFields } from "../../integrations/screenpipe/jev-check/jev.js";
import { launchWatcherChild, launchWatcherWmi, type WatcherProcess } from "./watcher-launch.js";
import {
  JEV_CHECK_DIR,
  runningWatcher,
  WATCH_LOG,
} from "../../integrations/screenpipe/jev-check/session-bound.js";

export type TabDetectionResult =
  | { status: "started"; pid: number; log: string }
  | { status: "already_running"; pid: number }
  | { status: "disabled" }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

export interface TabDetectionOptions {
  enabled: boolean;
  node: string;
  apiBase: string;
  dir?: string;
  /** 'wmi' (Windows) starts the watcher outside the caller's process tree; default 'spawn'. */
  launch?: "spawn" | "wmi";
  environment?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
}

/** Uses the current Node runtime unless explicitly configured. */
export function findNode(env: NodeJS.ProcessEnv = process.env): string {
  return env.TIMEKEEPER_NODE || process.execPath;
}

export { watcherArgs } from "./watcher-launch.js";

/** One JEV check as the watcher logged it (see integrations/screenpipe/jev-check/jev-check.ts print). */
export interface TabCheck {
  checkedAt: string;
  status: string;
  previous?: string;
  current?: string;
  tabChange?: string;
  proposal?: string;
  assignment?: string;
  timekeeper?: string;
}
export interface TabDetectionStatus {
  running: boolean;
  pid: number | null;
  log: string;
  lastEvent: string | null;
  recentChecks: TabCheck[];
}

const CHECK_FIELDS: Record<string, keyof TabCheck> = {
  previous: "previous",
  current: "current",
  "tab change": "tabChange",
  proposal: "proposal",
  assignment: "assignment",
  timekeeper: "timekeeper",
};

/** Parses diagnostic statuses and redacts captured content from older log formats. */
export function parseWatchLog(
  text: string,
  limit = 5,
): { lastEvent: string | null; checks: TabCheck[] } {
  const checks: TabCheck[] = [];
  let lastEvent: string | null = null;
  let current: TabCheck | null = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^\[([^\]]+)\] (.*)$/.exec(line);
    if (head && Number.isFinite(Date.parse(head[1]!))) {
      const check = /^status=(\S+)(.*)$/.exec(head[2]!);
      if (check) {
        current = {
          checkedAt: new Date(Date.parse(head[1]!)).toISOString(),
          status: ["checked", "not_stable", "insufficient_data", "dry_run", "error"].includes(
            check[1]!,
          )
            ? check[1]!
            : "error",
        };
        checks.push(current);
      } else {
        current = null;
        if (!/^stable for /.test(head[2]!)) {
          const event = head[2]!.startsWith("TimeKeeper session ended:")
            ? "session-ended"
            : head[2]!.startsWith("Watching Screenpipe focus events.")
              ? "watching"
              : "event-redacted";
          lastEvent = `${new Date(Date.parse(head[1]!)).toISOString()} ${event}`;
        }
      }
      continue;
    }
    const diagnostics = /^ {2}diagnostics:\s+(.*)$/.exec(line);
    if (current && diagnostics) {
      try {
        const safe = JSON.parse(diagnostics[1]!) as {
          tab_change?: { answer?: unknown; confidence?: unknown };
          assignment?: { status?: unknown; confidence?: unknown };
        };
        const confidence = (value: unknown) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
            ? ` confidence=${value}`
            : "";
        if (
          safe?.tab_change &&
          ["yes", "no", "uncertain"].includes(String(safe.tab_change.answer))
        ) {
          current.tabChange = `${safe.tab_change.answer}${confidence(safe.tab_change.confidence)}`;
        }
        if (
          safe?.assignment &&
          ["proposal", "unresolved", "skipped"].includes(String(safe.assignment.status))
        ) {
          current.assignment = `${safe.assignment.status}${confidence(safe.assignment.confidence)}`;
        }
      } catch {
        /* Ignore malformed diagnostic records. */
      }
      continue;
    }
    const field = /^ {2}([a-z ]+?):\s+(.*)$/.exec(line);
    const key = field && CHECK_FIELDS[field[1]!];
    if (current && key) {
      // Older watch.log files can contain client data. Never return their raw fields.
      current[key] = "[redacted]";
    }
  }
  return { lastEvent, checks: checks.slice(-Math.max(1, Math.min(limit, 20))) };
}

export function tabDetectionStatus(o: { dir?: string; limit?: number } = {}): TabDetectionStatus {
  const dir = o.dir ?? JEV_CHECK_DIR;
  const log = o.dir ? join(dir, "watch.log") : WATCH_LOG;
  const pid = runningWatcher(join(dir, ".watch.pid"));
  let text = "";
  if (existsSync(log)) {
    // Only the end of the file: the log grows with every check.
    const fd = openSync(log, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, 200_000);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  }
  const { lastEvent, checks } = parseWatchLog(text, o.limit ?? 5);
  return { running: pid !== null, pid, log, lastEvent, recentChecks: checks };
}

export async function startTabDetection(o: TabDetectionOptions): Promise<TabDetectionResult> {
  if (!o.enabled) return { status: "disabled" };
  const dir = o.dir ?? JEV_CHECK_DIR;
  let launched: WatcherProcess | undefined;
  try {
    const lock = join(dir, ".watch.pid");
    const running = runningWatcher(lock);
    if (running !== null) return { status: "already_running", pid: running };
    const settings = workflowEnvironment(dir, o.environment ?? process.env);
    if (!settings.TYPESAFE_API_KEY?.trim() || !settings.JEV_ALLOWED_FIELDS?.trim()) {
      return {
        status: "not_configured",
        message:
          "Tab detection needs TYPESAFE_API_KEY and approved JEV_ALLOWED_FIELDS. See the JEV setup guide.",
      };
    }
    try {
      parseAllowedFields(settings.JEV_ALLOWED_FIELDS);
      checkSettings(settings);
    } catch {
      return {
        status: "not_configured",
        message: "Invalid JEV fields or numeric settings. Review the JEV configuration.",
      };
    }
    const log = o.dir ? join(dir, "watch.log") : WATCH_LOG;
    const request = {
      node: o.node,
      directory: dir,
      apiBase: o.apiBase,
      log,
      environment: { ...settings, TIMEKEEPER_API_URL: o.apiBase },
    };
    launched =
      o.launch === "wmi" ? await launchWatcherWmi(request) : await launchWatcherChild(request);
    const deadline = Date.now() + (o.startupTimeoutMs ?? 45_000);
    while (Date.now() < deadline) {
      const ready = runningWatcher(lock);
      if (ready !== null) {
        if (o.launch !== "wmi" && ready !== launched.pid) {
          launched.stop();
          return { status: "already_running", pid: ready };
        }
        return { status: "started", pid: ready, log };
      }
      try {
        process.kill(launched.pid, 0);
      } catch {
        throw new Error("Watcher exited before readiness.");
      }
      await sleep(50);
    }
    throw new Error("Watcher did not become ready.");
  } catch {
    launched?.stop();
    return {
      status: "failed",
      message:
        "Tab detection did not become ready. Check the redacted watcher log and local dependencies.",
    };
  }
}
