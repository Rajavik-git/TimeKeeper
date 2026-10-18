import { createHash, randomUUID } from "node:crypto";
import {
  AssignmentOrigin,
  BillingStatus,
  QuestionStatus,
  ReconstructionStatus,
  PeriodOpenMode,
} from "../domain/states.js";
import { timeIsValidated } from "../domain/rules.js";
import type { PeriodView } from "../../contracts/index.js";
import type { Clock } from "../ports/index.js";
import type { PeriodRecord, Repository } from "../ports/repository.js";
import { assertId, assertTime } from "./assertions.js";
import { AppError } from "./errors.js";
import { periodView as view } from "./period-view.js";

type LifecycleRepository = Pick<
  Repository,
  | "transaction"
  | "period"
  | "session"
  | "activeSession"
  | "activePeriod"
  | "queryPeriods"
  | "periodAt"
  | "nextPeriodAfter"
  | "caseExists"
  | "canSplitSources"
  | "insertConflict"
  | "reconstructionFingerprint"
  | "savePeriod"
  | "insertPeriod"
  | "moveSplitSources"
  | "saveQuestion"
  | "deletePeriod"
  | "listSources"
>;
/** Owns period boundaries, reconstruction safeguards and manual creation. */
export class PeriodLifecycleService {
  constructor(
    private readonly repo: LifecycleRepository,
    private readonly clock: Clock,
  ) {}
  private getSession(id: string) {
    const session = this.repo.session(id);
    if (!session) throw new AppError("not-found", "session not found");
    return session;
  }
  // The caller supplies an explicit established transition. Folder recognition and duration derivation remain open: docs/REQUIREMENTS.md.
  openPeriod(
    input: {
      id: string;
      sessionId: string;
      caseId: string | null;
      startedAt: string;
      origin: AssignmentOrigin;
      mode: PeriodOpenMode;
      /** Observed window that triggered the transition, shown in My day and Activity. */
      window?: { appName: string; title: string };
    },
    transitionFingerprint?: string,
  ): PeriodView | { status: typeof ReconstructionStatus.Pending; conflictId: string } {
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
            transitionFingerprint,
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
              observedAppName: input.window.appName,
              observedWindowTitle: input.window.title,
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
  recordCaseTransition(
    input: Parameters<PeriodLifecycleService["openPeriod"]>[0] & {
      expectedActivePeriodId: string | null;
      expectedAssignmentRevision: number | null;
    },
  ): ReturnType<PeriodLifecycleService["openPeriod"]> {
    return this.repo.transaction(() => {
      assertId(input.id);
      assertTime(input.startedAt);
      if (this.repo.period(input.id)) return this.openPeriod(input);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            sessionId: input.sessionId,
            caseId: input.caseId,
            startedAt: input.startedAt,
            origin: input.origin,
            mode: input.mode,
          }),
        )
        .digest("hex");
      const storedFingerprint = this.repo.reconstructionFingerprint(input.id);
      if (storedFingerprint !== undefined) {
        if (storedFingerprint !== fingerprint)
          throw new AppError(
            "conflict",
            "proposal ID reused or legacy proposal identity is unknown",
          );
        return { status: ReconstructionStatus.Pending, conflictId: input.id };
      }
      const session = this.repo.activeSession();
      if (!session || session.id !== input.sessionId)
        throw new AppError("conflict", "active session changed");
      const active = this.repo
        .queryPeriods({ sessionId: session.id })
        .find((period) => period.endedAt === null);
      if (
        (active?.id ?? null) !== input.expectedActivePeriodId ||
        (active?.assignmentRevision ?? null) !== input.expectedAssignmentRevision
      )
        throw new AppError("conflict", "active period assignment changed");
      if (input.mode !== PeriodOpenMode.Current)
        throw new AppError("invalid-request", "guarded transitions must be current");
      if (active && active.caseId === input.caseId) return view(active);
      if (
        active &&
        (active.durationOverrideMs !== null || timeIsValidated(active)) &&
        input.origin !== AssignmentOrigin.Lawyer
      )
        return this.openPeriod({ ...input, mode: PeriodOpenMode.Recovery }, fingerprint);
      return this.openPeriod(input, fingerprint);
    });
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
  /** Removes an unchanged switch period and reopens its predecessor atomically. */
  undoSwitch(createdId: string, expectedRevision: number, previous?: PeriodRecord): void {
    this.repo.transaction(() => {
      const created = this.repo.period(createdId);
      if (
        !created ||
        created.revision !== expectedRevision ||
        created.billingStatus === BillingStatus.Billed
      )
        throw new AppError("conflict", "period changed since the decision");
      if (
        this.repo.activePeriod(created.sessionId)?.id !== created.id ||
        this.repo.listSources(created.id).length
      )
        throw new AppError("conflict", "new period changed since the switch");
      if (previous) {
        const current = this.repo.period(previous.id);
        if (
          !current ||
          current.revision !== previous.revision + 1 ||
          current.endedAt !== created.startedAt
        )
          throw new AppError("conflict", "previous period changed since the switch");
      }
      this.repo.deletePeriod(created.id);
      if (previous)
        this.repo.savePeriod({ ...previous, revision: previous.revision + 2 }, this.clock.now());
    });
  }
}
