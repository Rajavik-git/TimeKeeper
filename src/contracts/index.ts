export type Id = string;
export type Revision = number;
export type ErrorCode = 'no-active-session' | 'not-found' | 'conflict' | 'pending' | 'invalid-request';
export interface ApiError { error: ErrorCode; message: string }
export interface StartCommand {
  producerId: Id; commandId: Id; sessionId: Id; occurredAt: string;
  prerequisiteCommandId?: Id;
}
export interface EndCommand {
  producerId: Id; commandId: Id; sessionId: Id; occurredAt: string;
  prerequisiteCommandId?: Id;
}
export interface PeriodView {
  id: Id; sessionId: Id; caseId: Id | null; startedAt: string; endedAt: string | null;
  detectedDurationMs: number | null; durationOverrideMs: number | null;
  assignmentRevision: Revision; effectiveRevision: Revision;
  validatedEffectiveRevision: Revision | null; timeValidated: boolean;
  billingStatus: 'unbilled' | 'billed';
}
export interface QuestionAnswer {
  questionId: Id; sessionId: Id; periodId: Id; expectedAssignmentRevision: Revision;
  caseId: Id; responseCommandId: Id;
}
export type CommandOutcome = { status: 'applied'; sessionId: Id; startedAt: string; endedAt: string | null } | { status: 'pending'; commandId: Id };
