export type Id = string;
export type Revision = number;
export type ErrorCode = 'invalid-request' | 'not-found' | 'no-active-session' | 'conflict' | 'rule-not-decided' | 'forbidden-origin' | 'internal';
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
  validatedEffectiveRevision: Revision | null; timeValidated: boolean; timeValidatedAt: string | null;
  billingStatus: 'unbilled' | 'billed';
  appliedHourlyRateCents?: number | null; appliedCurrency?: string | null;
  taskTypeId?: number | null; label?: string; billable?: boolean; nonbillableReason?: string | null;
  excluded?: boolean; demoApp?: string | null; demoWindowTitle?: string | null; demoConfidence?: number | null;
  invoiceId?: number | null;
}
export interface QuestionAnswer {
  questionId: Id; sessionId: Id; periodId: Id; expectedAssignmentRevision: Revision;
  caseId: Id; responseCommandId: Id;
}
export type CommandOutcome = { status: 'applied'; sessionId: Id; startedAt: string; endedAt: string | null } | { status: 'pending'; commandId: Id };
