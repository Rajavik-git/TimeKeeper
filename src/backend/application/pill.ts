import { randomUUID } from "node:crypto";
import type { PeriodView } from "../../contracts/index.js";
import { changePeriod } from "../domain/rules.js";
import type { PeriodRecord, Repository } from "../ports/repository.js";
import { AppError, TimeKeeperService } from "./service.js";

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
    private readonly repo: Repository,
    private readonly service: TimeKeeperService,
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

  decision(input: PillDecision): { period: PeriodView; undoToken: string } {
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
        if ("status" in switched) throw new AppError("pending", "switch requires review");
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
    this.undos.set(undoToken, {
      expiresAt: this.now() + pillUndoWindowMs,
      kind: input.kind,
      before,
      afterIds,
      afterRevisions: afterIds.map((id) => this.repo.period(id)!.revision),
    });
    return { period, undoToken };
  }

  /** Reverses a decision only while none of its periods changed afterwards. */
  undo(undoToken: string): { status: "undone" } {
    const action = this.undos.get(undoToken);
    if (!action || this.now() > action.expiresAt) {
      this.undos.delete(undoToken);
      throw new AppError("conflict", "undo has expired");
    }
    const at = new Date(this.now()).toISOString();
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
          const created = after[0];
          if (
            this.repo.activePeriod(created.sessionId)?.id !== created.id ||
            this.repo.listSources(created.id).length
          )
            throw new AppError("conflict", "new period changed since the switch");
          const previous = action.before[0];
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
          if (previous) this.repo.savePeriod({ ...previous, revision: previous.revision + 2 }, at);
        } else if (action.kind === "assign") {
          const prior = action.before[0];
          const current = after[0];
          const restored = {
            ...changePeriod(current, {
              caseId: prior.caseId,
              assignmentOrigin: prior.assignmentOrigin,
            }),
            revision: current.revision + 1,
          };
          this.repo.savePeriod(restored, at);
          if (restored.caseId === null)
            this.service.askQuestion({
              questionId: `period:${restored.id}:${restored.assignmentRevision}`,
              sessionId: restored.sessionId,
              periodId: restored.id,
              expectedAssignmentRevision: restored.assignmentRevision,
            });
        } else if (action.kind === "exclude") {
          this.service.updatePeriodDetails(after[0].id, {
            excluded: action.before[0].excluded ?? false,
          });
        } else {
          after.forEach((period, index) =>
            this.repo.savePeriod(
              {
                ...period,
                validatedEffectiveRevision: action.before[index].validatedEffectiveRevision,
                timeValidatedAt: action.before[index].timeValidatedAt,
                revision: period.revision + 1,
              },
              at,
            ),
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
