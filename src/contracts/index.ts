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
export interface PeriodView {
  id: Id;
  sessionId: Id;
  caseId: Id | null;
  revision: Revision;
  startedAt: string;
  endedAt: string | null;
  detectedDurationMs: number | null;
  durationOverrideMs: number | null;
  assignmentRevision: Revision;
  effectiveRevision: Revision;
  validatedEffectiveRevision: Revision | null;
  timeValidated: boolean;
  timeValidatedAt: string | null;
  billingStatus: "unbilled" | "billed";
  appliedHourlyRateCents?: number | null;
  appliedCurrency?: string | null;
  taskTypeId?: number | null;
  label?: string;
  billable?: boolean;
  nonbillableReason?: string | null;
  excluded?: boolean;
  demoApp?: string | null;
  demoWindowTitle?: string | null;
  demoConfidence?: number | null;
  invoiceId?: number | null;
}
export type QuestionAnswer = components["schemas"]["PostQuestionsAnswerRequest"];
export type CommandOutcome =
  | { status: "applied"; sessionId: Id; startedAt: string; endedAt: string | null }
  | { status: "pending"; commandId: Id };
