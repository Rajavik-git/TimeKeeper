// Generated from backend/domain/states. Run npm run contract:gen.
export const AssignmentOrigin = {
  Unresolved: "unresolved",
  Automatic: "automatic",
  Lawyer: "lawyer",
} as const;
export type AssignmentOrigin = (typeof AssignmentOrigin)[keyof typeof AssignmentOrigin];

export const BillingStatus = { Unbilled: "unbilled", Billed: "billed" } as const;
export type BillingStatus = (typeof BillingStatus)[keyof typeof BillingStatus];

export const ValidationStatus = { Unvalidated: "unvalidated", Validated: "validated" } as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const QuestionStatus = {
  Pending: "pending",
  Answered: "answered",
  Superseded: "superseded",
} as const;
export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus];

export const ReconstructionStatus = { Pending: "pending", Resolved: "resolved" } as const;
export type ReconstructionStatus = (typeof ReconstructionStatus)[keyof typeof ReconstructionStatus];

export const NonbillableReason = {
  Offered: "offered",
  Internal: "internal",
  Admin: "admin",
} as const;
export type NonbillableReason = (typeof NonbillableReason)[keyof typeof NonbillableReason];

export const PeriodOpenMode = { Current: "current", Recovery: "recovery" } as const;
export type PeriodOpenMode = (typeof PeriodOpenMode)[keyof typeof PeriodOpenMode];

export const CommandKind = { Start: "start", End: "end" } as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

export const CommandStatus = {
  Pending: "pending",
  Applied: "applied",
  Rejected: "rejected",
} as const;
export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

export const AvailabilityStatus = {
  Unknown: "unknown",
  Available: "available",
  Unavailable: "unavailable",
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

export const CoverageGapStatus = { Pending: "pending", Failed: "failed" } as const;
export type CoverageGapStatus = (typeof CoverageGapStatus)[keyof typeof CoverageGapStatus];

export const DeliveryStatus = {
  Pending: "pending",
  Verified: "verified",
  Failed: "failed",
  Blocked: "blocked",
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const RetrievalStatus = {
  Pending: "pending",
  Complete: "complete",
  Failed: "failed",
} as const;
export type RetrievalStatus = (typeof RetrievalStatus)[keyof typeof RetrievalStatus];

export const CaseStatus = { Active: "active", Archived: "archived" } as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

export const ClientType = { Individual: "individual", Company: "company" } as const;
export type ClientType = (typeof ClientType)[keyof typeof ClientType];

export const ClientBillingMode = { Hourly: "hourly", Subscription: "subscription" } as const;
export type ClientBillingMode = (typeof ClientBillingMode)[keyof typeof ClientBillingMode];

export const CaseBillingMode = { Hourly: "hourly", FlatFee: "flat_fee" } as const;
export type CaseBillingMode = (typeof CaseBillingMode)[keyof typeof CaseBillingMode];

export const BaseUnit = { Hour: "hour", Intervention: "intervention" } as const;
export type BaseUnit = (typeof BaseUnit)[keyof typeof BaseUnit];

export const PillDisplay = { Fees: "fees", Time: "time", Case: "case" } as const;
export type PillDisplay = (typeof PillDisplay)[keyof typeof PillDisplay];

export const ClientRuleType = {
  DailyResearchCap: "daily_research_cap",
  NonbillableTravel: "nonbillable_travel",
} as const;
export type ClientRuleType = (typeof ClientRuleType)[keyof typeof ClientRuleType];

export const SystemTaskCode = {
  Drafting: "REDAC",
  DocumentReview: "ANALY",
  Research: "RECH",
  Correspondence: "MAIL",
  ClientMeeting: "RDV",
  Call: "APPEL",
  Hearing: "AUD",
  Administrative: "ADMIN",
  CaseOrganization: "ORGA",
  Travel: "DEPL",
} as const;
export type SystemTaskCode = (typeof SystemTaskCode)[keyof typeof SystemTaskCode];

export const ExpenseType = { Expense: "expense", Disbursement: "disbursement" } as const;
export type ExpenseType = (typeof ExpenseType)[keyof typeof ExpenseType];

export const InvoiceType = { Deposit: "deposit", Final: "final" } as const;
export type InvoiceType = (typeof InvoiceType)[keyof typeof InvoiceType];

export const InvoiceStatus = { Sent: "sent", Issued: "issued" } as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const InvoiceLineOrigin = {
  WorkPeriod: "work_period",
  FlatFee: "flat_fee",
  Expense: "expense",
} as const;
export type InvoiceLineOrigin = (typeof InvoiceLineOrigin)[keyof typeof InvoiceLineOrigin];

export const RateOrigin = {
  Base: "base",
  Client: "client",
  Case: "matter",
  FlatFee: "flat_fee",
} as const;
export type RateOrigin = (typeof RateOrigin)[keyof typeof RateOrigin];

export const MarkerType = {
  Reference: "reference",
  CaseNumber: "case_number",
  OpposingParty: "opposing_party",
  ClientName: "client_name",
  File: "file",
  Email: "email",
  Domain: "domain",
  Keyword: "keyword",
} as const;
export type MarkerType = (typeof MarkerType)[keyof typeof MarkerType];

export const SignalPlace = {
  App: "app",
  WindowTitle: "window_title",
  BrowserUrl: "browser_url",
  Ocr: "ocr",
  Audio: "audio",
  Speaker: "speaker",
} as const;
export type SignalPlace = (typeof SignalPlace)[keyof typeof SignalPlace];

export const SourcePackScope = {
  Invoice: "invoice",
  Case: "case",
  DateRange: "dateRange",
  SelectedPeriods: "selectedPeriods",
} as const;
export type SourcePackScope = (typeof SourcePackScope)[keyof typeof SourcePackScope];

export const SourcePackOption = {
  Blur: "blur",
  Personal: "personal",
  Audio: "audio",
  Audit: "audit",
} as const;
export type SourcePackOption = (typeof SourcePackOption)[keyof typeof SourcePackOption];
