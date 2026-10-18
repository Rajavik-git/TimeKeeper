// TimeKeeper MCP tools. Read-only tools have readOnlyHint; writes only happen when the lawyer asks.
import { answerQuestion, listCases, listQuestions, listWorkPeriods } from "./review.js";
import { linkStatus } from "./screenpipe-link.js";
import { endSession, getStatus, startSession, type SessionDeps } from "./session.js";

const noInput = { type: "object", properties: {}, additionalProperties: false } as const;
const sessionIdInput = { type: "string", description: "Optional session ID." } as const;

export const TOOLS = [
  {
    name: "timekeeper_status",
    description:
      "Read-only. Whether the TimeKeeper API is running, the active session (or null), and its open work period with caseId (or null).",
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
  },
  {
    name: "start_session",
    description:
      "Start TimeKeeper button. Does nothing and returns the session if one is active; otherwise starts a session. " +
      "Only call it when the lawyer explicitly asks to start TimeKeeper. Status: started | already_active | " +
      "timekeeper_not_running | pending | unconfirmed | error. Only started and already_active mean a session runs.",
    inputSchema: noInput,
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "end_session",
    description:
      "End TimeKeeper button. Ends the active session at the time of the call; Screenpipe keeps recording. " +
      "Only call it when the lawyer explicitly asks to end the session. Status: ended | no_active_session | " +
      "timekeeper_not_running | pending | unconfirmed | error. Only ended means the session ended.",
    inputSchema: noInput,
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "list_cases",
    description:
      "Read-only. Active cases (id, clientId, clientName, reference, title) to find the case the lawyer means.",
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_work_periods",
    description:
      "Read-only. Work periods of a session (default: the active session, else the most recent), oldest first: id, " +
      "caseId (null = unresolved), case reference, startedAt, endedAt, assignmentRevision, timeValidated.",
    inputSchema: {
      type: "object",
      properties: { sessionId: sessionIdInput },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_questions",
    description:
      "Read-only. Questions asked to the lawyer for unknown folders in a session (default: the active session, " +
      "else the most recent), with their period times. status defaults to pending.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdInput,
        status: { type: "string", enum: ["pending", "answered", "superseded", "all"] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "answer_question",
    description:
      "The lawyer's answer to an unknown-folder question: assigns an existing case (from list_cases) to that period. " +
      "Only call it with the case the lawyer explicitly chose. A stale question is refused. " +
      "Status: answered | timekeeper_not_running | error.",
    inputSchema: {
      type: "object",
      properties: {
        questionId: { type: "string" },
        caseId: { type: "string", description: "Existing case ID from list_cases." },
      },
      required: ["questionId", "caseId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "screenpipe_link_status",
    description:
      "Read-only. Whether the Screenpipe session link runs (the TimeKeeper session follows Screenpipe recording), " +
      "when Screenpipe was last seen recording, and whether the start and end for its current run were delivered.",
    inputSchema: noInput,
    annotations: { readOnlyHint: true },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export interface ToolContext {
  deps: SessionDeps;
  linkStatePath: string;
}

/** A tool result and whether it is a failure the chat must not report as success. */
export interface ToolOutcome {
  value: unknown;
  isError: boolean;
}

const isToolName = (name: unknown): name is ToolName => TOOLS.some((tool) => tool.name === name);

export async function callTool(
  name: unknown,
  args: Record<string, unknown>,
  { deps, linkStatePath }: ToolContext,
): Promise<ToolOutcome | null> {
  if (!isToolName(name)) return null;
  const outcome = (value: { status: string }, ok: readonly string[]) => ({
    value,
    isError: !ok.includes(value.status),
  });
  switch (name) {
    case "timekeeper_status":
      try {
        return { value: await getStatus(deps), isError: false };
      } catch (error) {
        return {
          value: { error: error instanceof Error ? error.message : String(error) },
          isError: true,
        };
      }
    case "start_session":
      return outcome(await startSession(deps), ["started", "already_active"]);
    case "end_session":
      return outcome(await endSession(deps), ["ended"]);
    case "list_cases":
      return outcome(await listCases(deps), ["ok"]);
    case "list_work_periods":
      return outcome(await listWorkPeriods(deps, args), ["ok"]);
    case "list_questions":
      return outcome(await listQuestions(deps, args), ["ok"]);
    case "answer_question":
      return outcome(await answerQuestion(deps, args), ["answered"]);
    case "screenpipe_link_status":
      return { value: linkStatus(linkStatePath, deps.now()), isError: false };
  }
}
