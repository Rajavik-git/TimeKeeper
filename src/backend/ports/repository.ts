import type { PeriodState } from '../domain/rules.js';

export interface SessionRecord { id: string; startedAt: string; endedAt: string | null; revision: number }
export interface PeriodRecord extends PeriodState {
  id: string; sessionId: string; startedAt: string; endedAt: string | null; initialCaseId: string | null; initialOrigin: 'unresolved' | 'automatic' | 'lawyer';
  billingStatus: 'unbilled' | 'billed'; billedAt: string | null; revision: number;
  appliedHourlyRateCents?: number | null; appliedCurrency?: string | null;
  taskTypeId?: number | null; label?: string; billable?: boolean; nonbillableReason?: string | null;
  excluded?: boolean; demoApp?: string | null; demoWindowTitle?: string | null; demoConfidence?: number | null;
  invoiceId?: number | null;
}
export interface QuestionRecord {
  questionId: string; sessionId: string; periodId: string;
  expectedAssignmentRevision: number; status: 'pending' | 'answered' | 'superseded';
  responseCommandId: string | null; responseResultJson: string | null;
}
export interface CommandRecord {
  producerId: string; commandId: string; kind: 'start' | 'end';
  payloadFingerprint: string; sessionId: string; status: 'pending' | 'applied' | 'rejected';
  prerequisiteId: string | null; payloadJson: string; resultJson: string | null;
}
export interface SourceRecord {
  id: string; workPeriodId: string | null; instanceId: string; contentType: string;
  externalId: string; recordedAt: string; ingestedAt: string;
  validationStatus: 'unvalidated' | 'validated'; validatedAt: string | null; availabilityStatus: 'unknown' | 'available' | 'unavailable'; availabilityCheckedAt: string | null;
}
export interface CoverageGap { id:string; sessionId:string; startedAt:string; endedAt:string; status:'pending'|'failed' }
/** One time window read from Screenpipe for a session (docs/API.md D8 step 4). */
export interface RetrievalWindow { id: string; sessionId: string; instanceId: string; startAt: string; endAt: string }
export interface ClientRecord {
  id: string; name: string; code: string | null; type: string; mode: string;
  hourlyRateCents: number | null; vatApplicable: boolean; active: boolean;
}
export interface CaseRecord {
  id: string; clientId: string; reference: string; title: string; category: string; caseNumber: string;
  opposingParty: string; status: 'active' | 'archived'; mode: 'hourly' | 'flat_fee';
  hourlyRateCents: number | null; flatFeeCents: number | null; budgetCents: number | null; openedOn: string | null;
}
export interface SettingsRecord {
  globalHourlyRateCents: number; currency: string; workspaceId: string; vatRate: number; confidenceThreshold: number;
}
export interface Repository {
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
  activePeriod(sessionId: string): PeriodRecord | null;
  periodAt(sessionId: string, at: string): PeriodRecord | null;
  nextPeriodAfter(sessionId: string, at: string): PeriodRecord | null;
  listPeriods(sessionId: string): PeriodRecord[];
  allPeriods(): PeriodRecord[];
  insertPeriod(period: PeriodRecord, now: string): void;
  savePeriod(period: PeriodRecord, now: string): void;
  caseExists(id: string): boolean;
  listClients(): ClientRecord[];
  listCases(filter: { clientId?: string; status?: 'active' | 'archived' }): CaseRecord[];
  settings(): SettingsRecord | null;
  /** End of the latest completely read window, or null when nothing was read yet. */
  retrievalCheckpoint(sessionId: string, instanceId: string): string | null;
  saveRetrieval(window: RetrievalWindow, status: 'pending' | 'complete' | 'failed', now: string): void;
  /** Windows are read in order from the checkpoint, so unfinished windows ending by `upTo` are now covered: mark them read. */
  closeRetrievalGaps(sessionId: string, instanceId: string, upTo: string, now: string): void;
  createClient(id: string, name: string, now: string): void;
  createCase(id: string, clientId: string, reference: string, title: string, hourlyRateCents: number | null, now: string): void;
  setGlobalRate(rateCents: number, currency: string, workspaceId: string, now: string): void;
  rateForCase(id: string): { caseRateCents: number | null; clientRateCents?: number | null; globalRateCents: number | null } | null;
  clientForCase(id: string): string | null;
  question(id: string): QuestionRecord | null;
  allQuestions(): QuestionRecord[];
  saveQuestion(question: QuestionRecord): void;
  sourceByIdentity(instanceId: string, contentType: string, externalId: string): SourceRecord | null;
  listSources(periodId: string): SourceRecord[];
  allSources(): SourceRecord[];
  coverageGaps(): CoverageGap[];
  insertSource(source: SourceRecord): void;
  saveSource(source: SourceRecord): void;
  insertConflict(id: string, periodId: string, expectedRevision: number, startedAt: string, endedAt: string | null, sourceReferencesJson: string): void;
}
