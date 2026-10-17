import { describe, expect, it } from "vitest";
import {
  canApplyQuestion,
  changePeriod,
  effectiveDuration,
  endSession,
  resolveRate,
  timeIsValidated,
  validateTime,
  type PeriodState,
} from "../../src/backend/domain/rules.js";

const base = (): PeriodState => ({
  caseId: "case-a",
  detectedDurationMs: 720000,
  durationOverrideMs: null,
  assignmentRevision: 0,
  effectiveRevision: 0,
  validatedEffectiveRevision: null,
  timeValidatedAt: null,
  assignmentOrigin: "automatic",
});

describe("pure domain rules", () => {
  it("keeps validation on identical replay and masked detection, then invalidates effective changes", () => {
    const validated = validateTime(base(), "2026-10-17T10:00:00Z");
    expect(timeIsValidated(changePeriod(validated, { detectedDurationMs: 720000 }))).toBe(true);
    const overridden = validateTime(
      changePeriod(validated, { durationOverrideMs: 720000 }),
      "2026-10-17T10:01:00Z",
    );
    const masked = changePeriod(overridden, { detectedDurationMs: 900000 });
    expect(timeIsValidated(masked)).toBe(true);
    expect(masked.effectiveRevision).toBe(overridden.effectiveRevision);
    const changed = changePeriod(masked, { durationOverrideMs: 780000 });
    expect(timeIsValidated(changed)).toBe(false);
    expect(changed.effectiveRevision).toBe(masked.effectiveRevision + 1);
  });
  it("honors zero overrides, assignment guards and exact zero case rate", () => {
    expect(effectiveDuration(changePeriod(base(), { durationOverrideMs: 0 }))).toBe(0);
    expect(resolveRate(0, 25000)).toBe(0);
    expect(resolveRate(null, 25000)).toBe(25000);
    const unresolved = changePeriod(base(), { caseId: null });
    expect(canApplyQuestion(unresolved, unresolved.assignmentRevision)).toBe(true);
    expect(canApplyQuestion(unresolved, 0)).toBe(false);
  });
  it("preserves the first end boundary", () => {
    expect(endSession("2026-10-17T09:00:00Z", null, "2026-10-17T12:00:00Z")).toBe(
      "2026-10-17T12:00:00Z",
    );
    expect(endSession("2026-10-17T09:00:00Z", "2026-10-17T12:00:00Z", "2026-10-17T12:05:00Z")).toBe(
      "2026-10-17T12:00:00Z",
    );
  });
});
