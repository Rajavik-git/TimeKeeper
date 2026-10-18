import { AssignmentOrigin, BillingStatus, QuestionStatus } from "../domain/states.js";
import type { PeriodView, QuestionAnswer } from "../../contracts/index.js";
import type { Clock } from "../ports/index.js";
import type { PeriodRecord, Repository } from "../ports/repository.js";
import { canApplyQuestion, changePeriod } from "../domain/rules.js";
import { AppError } from "./errors.js";
import { periodView as view } from "./period-view.js";
type AssignmentRepository = Pick<
  Repository,
  | "transaction"
  | "period"
  | "savePeriod"
  | "caseExists"
  | "allQuestions"
  | "question"
  | "saveQuestion"
>;
/** One assignment writer, including guarded question answers and their replay receipts. */
export class PeriodAssignmentService {
  constructor(
    private readonly repo: AssignmentRepository,
    private readonly clock: Clock,
  ) {}
  // All assignment writes, including question answers and inference, enter here.
  assignPeriod(
    id: string,
    caseId: string,
    expectedAssignmentRevision: number,
    origin: Exclude<AssignmentOrigin, typeof AssignmentOrigin.Unresolved>,
  ): PeriodView {
    return this.repo.transaction(() =>
      this.assignInside(id, caseId, expectedAssignmentRevision, origin),
    );
  }
  private assignInside(
    id: string,
    caseId: string,
    expected: number,
    origin: Exclude<AssignmentOrigin, typeof AssignmentOrigin.Unresolved>,
  ): PeriodView {
    const p = this.repo.period(id);
    if (!p) throw new AppError("not-found", "period not found");
    if (p.billingStatus === BillingStatus.Billed)
      throw new AppError("rule-not-decided", "billed-period edit policy is open");
    if (p.assignmentRevision !== expected)
      throw new AppError("conflict", "stale assignment revision");
    if (origin === AssignmentOrigin.Automatic && p.assignmentOrigin === AssignmentOrigin.Lawyer)
      throw new AppError("conflict", "manual assignment wins");
    if (!this.repo.caseExists(caseId)) throw new AppError("not-found", "case not found");
    const next = {
      ...changePeriod(p, { caseId, assignmentOrigin: origin }),
      revision: p.revision + 1,
    };
    this.repo.savePeriod(next, this.clock.now());
    for (const question of this.repo
      .allQuestions()
      .filter((q) => q.periodId === id && q.status === QuestionStatus.Pending))
      this.repo.saveQuestion({ ...question, status: QuestionStatus.Superseded });
    return view(next);
  }
  /** Compensates a guarded assignment without rewinding its revision history. */
  restoreAssignment(prior: PeriodRecord, expectedRevision: number): void {
    this.repo.transaction(() => {
      const current = this.repo.period(prior.id);
      if (
        !current ||
        current.revision !== expectedRevision ||
        current.billingStatus === BillingStatus.Billed
      )
        throw new AppError("conflict", "period changed since the decision");
      if (prior.caseId !== null && !this.repo.caseExists(prior.caseId))
        throw new AppError("not-found", "case not found");
      const restored = {
        ...changePeriod(current, {
          caseId: prior.caseId,
          assignmentOrigin: prior.assignmentOrigin,
        }),
        revision: current.revision + 1,
      };
      this.repo.savePeriod(restored, this.clock.now());
      for (const question of this.repo
        .allQuestions()
        .filter((q) => q.periodId === prior.id && q.status === QuestionStatus.Pending))
        this.repo.saveQuestion({ ...question, status: QuestionStatus.Superseded });
      if (restored.caseId === null)
        this.askQuestion({
          questionId: `period:${restored.id}:${restored.assignmentRevision}`,
          sessionId: restored.sessionId,
          periodId: restored.id,
          expectedAssignmentRevision: restored.assignmentRevision,
        });
    });
  }
  askQuestion(input: {
    questionId: string;
    sessionId: string;
    periodId: string;
    expectedAssignmentRevision: number;
  }): string {
    return this.repo.transaction(() => {
      const p = this.repo.period(input.periodId);
      if (!p || p.sessionId !== input.sessionId)
        throw new AppError("not-found", "target period not found");
      const existing = this.repo.question(input.questionId);
      if (existing) {
        if (
          existing.sessionId !== input.sessionId ||
          existing.periodId !== input.periodId ||
          existing.expectedAssignmentRevision !== input.expectedAssignmentRevision
        )
          throw new AppError("conflict", "question ID reused");
        if (existing.status === QuestionStatus.Superseded) {
          if (p.excluded || !canApplyQuestion(p, input.expectedAssignmentRevision))
            throw new AppError("conflict", "question target is stale");
          this.repo.saveQuestion({ ...existing, status: QuestionStatus.Pending });
        }
        return existing.questionId;
      }
      const sameTarget = this.repo
        .allQuestions()
        .find(
          (q) =>
            q.sessionId === input.sessionId &&
            q.periodId === input.periodId &&
            q.expectedAssignmentRevision === input.expectedAssignmentRevision,
        );
      if (sameTarget) {
        if (sameTarget.status === QuestionStatus.Superseded) {
          if (p.excluded || !canApplyQuestion(p, input.expectedAssignmentRevision))
            throw new AppError("conflict", "question target is stale");
          this.repo.saveQuestion({ ...sameTarget, status: QuestionStatus.Pending });
        }
        return sameTarget.questionId;
      }
      if (p.excluded || !canApplyQuestion(p, input.expectedAssignmentRevision))
        throw new AppError("conflict", "question target is stale");
      this.repo.saveQuestion({
        ...input,
        status: QuestionStatus.Pending,
        responseCommandId: null,
        responseResultJson: null,
      });
      return input.questionId;
    });
  }
  answerQuestion(input: QuestionAnswer): PeriodView {
    return this.repo.transaction(() => {
      const q = this.repo.question(input.questionId);
      if (
        !q ||
        q.sessionId !== input.sessionId ||
        q.periodId !== input.periodId ||
        q.expectedAssignmentRevision !== input.expectedAssignmentRevision
      )
        throw new AppError("not-found", "question target not found");
      if (q.status === QuestionStatus.Answered) {
        if (
          q.responseCommandId !== input.responseCommandId ||
          JSON.parse(q.responseResultJson!).caseId !== input.caseId
        )
          throw new AppError("conflict", "question already answered differently");
        return JSON.parse(q.responseResultJson!) as PeriodView;
      }
      if (q.status !== QuestionStatus.Pending)
        throw new AppError("conflict", "stale question was superseded");
      const p = this.repo.period(q.periodId);
      if (!p || !canApplyQuestion(p, q.expectedAssignmentRevision))
        throw new AppError("conflict", "stale question answer");
      const result = this.assignInside(
        p.id,
        input.caseId,
        q.expectedAssignmentRevision,
        AssignmentOrigin.Lawyer,
      );
      this.repo.saveQuestion({
        ...q,
        status: QuestionStatus.Answered,
        responseCommandId: input.responseCommandId,
        responseResultJson: JSON.stringify(result),
      });
      return result;
    });
  }
}
