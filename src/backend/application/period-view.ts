import type { PeriodView } from "../../contracts/index.js";
import type { PeriodRecord } from "../ports/repository.js";
import { timeIsValidated } from "../domain/rules.js";
export function periodView(p: PeriodRecord): PeriodView {
  return {
    id: p.id,
    sessionId: p.sessionId,
    revision: p.revision,
    caseId: p.caseId,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    detectedDurationMs: p.detectedDurationMs,
    durationOverrideMs: p.durationOverrideMs,
    assignmentRevision: p.assignmentRevision,
    effectiveRevision: p.effectiveRevision,
    validatedEffectiveRevision: p.validatedEffectiveRevision,
    timeValidated: timeIsValidated(p),
    timeValidatedAt: p.timeValidatedAt,
    billingStatus: p.billingStatus,
    appliedHourlyRateCents: p.appliedHourlyRateCents ?? null,
    appliedCurrency: p.appliedCurrency ?? null,
    taskTypeId: p.taskTypeId ?? null,
    label: p.label ?? "",
    billable: p.billable ?? true,
    nonbillableReason: p.nonbillableReason ?? null,
    excluded: p.excluded ?? false,
    observedAppName: p.observedAppName ?? null,
    observedWindowTitle: p.observedWindowTitle ?? null,
    recognitionConfidence: p.recognitionConfidence ?? null,
    demoApp: p.observedAppName ?? null,
    demoWindowTitle: p.observedWindowTitle ?? null,
    demoConfidence: p.recognitionConfidence ?? null,
    invoiceId: p.invoiceId ?? null,
  };
}
