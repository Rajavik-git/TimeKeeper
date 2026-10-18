import {
  AssignmentOrigin,
  BillingStatus,
  QuestionStatus,
  ReconstructionStatus,
  PeriodOpenMode,
} from "../domain/states.js";
import { randomUUID } from "node:crypto";
import { assertId, assertTime } from "./assertions.js";
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
import { timeIsValidated, resolveRate } from "../domain/rules.js";
import type { Clock } from "../ports/index.js";
import type { PeriodRecord, PeriodQuery, Repository, SessionRecord } from "../ports/repository.js";

import { AppError } from "./errors.js";
export { AppError } from "./errors.js";
import { PeriodReviewService, type PeriodDetails } from "./period-review.js";
import { periodView as view } from "./period-view.js";
export class TimeKeeperService {
  private readonly periodReview: PeriodReviewService;
  private readonly sessionCommands: SessionCommandService;
  private readonly evidence: EvidenceService;
  private readonly assignment: PeriodAssignmentService;
  constructor(
    private readonly repo: Repository,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {
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
  createClient(id: string, name: string): void {
    assertId(id);
    if (!name.trim()) throw new AppError("invalid-request", "client name required");
    this.repo.transaction(() => this.repo.createClient(id, name, this.clock.now()));
  }
  createCase(
    id: string,
    clientId: string,
    reference: string,
    title: string,
    hourlyRateCents: number | null,
  ): void {
    assertId(id);
    assertId(clientId);
    if (
      !reference.trim() ||
      !title.trim() ||
      (hourlyRateCents !== null && (!Number.isSafeInteger(hourlyRateCents) || hourlyRateCents < 0))
    )
      throw new AppError("invalid-request", "invalid case");
    this.repo.transaction(() =>
      this.repo.createCase(id, clientId, reference, title, hourlyRateCents, this.clock.now()),
    );
  }
  setGlobalRate(rateCents: number, currency: string, workspaceId: string): void {
    if (!Number.isSafeInteger(rateCents) || rateCents < 0 || !/^[A-Z]{3}$/.test(currency))
      throw new AppError("invalid-request", "invalid rate or currency");
    assertId(workspaceId);
    this.repo.transaction(() =>
      this.repo.setGlobalRate(rateCents, currency, workspaceId, this.clock.now()),
    );
  }
  currentRateForCase(id: string): number {
    const rates = this.repo.rateForCase(id);
    if (!rates) throw new AppError("not-found", "case or global rate not found");
    const rate = resolveRate(
      rates.caseRateCents,
      rates.globalRateCents,
      rates.clientRateCents ?? null,
    );
    if (rate === null) throw new AppError("pending", "global hourly rate is not configured");
    return rate;
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
  // The caller supplies an explicit established transition. Folder recognition and duration derivation remain open: docs/REQUIREMENTS.md.
  openPeriod(input: {
    id: string;
    sessionId: string;
    caseId: string | null;
    startedAt: string;
    origin: AssignmentOrigin;
    mode: PeriodOpenMode;
    /** Observed window that triggered the transition, shown in My day and Activity. */
    window?: { appName: string; title: string };
  }): PeriodView | { status: typeof ReconstructionStatus.Pending; conflictId: string } {
    return this.repo.transaction(() => {
      assertId(input.id);
      assertTime(input.startedAt);
      const existing = this.repo.period(input.id);
      if (existing) {
        if (
          existing.sessionId !== input.sessionId ||
          existing.initialCaseId !== input.caseId ||
          existing.startedAt !== input.startedAt ||
          existing.initialOrigin !== input.origin
        )
          throw new AppError("conflict", "period ID reused with different transition");
        return view(existing);
      }
      const s = this.getSession(input.sessionId);
      if (
        Date.parse(input.startedAt) < Date.parse(s.startedAt) ||
        (s.endedAt !== null && Date.parse(input.startedAt) > Date.parse(s.endedAt))
      )
        throw new AppError("conflict", "period outside session");
      if (input.caseId !== null && !this.repo.caseExists(input.caseId))
        throw new AppError("not-found", "case not found");
      const active = this.repo.periodAt(s.id, input.startedAt);
      if (active) {
        if (Date.parse(input.startedAt) <= Date.parse(active.startedAt))
          throw new AppError("conflict", "transition at existing period start");
        if (
          ((input.mode === PeriodOpenMode.Recovery ||
            active.endedAt !== null ||
            s.endedAt !== null) &&
            (active.assignmentOrigin === AssignmentOrigin.Lawyer ||
              active.detectedDurationMs !== null ||
              active.durationOverrideMs !== null ||
              timeIsValidated(active))) ||
          !this.repo.canSplitSources(active.id, input.startedAt)
        ) {
          this.repo.insertConflict(
            input.id,
            active.id,
            active.revision,
            input.startedAt,
            active.endedAt ?? s.endedAt,
            "[]",
          );
          return { status: ReconstructionStatus.Pending, conflictId: input.id };
        }
        this.repo.savePeriod(
          { ...active, endedAt: input.startedAt, revision: active.revision + 1 },
          this.clock.now(),
        );
      }
      const nextPeriod = this.repo.nextPeriodAfter(s.id, input.startedAt);
      const p: PeriodRecord = {
        id: input.id,
        sessionId: s.id,
        caseId: input.caseId,
        initialCaseId: input.caseId,
        initialOrigin: input.origin,
        startedAt: input.startedAt,
        endedAt: active?.endedAt ?? nextPeriod?.startedAt ?? s.endedAt,
        detectedDurationMs: null,
        durationOverrideMs: null,
        assignmentOrigin: input.origin,
        assignmentRevision: 0,
        effectiveRevision: 0,
        validatedEffectiveRevision: null,
        timeValidatedAt: null,
        billingStatus: BillingStatus.Unbilled,
        billedAt: null,
        revision: 0,
        ...(input.window
          ? {
              label: input.window.title,
              demoApp: input.window.appName,
              demoWindowTitle: input.window.title,
            }
          : {}),
      };
      this.repo.insertPeriod(p, this.clock.now());
      if (active) this.repo.moveSplitSources(active.id, p.id, input.startedAt);
      if (p.caseId === null)
        this.repo.saveQuestion({
          questionId: `period:${p.id}`,
          sessionId: p.sessionId,
          periodId: p.id,
          expectedAssignmentRevision: p.assignmentRevision,
          status: QuestionStatus.Pending,
          responseCommandId: null,
          responseResultJson: null,
        });
      return view(p);
    });
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
  createManualPeriod(input: {
    sessionId: string;
    caseId: string;
    startedAt: string;
    durationMs: number;
    taskTypeId: number;
    label: string;
  }): PeriodView {
    return this.repo.transaction(() => {
      assertTime(input.startedAt);
      if (
        !Number.isSafeInteger(input.durationMs) ||
        input.durationMs < 0 ||
        !Number.isSafeInteger(input.taskTypeId) ||
        input.taskTypeId < 1 ||
        !input.label.trim()
      )
        throw new AppError("invalid-request", "invalid manual period");
      const session = this.getSession(input.sessionId);
      if (!this.repo.caseExists(input.caseId)) throw new AppError("not-found", "case not found");
      const end = new Date(Date.parse(input.startedAt) + input.durationMs).toISOString();
      if (
        Date.parse(input.startedAt) < Date.parse(session.startedAt) ||
        (session.endedAt !== null && Date.parse(end) > Date.parse(session.endedAt))
      )
        throw new AppError("conflict", "manual period outside session");
      const id = randomUUID();
      const period: PeriodRecord = {
        id,
        sessionId: session.id,
        caseId: input.caseId,
        initialCaseId: input.caseId,
        initialOrigin: AssignmentOrigin.Lawyer,
        startedAt: input.startedAt,
        endedAt: end,
        detectedDurationMs: null,
        durationOverrideMs: input.durationMs,
        assignmentOrigin: AssignmentOrigin.Lawyer,
        assignmentRevision: 0,
        effectiveRevision: 0,
        validatedEffectiveRevision: null,
        timeValidatedAt: null,
        billingStatus: BillingStatus.Unbilled,
        billedAt: null,
        revision: 0,
        taskTypeId: input.taskTypeId,
        label: input.label,
        billable: true,
        excluded: false,
      };
      this.repo.insertPeriod(period, this.clock.now());
      return view(period);
    });
  }
  updatePeriodDetails(id: string, changes: PeriodDetails, expectedRevision?: number): PeriodView {
    return this.periodReview.updatePeriodDetails(id, changes, expectedRevision);
  }
  validatePeriod(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.periodReview.validatePeriod(id, expectedEffectiveRevision);
  }
  clearTimeValidation(id: string): PeriodView {
    return this.periodReview.clearTimeValidation(id);
  }
  setBillingStatus(id: string, status: BillingStatus, expectedRevision?: number): PeriodView {
    return this.periodReview.setBillingStatus(id, status, expectedRevision);
  }
  importSource(input: Parameters<EvidenceService["importSource"]>[0]): void {
    this.evidence.importSource(input);
  }
  validateSource(instanceId: string, contentType: string, externalId: string): void {
    this.evidence.validateSource(instanceId, contentType, externalId);
  }
  setSourceAvailability(...args: Parameters<EvidenceService["setSourceAvailability"]>): void {
    this.evidence.setSourceAvailability(...args);
  }
  proposeReconstruction(input: Parameters<EvidenceService["proposeReconstruction"]>[0]): void {
    this.evidence.proposeReconstruction(input);
  }
}
