import {
  nonbillableReasons,
  isState,
  type NonbillableReason,
  BillingStatus,
  QuestionStatus,
} from "../domain/states.js";
import type { PeriodView } from "../../contracts/index.js";
import { changePeriod, resolveRate, timeIsValidated, validateTime } from "../domain/rules.js";
import type { Clock } from "../ports/index.js";
import type { PeriodRecord, Repository } from "../ports/repository.js";
import { AppError } from "./errors.js";
import { periodView as view } from "./period-view.js";
function assertDuration(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new AppError("invalid-request", "duration must be a nonnegative integer or null");
}
export interface PeriodDetails {
  label?: string;
  billable?: boolean;
  nonbillableReason?: NonbillableReason | null;
  excluded?: boolean;
  taskTypeId?: number | null;
}
type PeriodReviewRepository = Pick<
  Repository,
  | "transaction"
  | "period"
  | "periodForNonbillableReasonRepair"
  | "savePeriod"
  | "allQuestions"
  | "saveQuestion"
  | "rateForCase"
>;
/** Owns period review writes shared by the current and compatibility APIs. */
export class PeriodReviewService {
  constructor(
    private readonly repo: PeriodReviewRepository,
    private readonly clock: Clock,
    private readonly askQuestion: (input: {
      questionId: string;
      sessionId: string;
      periodId: string;
      expectedAssignmentRevision: number;
    }) => string,
  ) {}
  setDetectedDuration(id: string, durationMs: number | null): PeriodView {
    assertDuration(durationMs);
    return this.repo.transaction(() => {
      const p = this.repo.period(id);
      if (!p) throw new AppError("not-found", "period not found");
      if (p.billingStatus === BillingStatus.Billed && durationMs !== p.detectedDurationMs)
        throw new AppError("pending", "billed-period edit policy is open");
      const next = {
        ...changePeriod(p, { detectedDurationMs: durationMs }),
        revision: p.revision + 1,
      };
      this.repo.savePeriod(next, this.clock.now());
      return view(next);
    });
  }
  setDurationOverride(
    id: string,
    durationMs: number | null,
    expectedRevision?: number,
  ): PeriodView {
    assertDuration(durationMs);
    return this.repo.transaction(() => {
      const p = this.repo.period(id);
      if (!p) throw new AppError("not-found", "period not found");
      if (expectedRevision !== undefined && p.revision !== expectedRevision)
        throw new AppError("conflict", "stale period revision");
      if (p.billingStatus === BillingStatus.Billed)
        throw new AppError("pending", "billed-period edit policy is open");
      const next = {
        ...changePeriod(p, { durationOverrideMs: durationMs }),
        revision: p.revision + 1,
      };
      this.repo.savePeriod(next, this.clock.now());
      return view(next);
    });
  }
  updatePeriodDetails(id: string, changes: PeriodDetails, expectedRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      if (
        changes.nonbillableReason !== undefined &&
        changes.nonbillableReason !== null &&
        !isState(changes.nonbillableReason, nonbillableReasons)
      )
        throw new AppError("invalid-request", "invalid nonbillable reason");
      const period =
        changes.nonbillableReason === undefined
          ? this.repo.period(id)
          : this.repo.periodForNonbillableReasonRepair(id, changes.nonbillableReason);
      if (!period) throw new AppError("not-found", "period not found");
      if (expectedRevision !== undefined && period.revision !== expectedRevision)
        throw new AppError("conflict", "stale period revision");
      if (period.billingStatus === BillingStatus.Billed || period.invoiceId != null)
        throw new AppError("conflict", "billed period must be unbilled before editing");
      if (
        changes.label !== undefined &&
        (typeof changes.label !== "string" || !changes.label.trim())
      )
        throw new AppError("invalid-request", "label required");
      if (changes.billable !== undefined && typeof changes.billable !== "boolean")
        throw new AppError("invalid-request", "invalid billable flag");
      if (changes.excluded !== undefined && typeof changes.excluded !== "boolean")
        throw new AppError("invalid-request", "invalid excluded flag");
      if (
        changes.taskTypeId !== undefined &&
        changes.taskTypeId !== null &&
        (!Number.isSafeInteger(changes.taskTypeId) || changes.taskTypeId < 1)
      )
        throw new AppError("invalid-request", "invalid task type");
      const next = { ...period, ...changes, revision: period.revision + 1 };
      this.repo.savePeriod(next, this.clock.now());
      if (changes.excluded === true)
        for (const question of this.repo
          .allQuestions()
          .filter((q) => q.periodId === id && q.status === QuestionStatus.Pending))
          this.repo.saveQuestion({ ...question, status: QuestionStatus.Superseded });
      if (changes.excluded === false && period.excluded && next.caseId === null)
        this.askQuestion({
          questionId: `period:${id}:${next.assignmentRevision}`,
          sessionId: next.sessionId,
          periodId: id,
          expectedAssignmentRevision: next.assignmentRevision,
        });
      return view(next);
    });
  }
  validatePeriod(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id);
      if (!p) throw new AppError("not-found", "period not found");
      if (
        expectedEffectiveRevision !== undefined &&
        p.effectiveRevision !== expectedEffectiveRevision
      )
        throw new AppError("conflict", "stale effective revision");
      if (p.caseId === null || (p.durationOverrideMs ?? p.detectedDurationMs) === null)
        throw new AppError(
          "pending",
          "case and effective duration are required before time validation",
        );
      const next = { ...validateTime(p, this.clock.now()), revision: p.revision + 1 };
      this.repo.savePeriod(next, this.clock.now());
      return view(next);
    });
  }
  setBillingStatus(id: string, status: BillingStatus, expectedRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id);
      if (!p) throw new AppError("not-found", "period not found");
      if (expectedRevision !== undefined && p.revision !== expectedRevision)
        throw new AppError("conflict", "stale period revision");
      if (status === BillingStatus.Unbilled && p.invoiceId != null)
        throw new AppError("pending", "issued invoice reversal is not defined");
      if (status === BillingStatus.Billed && (p.caseId === null || !timeIsValidated(p)))
        throw new AppError("conflict", "time validation and a case are required before billing");
      const snapshot =
        status === BillingStatus.Billed && p.billingStatus !== BillingStatus.Billed && p.caseId
          ? this.currentRateForCase(p.caseId)
          : null;
      const currency =
        status === BillingStatus.Billed && p.caseId
          ? this.repo.rateForCase(p.caseId)?.currency
          : null;
      if (status === BillingStatus.Billed && !p.appliedCurrency && !currency)
        throw new AppError("pending", "currency is not configured");
      const next: PeriodRecord = {
        ...p,
        billingStatus: status,
        billedAt: status === BillingStatus.Billed ? (p.billedAt ?? this.clock.now()) : null,
        appliedHourlyRateCents:
          status === BillingStatus.Billed ? (p.appliedHourlyRateCents ?? snapshot) : null,
        appliedCurrency:
          status === BillingStatus.Billed ? (p.appliedCurrency ?? currency ?? null) : null,
        revision: p.revision + 1,
      };
      this.repo.savePeriod(next, this.clock.now());
      return view(next);
    });
  }

  clearTimeValidation(id: string): PeriodView {
    return this.repo.transaction(() => {
      const period = this.repo.period(id);
      if (!period) throw new AppError("not-found", "period not found");
      if (period.billingStatus === BillingStatus.Billed || period.invoiceId != null)
        throw new AppError("conflict", "billed period must be unbilled before editing");
      const next = {
        ...period,
        validatedEffectiveRevision: null,
        timeValidatedAt: null,
        revision: period.revision + 1,
      };
      this.repo.savePeriod(next, this.clock.now());
      return view(next);
    });
  }
  private currentRateForCase(id: string): number {
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
}
