import type {
  AssignmentOrigin,
  NonbillableReason,
  BillingStatus,
  QuestionStatus,
  CommandKind,
  CommandStatus,
  ValidationStatus,
  AvailabilityStatus,
  CoverageGapStatus,
  ReconstructionStatus,
} from "../domain/states.js";
import type { PeriodState } from "../domain/rules.js";

export interface SessionRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  revision: number;
}
export interface PeriodRecord extends PeriodState {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  initialCaseId: string | null;
  initialOrigin: AssignmentOrigin;
  billingStatus: BillingStatus;
  billedAt: string | null;
  revision: number;
  appliedHourlyRateCents?: number | null;
  appliedCurrency?: string | null;
  taskTypeId?: number | null;
  label?: string;
  billable?: boolean;
  nonbillableReason?: NonbillableReason | null;
  excluded?: boolean;
  demoApp?: string | null;
  demoWindowTitle?: string | null;
  demoConfidence?: number | null;
  invoiceId?: number | null;
}
export interface QuestionRecord {
  questionId: string;
  sessionId: string;
  periodId: string;
  expectedAssignmentRevision: number;
  status: QuestionStatus;
  responseCommandId: string | null;
  responseResultJson: string | null;
}
export interface CommandRecord {
  producerId: string;
  commandId: string;
  kind: CommandKind;
  payloadFingerprint: string;
  sessionId: string;
  status: CommandStatus;
  prerequisiteId: string | null;
  payloadJson: string;
  resultJson: string | null;
}
export interface SourceRecord {
  excerpt?: string | null;
  detectedMarker?: string | null;
  id: string;
  workPeriodId: string | null;
  instanceId: string;
  contentType: string;
  externalId: string;
  recordedAt: string;
  ingestedAt: string;
  validationStatus: ValidationStatus;
  validatedAt: string | null;
  availabilityStatus: AvailabilityStatus;
  availabilityCheckedAt: string | null;
}
export interface CoverageGap {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  status: CoverageGapStatus;
}
export interface ReconstructionConflict {
  id: string;
  periodId: string;
  sessionId: string;
  expectedRevision: number;
  proposedStartedAt: string;
  proposedEndedAt: string | null;
  sourceReferences: string[];
  status: ReconstructionStatus;
}
/** Half-open instant boundaries, resolved from calendar filters by the application. */
export interface PeriodQuery {
  startedFrom?: string;
  startedBefore?: string;
  sessionId?: string;
  caseId?: string;
  clientId?: string;
}
export interface QueriedPeriod extends PeriodRecord {
  clientId: string | null;
}
export interface Repository {
  queryPeriods(query: PeriodQuery): QueriedPeriod[];
  reconstructionConflicts(): ReconstructionConflict[];
  transaction<T>(work: () => T): T;
  activeSession(): SessionRecord | null;
  listSessions(): SessionRecord[];
  session(id: string): SessionRecord | null;
  insertSession(session: SessionRecord, now: string): void;
  endSession(id: string, endedAt: string, now: string): void;
  command(producerId: string, commandId: string): CommandRecord | null;
  saveCommand(command: CommandRecord, now: string): void;
  pendingDependents(producerId: string, prerequisiteId: string): CommandRecord[];
  period(id: string): PeriodRecord | null;
  /** Reads a final, explicitly requested reason while strictly decoding all other stored fields. */
  periodForNonbillableReasonRepair(
    id: string,
    reason: NonbillableReason | null,
  ): PeriodRecord | null;
  activePeriod(sessionId: string): PeriodRecord | null;
  periodAt(sessionId: string, at: string): PeriodRecord | null;
  nextPeriodAfter(sessionId: string, at: string): PeriodRecord | null;
  listPeriods(sessionId: string): PeriodRecord[];
  allPeriods(): PeriodRecord[];
  insertPeriod(period: PeriodRecord, now: string): void;
  savePeriod(period: PeriodRecord, now: string): void;
  /** Removes an unreferenced period and its questions; dependent records keep it. */
  deletePeriod(id: string): void;
  sourceRelocatedFrom(sourceId: string, periodId: string): boolean;
  canSplitSources(periodId: string, at: string): boolean;
  moveSplitSources(fromId: string, toId: string, at: string): void;
  caseExists(id: string): boolean;
  createClient(id: string, name: string, now: string): void;
  createCase(
    id: string,
    clientId: string,
    reference: string,
    title: string,
    hourlyRateCents: number | null,
    now: string,
  ): void;
  setGlobalRate(rateCents: number, currency: string, workspaceId: string, now: string): void;
  rateForCase(id: string): {
    caseRateCents: number | null;
    clientRateCents?: number | null;
    globalRateCents: number | null;
    currency: string | null;
  } | null;
  clientForCase(id: string): string | null;
  question(id: string): QuestionRecord | null;
  allQuestions(): QuestionRecord[];
  saveQuestion(question: QuestionRecord): void;
  sourceByIdentity(
    instanceId: string,
    contentType: string,
    externalId: string,
  ): SourceRecord | null;
  listSources(periodId: string): SourceRecord[];
  allSources(): SourceRecord[];
  coverageGaps(): CoverageGap[];
  insertSource(source: SourceRecord): void;
  saveSource(source: SourceRecord): void;
  insertConflict(
    id: string,
    periodId: string,
    expectedRevision: number,
    startedAt: string,
    endedAt: string | null,
    sourceReferencesJson: string,
  ): void;
}
