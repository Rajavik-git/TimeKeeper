import { stateValues, type StateValue } from "./values.js";

export const AssignmentOrigin = {
  Unresolved: "unresolved",
  Automatic: "automatic",
  Lawyer: "lawyer",
} as const;
export type AssignmentOrigin = StateValue<typeof AssignmentOrigin>;
export const assignmentOrigins = stateValues(AssignmentOrigin);

export const BillingStatus = {
  Unbilled: "unbilled",
  Billed: "billed",
} as const;
export type BillingStatus = StateValue<typeof BillingStatus>;
export const billingStatuses = stateValues(BillingStatus);

export const ValidationStatus = {
  Unvalidated: "unvalidated",
  Validated: "validated",
} as const;
export type ValidationStatus = StateValue<typeof ValidationStatus>;
export const validationStatuses = stateValues(ValidationStatus);

export const QuestionStatus = {
  Pending: "pending",
  Answered: "answered",
  Superseded: "superseded",
} as const;
export type QuestionStatus = StateValue<typeof QuestionStatus>;
export const questionStatuses = stateValues(QuestionStatus);

export const ReconstructionStatus = {
  Pending: "pending",
  Resolved: "resolved",
} as const;
export type ReconstructionStatus = StateValue<typeof ReconstructionStatus>;
export const reconstructionStatuses = stateValues(ReconstructionStatus);

export const NonbillableReason = {
  Offered: "offered",
  Internal: "internal",
  Admin: "admin",
} as const;
export type NonbillableReason = StateValue<typeof NonbillableReason>;
export const nonbillableReasons = stateValues(NonbillableReason);

export const PeriodOpenMode = {
  Current: "current",
  Recovery: "recovery",
} as const;
export type PeriodOpenMode = StateValue<typeof PeriodOpenMode>;
export const periodOpenModes = stateValues(PeriodOpenMode);
