import { randomUUID } from "node:crypto";
import type { PeriodView } from "../../contracts/index.js";
import type { PeriodRecord, Repository } from "../ports/repository.js";
import type { TimeKeeperService } from "./service.js";
import { AppError } from "./errors.js";

export type PillDecision =
  | { kind: "switch"; caseId: string | null; windowTitle: string; appName: string; at: string }
  | { kind: "assign"; periodId: string; caseId: string; expectedAssignmentRevision: number }
  | {
      kind: "exclude";
      periodId: string;
      expectedAssignmentRevision: number;
      expectedEffectiveRevision: number;
    }
  | { kind: "validate"; periodIds: string[]; expectedEffectiveRevisions: Record<string, number> };

interface UndoAction {
  expiresAt: number;
  kind: PillDecision["kind"];
  before: PeriodRecord[];
  afterIds: string[];
  afterRevisions: number[];
}

/** How long a one-click pill decision can be reversed. */
export const pillUndoWindowMs = 5000;

/**
 * Desk pill use cases. Every write goes through TimeKeeperService, so revision guards,
 * question binding and validation rules stay identical to the review screens.
 */
export class PillService {
  private readonly undos = new Map<string, UndoAction>();
  constructor(
    private readonly repo: Pick<
      Repository,
      "transaction" | "activeSession" | "activePeriod" | "period" | "allQuestions"
    >,
    private readonly service: Pick<
      TimeKeeperService,
      | "openPeriod"
      | "updatePeriodDetails"
      | "assignPeriod"
      | "answerQuestion"
      | "validatePeriod"
      | "undoPeriodSwitch"
      | "restorePeriodAssignment"
      | "restorePeriodValidation"
    >,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens the period that follows a confirmed document switch in the active session. */
  switchPeriod(input: {
    caseId: string | null;
    windowTitle: string;
    appName: string;
    at: string;
    notClientWork?: boolean;
  }): PeriodView | { status: "pending"; conflictId: string } {
    if (!input.windowTitle.trim() || !input.appName.trim())
      throw new AppError("invalid-request", "window title and app name required");
    if (input.notClientWork && input.caseId !== null)
      throw new AppError("invalid-request", "non-client work cannot have a case");
    return this.repo.transaction(() => {
      const session = this.repo.activeSession();
      if (!session) throw new AppError("no-active-session", "no active session");
      const opened = this.service.openPeriod({
        id: randomUUID(),
        sessionId: session.id,
        caseId: input.caseId,
        startedAt: input.at,
        origin: input.caseId === null ? "unresolved" : "lawyer",
        mode: "current",
        window: { appName: input.appName, title: input.windowTitle },
      });
      if ("status" in opened || !input.notClientWork) return opened;
      return this.service.updatePeriodDetails(opened.id, { excluded: true });
    });
  }

  decision(input: PillDecision): { period: PeriodView; undoToken: string; undoExpiresAt: string } {
    for (const [token, action] of this.undos)
      if (this.now() > action.expiresAt) this.undos.delete(token);
    const before: PeriodRecord[] = [];
    const afterIds: string[] = [];
    const period = this.repo.transaction((): PeriodView => {
      if (input.kind === "switch") {
        const session = this.repo.activeSession();
        if (!session) throw new AppError("no-active-session", "no active session");
        const prior = this.repo.activePeriod(session.id);
        if (prior) before.push(prior);
        const switched = this.switchPeriod({ ...input, notClientWork: input.caseId === null });
        if ("status" in switched) throw new AppError("conflict", "switch requires review");
        afterIds.push(switched.id);
        return switched;
      }
      if (input.kind === "assign") {
        const prior = this.repo.period(input.periodId);
        if (!prior) throw new AppError("not-found", "period not found");
        before.push(prior);
        afterIds.push(input.periodId);
        const question = this.repo
          .allQuestions()
          .find((q) => q.periodId === input.periodId && q.status === "pending");
        if (!question)
          return this.service.assignPeriod(
            input.periodId,
            input.caseId,
            input.expectedAssignmentRevision,
            "lawyer",
          );
        if (question.expectedAssignmentRevision !== input.expectedAssignmentRevision)
          throw new AppError("conflict", "stale assignment revision");
        return this.service.answerQuestion({
          questionId: question.questionId,
          sessionId: question.sessionId,
          periodId: input.periodId,
          expectedAssignmentRevision: question.expectedAssignmentRevision,
          caseId: input.caseId,
          responseCommandId: randomUUID(),
        });
      }
      if (input.kind === "exclude") {
        const prior = this.repo.period(input.periodId);
        if (!prior) throw new AppError("not-found", "period not found");
        if (
          prior.assignmentRevision !== input.expectedAssignmentRevision ||
          prior.effectiveRevision !== input.expectedEffectiveRevision
        )
          throw new AppError("conflict", "stale period");
        before.push(prior);
        afterIds.push(input.periodId);
        return this.service.updatePeriodDetails(input.periodId, { excluded: true }, prior.revision);
      }
      if (!input.periodIds.length || new Set(input.periodIds).size !== input.periodIds.length)
        throw new AppError("invalid-request", "distinct periods required");
      let last: PeriodView | undefined;
      for (const id of input.periodIds) {
        const prior = this.repo.period(id);
        if (!prior) throw new AppError("not-found", "period not found");
        const expected = input.expectedEffectiveRevisions[id];
        if (expected === undefined)
          throw new AppError("invalid-request", `effective revision for ${id} required`);
        before.push(prior);
        afterIds.push(id);
        last = this.service.validatePeriod(id, expected);
      }
      return last!;
    });
    const undoToken = randomUUID();
    const expiresAt = this.now() + pillUndoWindowMs;
    this.undos.set(undoToken, {
      expiresAt,
      kind: input.kind,
      before,
      afterIds,
      afterRevisions: afterIds.map((id) => this.repo.period(id)!.revision),
    });
    return { period, undoToken, undoExpiresAt: new Date(expiresAt).toISOString() };
  }

  /** Reverses a decision only while none of its periods changed afterwards. */
  undo(undoToken: string): { status: "undone" } {
    const action = this.undos.get(undoToken);
    if (!action || this.now() > action.expiresAt) {
      this.undos.delete(undoToken);
      throw new AppError("conflict", "undo has expired");
    }
    try {
      this.repo.transaction(() => {
        const after = action.afterIds.map((id, index) => {
          const period = this.repo.period(id);
          if (
            !period ||
            period.revision !== action.afterRevisions[index] ||
            period.billingStatus === "billed"
          )
            throw new AppError("conflict", "period changed since the decision");
          return period;
        });
        if (action.kind === "switch") {
          this.service.undoPeriodSwitch(after[0].id, after[0].revision, action.before[0]);
        } else if (action.kind === "assign") {
          this.service.restorePeriodAssignment(action.before[0], after[0].revision);
        } else if (action.kind === "exclude") {
          this.service.updatePeriodDetails(after[0].id, {
            excluded: action.before[0].excluded ?? false,
          });
        } else {
          after.forEach((period, index) =>
            this.service.restorePeriodValidation(action.before[index], period.revision),
          );
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Foreign keys keep a period that later received evidence or invoice links.
      throw new AppError("conflict", "period has dependent records and cannot be undone");
    }
    this.undos.delete(undoToken);
    return { status: "undone" };
  }
}
