import type { BillingStatus } from "../domain/states.js";
import { SessionCommandService } from "./session-commands.js";
import { PeriodAssignmentService } from "./period-assignment.js";
import { EvidenceService } from "./evidence.js";
import type {
  CommandOutcome,
  EndCommand,
  PeriodView,
  QuestionAnswer,
  StartCommand,
} from "../../contracts/index.js";
import type { Clock } from "../ports/index.js";
import type { PeriodQuery, Repository, SessionRecord } from "../ports/repository.js";

import { AppError } from "./errors.js";
export { AppError } from "./errors.js";
import { PeriodReviewService, type PeriodDetails } from "./period-review.js";
import { periodView as view } from "./period-view.js";
import { PeriodLifecycleService } from "./period-lifecycle.js";
import { CatalogProvisioningService } from "./catalog-provisioning.js";
export class TimeKeeperService {
  private readonly provisioning: CatalogProvisioningService;
  private readonly lifecycle: PeriodLifecycleService;
  private readonly periodReview: PeriodReviewService;
  private readonly sessionCommands: SessionCommandService;
  private readonly evidence: EvidenceService;
  private readonly assignment: PeriodAssignmentService;
  constructor(
    private readonly repo: Repository,
    clock: Clock = { now: () => new Date().toISOString() },
  ) {
    this.provisioning = new CatalogProvisioningService(repo, clock);
    this.lifecycle = new PeriodLifecycleService(repo, clock);
    this.assignment = new PeriodAssignmentService(repo, clock);
    this.sessionCommands = new SessionCommandService(repo, clock);
    this.evidence = new EvidenceService(repo, clock);
    this.periodReview = new PeriodReviewService(repo, clock, (input) => this.askQuestion(input));
  }
  start(command: StartCommand): CommandOutcome {
    return this.sessionCommands.start(command);
  }
  end(command: EndCommand): CommandOutcome {
    return this.sessionCommands.end(command);
  }
  createClient(...args: Parameters<CatalogProvisioningService["createClient"]>): void {
    this.provisioning.createClient(...args);
  }
  createCase(...args: Parameters<CatalogProvisioningService["createCase"]>): void {
    this.provisioning.createCase(...args);
  }
  setGlobalRate(...args: Parameters<CatalogProvisioningService["setGlobalRate"]>): void {
    this.provisioning.setGlobalRate(...args);
  }
  currentRateForCase(id: string): number {
    return this.provisioning.currentRateForCase(id);
  }
  getSession(id: string): SessionRecord {
    const s = this.repo.session(id);
    if (!s) throw new AppError("not-found", "session not found");
    return s;
  }
  activeSession(): SessionRecord | null {
    return this.repo.activeSession();
  }
  listSessions(): SessionRecord[] {
    return this.repo.listSessions();
  }
  queryPeriods(query: PeriodQuery = {}): Array<PeriodView & { clientId: string | null }> {
    return this.repo.queryPeriods(query).map((p) => ({ ...view(p), clientId: p.clientId }));
  }
  allPeriods(): Array<PeriodView & { clientId: string | null }> {
    return this.queryPeriods();
  }
  allQuestions() {
    return this.repo.allQuestions();
  }
  allSources() {
    return this.repo.allSources();
  }
  coverageGaps() {
    return this.repo.coverageGaps();
  }
  getPeriod(id: string): PeriodView {
    const p = this.repo.period(id);
    if (!p) throw new AppError("not-found", "period not found");
    return view(p);
  }
  listPeriods(sessionId: string): Array<PeriodView & { clientId: string | null }> {
    this.getSession(sessionId);
    return this.queryPeriods({ sessionId });
  }
  listSources(periodId: string) {
    this.getPeriod(periodId);
    return this.repo.listSources(periodId);
  }
  openPeriod(
    ...args: Parameters<PeriodLifecycleService["openPeriod"]>
  ): ReturnType<PeriodLifecycleService["openPeriod"]> {
    return this.lifecycle.openPeriod(...args);
  }
  recordCaseTransition(
    input: Parameters<PeriodLifecycleService["recordCaseTransition"]>[0],
  ): ReturnType<PeriodLifecycleService["recordCaseTransition"]> {
    return this.lifecycle.recordCaseTransition(input);
  }
  undoPeriodSwitch(...args: Parameters<PeriodLifecycleService["undoSwitch"]>): void {
    this.lifecycle.undoSwitch(...args);
  }
  restorePeriodAssignment(...args: Parameters<PeriodAssignmentService["restoreAssignment"]>): void {
    this.assignment.restoreAssignment(...args);
  }
  restorePeriodValidation(...args: Parameters<PeriodReviewService["restoreValidation"]>): void {
    this.periodReview.restoreValidation(...args);
  }
  assignPeriod(...args: Parameters<PeriodAssignmentService["assignPeriod"]>): PeriodView {
    return this.assignment.assignPeriod(...args);
  }
  askQuestion(input: Parameters<PeriodAssignmentService["askQuestion"]>[0]): string {
    return this.assignment.askQuestion(input);
  }
  answerQuestion(input: QuestionAnswer): PeriodView {
    return this.assignment.answerQuestion(input);
  }
  reconstructionConflicts() {
    return this.repo.reconstructionConflicts();
  }
  setDetectedDuration(id: string, durationMs: number | null): PeriodView {
    return this.periodReview.setDetectedDuration(id, durationMs);
  }
  setDurationOverride(
    id: string,
    durationMs: number | null,
    expectedRevision?: number,
  ): PeriodView {
    return this.periodReview.setDurationOverride(id, durationMs, expectedRevision);
  }
  createManualPeriod(
    input: Parameters<PeriodLifecycleService["createManualPeriod"]>[0],
  ): PeriodView {
    return this.lifecycle.createManualPeriod(input);
  }
  updatePeriodDetails(id: string, changes: PeriodDetails, expectedRevision?: number): PeriodView {
    return this.periodReview.updatePeriodDetails(id, changes, expectedRevision);
  }
  validatePeriod(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.periodReview.validatePeriod(id, expectedEffectiveRevision);
  }
  validatePeriods(inputs: Parameters<PeriodReviewService["validatePeriods"]>[0]): PeriodView[] {
    return this.periodReview.validatePeriods(inputs);
  }
  clearTimeValidation(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.periodReview.clearTimeValidation(id, expectedEffectiveRevision);
  }
  setBillingStatus(id: string, status: BillingStatus, expectedRevision?: number): PeriodView {
    return this.periodReview.setBillingStatus(id, status, expectedRevision);
  }
  importSource(input: Parameters<EvidenceService["importSource"]>[0]) {
    return this.evidence.importSource(input);
  }
  importRetrievedSource(input: Parameters<EvidenceService["importRetrievedSource"]>[0]) {
    return this.evidence.importRetrievedSource(input);
  }
  importSources(inputs: Parameters<EvidenceService["importSources"]>[0]) {
    return this.evidence.importSources(inputs);
  }
  validateSource(
    instanceId: string,
    contentType: string,
    externalId: string,
    validated = true,
  ): void {
    this.evidence.validateSource(instanceId, contentType, externalId, validated);
  }
  setSourceAvailability(...args: Parameters<EvidenceService["setSourceAvailability"]>): void {
    this.evidence.setSourceAvailability(...args);
  }
  proposeReconstruction(input: Parameters<EvidenceService["proposeReconstruction"]>[0]): void {
    this.evidence.proposeReconstruction(input);
  }
}
