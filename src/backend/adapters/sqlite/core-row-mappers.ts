import { enumValue as member } from "./enum-value.js";
import {
  assignmentOrigins,
  nonbillableReasons,
  billingStatuses,
  commandKinds,
  commandStatuses,
  questionStatuses,
  validationStatuses,
  availabilityStatuses,
} from "../../domain/states.js";
import type {
  SessionRecord,
  PeriodRecord,
  CommandRecord,
  QuestionRecord,
  SourceRecord,
} from "../../ports/repository.js";
type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("Invalid SQLite row");
  return Object.fromEntries(Object.entries(value));
};
export const str = (value: unknown): string => {
  if (typeof value !== "string") throw Error("Invalid SQLite text value");
  return value;
};
export const nullable = (value: unknown): string | null => (value === null ? null : str(value));
const num = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error("Invalid SQLite numeric value");
  return value;
};
const flag = (value: unknown): boolean => {
  if (value !== 0 && value !== 1) throw Error("Invalid SQLite boolean value");
  return value === 1;
};
export const nullableNum = (value: unknown): number | null => (value === null ? null : num(value));

export function session(value: unknown): SessionRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        startedAt: str(r.started_at),
        endedAt: nullable(r.ended_at),
        revision: num(r.revision),
      }
    : null;
}
export function period(value: unknown): PeriodRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        sessionId: str(r.session_id),
        caseId: nullable(r.case_id),
        initialCaseId: nullable(r.initial_case_id),
        initialOrigin: member(r.initial_origin, assignmentOrigins),
        startedAt: str(r.started_at),
        endedAt: nullable(r.ended_at),
        detectedDurationMs: nullableNum(r.detected_duration_ms),
        durationOverrideMs: nullableNum(r.duration_override_ms),
        assignmentOrigin: member(r.assignment_origin, assignmentOrigins),
        assignmentRevision: num(r.assignment_revision),
        effectiveRevision: num(r.effective_revision),
        validatedEffectiveRevision: nullableNum(r.validated_effective_revision),
        timeValidatedAt: nullable(r.time_validated_at),
        billingStatus: member(r.billing_status, billingStatuses),
        billedAt: nullable(r.billed_at),
        revision: num(r.revision),
        appliedHourlyRateCents: nullableNum(r.applied_hourly_rate_cents),
        appliedCurrency: nullable(r.applied_currency),
        taskTypeId: nullableNum(r.task_type_id),
        label: str(r.label),
        billable: flag(r.billable),
        nonbillableReason:
          r.nonbillable_reason === null ? null : member(r.nonbillable_reason, nonbillableReasons),
        excluded: flag(r.excluded),
        observedAppName: nullable(r.demo_app),
        observedWindowTitle: nullable(r.demo_window_title),
        recognitionConfidence: nullableNum(r.demo_confidence),
        invoiceId: nullableNum(r.invoice_id),
      }
    : null;
}
export function command(value: unknown): CommandRecord | null {
  const r = row(value);
  return r
    ? {
        producerId: str(r.producer_id),
        commandId: str(r.command_id),
        kind: member(r.kind, commandKinds),
        payloadFingerprint: str(r.payload_fingerprint),
        sessionId: str(r.session_id),
        status: member(r.status, commandStatuses),
        prerequisiteId: nullable(r.prerequisite_id),
        payloadJson: str(r.payload_json),
        resultJson: nullable(r.result_json),
      }
    : null;
}
export function question(value: unknown): QuestionRecord | null {
  const r = row(value);
  return r
    ? {
        questionId: str(r.question_id),
        sessionId: str(r.session_id),
        periodId: str(r.work_period_id),
        expectedAssignmentRevision: num(r.expected_assignment_revision),
        status: member(r.status, questionStatuses),
        responseCommandId: nullable(r.response_command_id),
        responseResultJson: nullable(r.response_result_json),
      }
    : null;
}
export function source(value: unknown): SourceRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        workPeriodId: nullable(r.work_period_id),
        instanceId: str(r.screenpipe_instance_id),
        contentType: str(r.content_type),
        externalId: str(r.external_id),
        recordedAt: str(r.recorded_at),
        ingestedAt: str(r.ingested_at),
        appName: nullable(r.app_name),
        windowName: nullable(r.window_name),
        excerpt: nullable(r.excerpt),
        detectedMarker: nullable(r.detected_marker),
        validationStatus: member(r.validation_status, validationStatuses),
        validatedAt: nullable(r.validated_at),
        availabilityStatus: member(r.availability_status, availabilityStatuses),
        availabilityCheckedAt: nullable(r.availability_checked_at),
      }
    : null;
}
