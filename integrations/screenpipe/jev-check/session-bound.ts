// Ties the watch mode to a TimeKeeper session: one watcher at a time, and it stops when the session ends.
// Uses only node: modules so the TimeKeeper MCP server (Node or Bun) can share it.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const JEV_CHECK_DIR = dirname(fileURLToPath(import.meta.url));
export const WATCH_LOCK = join(JEV_CHECK_DIR, ".watch.pid");
export const WATCH_LOG = join(JEV_CHECK_DIR, "watch.log");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM"; // exists but owned by someone else
  }
}

/** PID of a running watcher, or null (a stale lock file counts as none). */
export function runningWatcher(lockPath = WATCH_LOCK): number | null {
  if (!existsSync(lockPath)) return null;
  const pid = Number(readFileSync(lockPath, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}

/** Takes the lock for this process; returns the other watcher's PID when one is already running. */
export function acquireWatchLock(lockPath = WATCH_LOCK, pid = process.pid): { ok: true } | { ok: false; pid: number } {
  const other = runningWatcher(lockPath);
  if (other !== null && other !== pid) return { ok: false, pid: other };
  writeFileSync(lockPath, String(pid));
  return { ok: true };
}

export function releaseWatchLock(lockPath = WATCH_LOCK, pid = process.pid) {
  try {
    if (existsSync(lockPath) && Number(readFileSync(lockPath, "utf8").trim()) === pid) unlinkSync(lockPath);
  } catch {}
}

export type SessionState = { state: "active"; sessionId: string } | { state: "ended" } | { state: "unreachable" };

/** Closing TimeKeeper keeps the session active, so an unreachable API is not an ended session. */
export async function sessionState(apiBase: string, fetcher: typeof fetch = fetch): Promise<SessionState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetcher(`${apiBase.replace(/\/+$/, "")}/sessions/active`, { signal: ctrl.signal });
    if (!r.ok) return { state: "unreachable" };
    const s: any = await r.json();
    return s && typeof s.id === "string" && !s.endedAt ? { state: "active", sessionId: s.id } : { state: "ended" };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
