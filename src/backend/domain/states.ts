import type { StateValue } from "./states/values.js";
import {
  AssignmentOrigin,
  BillingStatus,
  ValidationStatus,
  QuestionStatus,
  ReconstructionStatus,
  NonbillableReason,
  PeriodOpenMode,
} from "./states/period.js";
import { CommandKind, CommandStatus } from "./states/session.js";
import {
  AvailabilityStatus,
  CoverageGapStatus,
  DeliveryStatus,
  RetrievalStatus,
} from "./states/evidence.js";
import {
  CaseStatus,
  ClientType,
  ClientBillingMode,
  CaseBillingMode,
  BaseUnit,
  PillDisplay,
  ClientRuleType,
  SystemTaskCode,
} from "./states/catalog.js";
import {
  ExpenseType,
  InvoiceType,
  InvoiceStatus,
  InvoiceLineOrigin,
  RateOrigin,
} from "./states/billing.js";
import { SourcePackScope, SourcePackOption } from "./states/source-export.js";
import { MarkerType, SignalPlace } from "./states/recognition.js";

/** Public domain vocabulary. SQL migration history keeps its original literals. */
export * from "./states/period.js";
export * from "./states/session.js";
export * from "./states/evidence.js";
export * from "./states/catalog.js";
export * from "./states/billing.js";
export * from "./states/recognition.js";
export * from "./states/source-export.js";
export { isState } from "./states/values.js";

/** Runtime objects also generate named API schemas and frontend constants. */
export const stateObjects = {
  AssignmentOrigin,
  BillingStatus,
  ValidationStatus,
  QuestionStatus,
  ReconstructionStatus,
  NonbillableReason,
  PeriodOpenMode,
  CommandKind,
  CommandStatus,
  AvailabilityStatus,
  CoverageGapStatus,
  DeliveryStatus,
  RetrievalStatus,
  CaseStatus,
  ClientType,
  ClientBillingMode,
  CaseBillingMode,
  BaseUnit,
  PillDisplay,
  ClientRuleType,
  SystemTaskCode,
  ExpenseType,
  InvoiceType,
  InvoiceStatus,
  InvoiceLineOrigin,
  RateOrigin,
  MarkerType,
  SignalPlace,
  SourcePackScope,
  SourcePackOption,
} as const;

type StateDefinitions = {
  readonly [Name in keyof typeof stateObjects]: readonly StateValue<(typeof stateObjects)[Name]>[];
};

// Object.fromEntries loses literal keys; this mapping preserves every registry key.
export const stateDefinitions = Object.fromEntries(
  Object.entries(stateObjects).map(([name, members]) => [name, Object.values(members)]),
) as unknown as StateDefinitions;
