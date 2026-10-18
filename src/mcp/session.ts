// "Start TimeKeeper" logic shared by the MCP tool and the CLI fallback.
// Calls only the application API (docs/API.md D6, D7). Never claims a start that the API did not confirm.
import { ApiUnreachable, callApi, decodeSession, readActiveSession } from "./api-client.js";
import type { StartCommand } from "../contracts/index.js";
import type { TabDetectionResult } from "./tab-detection.js";
import { activePeriod, type PeriodInfo } from "./workflow.js";

export const PRODUCER_ID = "screenpipe-start-button";

export interface SessionInfo {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export type StatusResult =
  | { timekeeper: "running"; activeSession: SessionInfo | null; activePeriod: PeriodInfo | null }
  | { timekeeper: "not_running"; activeSession: null; activePeriod: null };

export type StartResult =
  | {
      status: "already_active";
      started: false;
      session: SessionInfo;
      tab_detection?: TabDetectionResult;
    }
  | {
      status: "started";
      started: true;
      session: SessionInfo;
      commandId: string;
      launched: boolean;
      tab_detection?: TabDetectionResult;
    }
  | { status: "pending"; started: false; commandId: string }
  | { status: "timekeeper_not_running"; started: false; message: string }
  | { status: "unconfirmed"; started: false; commandId: string; message: string }
  | { status: "error"; started: false; error: string; message: string };

export interface SessionDeps {
  /** Base URL of the application API, including `/api`. */
  apiBase: string;
  fetch: typeof fetch;
  now: () => Date;
  newId: () => string;
  /** Starts the desktop app; undefined when no launch command is configured. */
  launch?: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Starts JEV tab-change detection once a session is running; undefined disables it. */
  startTabDetection?: () => Promise<TabDetectionResult>;
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
}

async function healthy(deps: SessionDeps): Promise<boolean> {
  try {
    const r = await callApi(deps, "/health");
    return r.ok && ((await r.json()) as { status?: string })?.status === "ok";
  } catch (error) {
    if (error instanceof ApiUnreachable) return false;
    throw error;
  }
}

export async function getStatus(deps: SessionDeps): Promise<StatusResult> {
  if (!(await healthy(deps)))
    return { timekeeper: "not_running", activeSession: null, activePeriod: null };
  const session = await readActiveSession(deps);
  return {
    timekeeper: "running",
    activeSession: session,
    activePeriod: session ? await activePeriod(deps, session.id) : null,
  };
}

async function waitUntilReady(deps: SessionDeps): Promise<boolean> {
  const deadline = deps.now().getTime() + (deps.readyTimeoutMs ?? 60_000);
  while (deps.now().getTime() < deadline) {
    if (await healthy(deps)) return true;
    await deps.sleep(1000);
  }
  return false;
}

/**
 * Does nothing when a session is active; otherwise starts one, launching TimeKeeper first when configured.
 * Whenever a session is running afterwards, tab-change detection is started too (or left running).
 */
export async function ensureSession(
  deps: SessionDeps,
  producerId = PRODUCER_ID,
  retry?: { id: string; occurredAt: string },
): Promise<StartResult> {
  const result = await ensureSessionOnly(deps, producerId, retry);
  if (
    (result.status === "started" || result.status === "already_active") &&
    deps.startTabDetection
  ) {
    try {
      result.tab_detection = await deps.startTabDetection();
    } catch (error) {
      result.tab_detection = {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return result;
}

async function ensureSessionOnly(
  deps: SessionDeps,
  producerId: string,
  retry?: { id: string; occurredAt: string },
): Promise<StartResult> {
  // The press time is the session start boundary, even if TimeKeeper needs launching first.
  const pressedAt = retry?.occurredAt ?? deps.now().toISOString();
  let launched = false;
  try {
    if (!(await healthy(deps))) {
      if (!deps.launch) {
        return {
          status: "timekeeper_not_running",
          started: false,
          message:
            "TimeKeeper is not running and no launch command is configured. Open TimeKeeper, then press Start again.",
        };
      }
      await deps.launch();
      launched = true;
      if (!(await waitUntilReady(deps))) {
        return {
          status: "timekeeper_not_running",
          started: false,
          message:
            "TimeKeeper was launched but its API did not become ready. No session was started.",
        };
      }
    }

    const current = await readActiveSession(deps);
    if (current) return { status: "already_active", started: false, session: current };

    const id = retry?.id ?? deps.newId();
    const command: StartCommand = {
      producerId,
      commandId: `start-${id}`,
      sessionId: `session-${id}`,
      occurredAt: pressedAt,
    };
    let r: Response;
    try {
      r = await callApi(deps, "/commands/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
    } catch (error) {
      if (error instanceof ApiUnreachable) {
        return {
          status: "unconfirmed",
          started: false,
          commandId: command.commandId,
          message:
            "The start command was sent but TimeKeeper did not answer. Check TimeKeeper before pressing Start again.",
        };
      }
      throw error;
    }
    const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (r.status === 202)
      return { status: "pending", started: false, commandId: command.commandId };
    if (!r.ok) {
      return {
        status: "error",
        started: false,
        error: String(body?.error ?? `http-${r.status}`),
        message: String(body?.message ?? ""),
      };
    }
    const started = decodeSession({
      id: body?.sessionId,
      startedAt: body?.startedAt,
      endedAt: body?.endedAt,
    });
    if (!started)
      return {
        status: "error",
        started: false,
        error: "malformed-response",
        message: "start returned no session",
      };
    // Command replay can return a session that has since ended. Confirm current state before claiming success.
    const active = await readActiveSession(deps);
    if (!active)
      return {
        status: "error",
        started: false,
        error: "session-not-active",
        message: "The start command was acknowledged, but no session is active.",
      };
    // Another start won the race: return the session that is active now.
    if (active.id !== command.sessionId)
      return { status: "already_active", started: false, session: active };
    return {
      status: "started",
      started: true,
      session: active,
      commandId: command.commandId,
      launched,
    };
  } catch (error) {
    return {
      status: "error",
      started: false,
      error: "unexpected",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
