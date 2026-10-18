// Session lifecycle checks never interpret an unreachable TimeKeeper API as an ended session.
export {
  acquireWatchLock,
  releaseWatchLock,
  runningWatcher,
  JEV_CHECK_DIR,
  WATCH_LOCK,
  WATCH_LOG,
} from "./watch-lock.js";

export type SessionState =
  { state: "active"; sessionId: string } | { state: "ended" } | { state: "unreachable" };

/** Closing TimeKeeper keeps the session active, so an unreachable API is not an ended session. */
export async function sessionState(
  apiBase: string,
  fetcher: typeof fetch = fetch,
): Promise<SessionState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetcher(`${apiBase.replace(/\/+$/, "")}/sessions/active`, {
      signal: ctrl.signal,
    });
    if (!r.ok) return { state: "unreachable" };
    const s = (await r.json()) as { id?: unknown; endedAt?: unknown } | null;
    if (s === null) return { state: "ended" };
    if (s && typeof s.id === "string" && s.id.length > 0 && s.endedAt === null)
      return { state: "active", sessionId: s.id };
    return { state: "unreachable" };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
