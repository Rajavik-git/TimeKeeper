import type { components } from "./generated.js";

export type Id = string;
export type Revision = number;
export type ErrorCode =
  "no-active-session" | "not-found" | "conflict" | "pending" | "invalid-request";
export interface ApiError {
  error: ErrorCode;
  message: string;
}
export type StartCommand = components["schemas"]["PostCommandsStartRequest"];
export type EndCommand = components["schemas"]["PostCommandsEndRequest"];
export type PeriodView = components["schemas"]["WorkPeriod"];

export type QuestionAnswer = components["schemas"]["PostQuestionsAnswerRequest"];
export type CommandOutcome =
  | { status: "applied"; sessionId: Id; startedAt: string; endedAt: string | null }
  | { status: "pending"; commandId: Id };
