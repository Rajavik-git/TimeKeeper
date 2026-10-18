// Start and End TimeKeeper buttons, shared by the MCP tools, the pipe CLI fallbacks and the Screenpipe link.
// Sessions change only through the explicit command routes; a result is never claimed without the API's answer.
import type { CommandOutcome } from "../contracts/index.js";
import {
  activeSession,
  healthy,
  openPeriod,
  postJson,
  toFailure,
  Unreachable,
  type ApiDeps,
  type Failure,
  type Session,
  type WorkPeriod,
} from "./api.js";

export const START_PRODUCER_ID = "screenpipe-start-button";
export const END_PRODUCER_ID = "screenpipe-end-button";

export interface SessionDeps extends ApiDeps {
  /** Opens the desktop app when its API is not running; absent when no launch command is configured. */
  launch?: () => Promise<void>;
  readyTimeoutMs?: number;
}

export type StatusResult =
  | { timekeeper: "running"; activeSession: Session | null; openPeriod: WorkPeriod | null }
  | { timekeeper: "not_running"; activeSession: null; openPeriod: null };

export type StartResult =
  | { status: "started"; session: Session; commandId: string; launched: boolean }
  | { status: "already_active"; session: Session }
  | { status: "pending"; commandId: string }
  | { status: "unconfirmed"; commandId: string; message: string }
  | Failure;

export type EndResult =
  | { status: "ended"; session: Session; commandId: string }
  | { status: "no_active_session"; message: string }
  | { status: "pending"; commandId: string }
  | { status: "unconfirmed"; commandId: string; message: string }
  | Failure;

export async function getStatus(deps: ApiDeps): Promise<StatusResult> {
  if (!(await healthy(deps)))
    return { timekeeper: "not_running", activeSession: null, openPeriod: null };
  const session = await activeSession(deps);
  return {
    timekeeper: "running",
    activeSession: session,
    openPeriod: session ? await openPeriod(deps, session.id) : null,
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

const sessionOf = (outcome: Extract<CommandOutcome, { status: "applied" }>): Session => ({
  id: outcome.sessionId,
  startedAt: outcome.startedAt,
  endedAt: outcome.endedAt,
  revision: 0,
});

/** Does nothing when a session is active; otherwise starts one at the request time. */
export async function startSession(
  deps: SessionDeps,
  producerId = START_PRODUCER_ID,
): Promise<StartResult> {
  // The request time is the session boundary, even when TimeKeeper must be launched first.
  const occurredAt = deps.now().toISOString();
  let launched = false;
  try {
    if (!(await healthy(deps))) {
      if (!deps.launch)
        return {
          status: "timekeeper_not_running",
          message:
            "TimeKeeper is not running and no launch command is configured. Open TimeKeeper, then start again.",
        };
      await deps.launch();
      launched = true;
      if (!(await waitUntilReady(deps)))
        return {
          status: "timekeeper_not_running",
          message:
            "TimeKeeper was launched but its API did not become ready. No session was started.",
        };
    }
    const current = await activeSession(deps);
    if (current) return { status: "already_active", session: current };

    // A retry gets a new command: it first sees the session a lost answer may have started.
    const id = deps.newId();
    const commandId = `start-${id}`;
    const sessionId = `session-${id}`;
    let response: { status: number; body: CommandOutcome };
    try {
      response = await postJson<CommandOutcome>(deps, "/api/commands/start", {
        producerId,
        commandId,
        sessionId,
        occurredAt,
      });
    } catch (error) {
      if (error instanceof Unreachable)
        return {
          status: "unconfirmed",
          commandId,
          message:
            "The start command was sent but TimeKeeper did not answer. Check TimeKeeper before starting again.",
        };
      throw error;
    }
    const outcome = response.body;
    if (outcome.status === "pending") return { status: "pending", commandId };
    const session = sessionOf(outcome);
    // Another start won the race: the API returns the session that was already active.
    if (session.id !== sessionId) return { status: "already_active", session };
    return { status: "started", session, commandId, launched };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Ends the active session at the request time, or at `at` for a known earlier end (the Screenpipe link).
 * An earlier end never precedes the open period's start, which the API would refuse.
 */
export async function endSession(
  deps: ApiDeps,
  producerId = END_PRODUCER_ID,
  at?: string,
): Promise<EndResult> {
  let occurredAt = at ?? deps.now().toISOString();
  let session: Session | null;
  try {
    session = await activeSession(deps);
    if (session && at) {
      const open = await openPeriod(deps, session.id);
      const floor = [session.startedAt, open?.startedAt].filter((t): t is string => !!t);
      occurredAt = new Date(Math.max(Date.parse(at), ...floor.map(Date.parse))).toISOString();
    }
  } catch (error) {
    if (error instanceof Unreachable)
      return {
        status: "timekeeper_not_running",
        message:
          "TimeKeeper is not running, so the end was not delivered. The session is still active; open TimeKeeper and end again.",
      };
    return toFailure(error);
  }
  if (!session) return { status: "no_active_session", message: "No TimeKeeper session is active." };

  const commandId = `end-${deps.newId()}`;
  try {
    const { body } = await postJson<CommandOutcome>(deps, "/api/commands/end", {
      producerId,
      commandId,
      sessionId: session.id,
      occurredAt,
    });
    if (body.status === "pending") return { status: "pending", commandId };
    if (!body.endedAt)
      return {
        status: "error",
        error: "malformed-response",
        message: "end returned no end boundary",
      };
    return { status: "ended", session: sessionOf(body), commandId };
  } catch (error) {
    if (error instanceof Unreachable)
      return {
        status: "unconfirmed",
        commandId,
        message:
          "The end command was sent but TimeKeeper did not answer. Check TimeKeeper before ending again.",
      };
    return toFailure(error);
  }
}
