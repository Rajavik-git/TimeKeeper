import { describe, expect, it } from "vitest";
import {
  captureTransitionContext,
  transitionInput,
} from "../../../integrations/screenpipe/jev-check/transition-input.js";

describe("in-flight inference assignment snapshot", () => {
  it("keeps the original revision when a lawyer correction arrives before inference completes", () => {
    const status = {
      activeSession: { id: "session" },
      activePeriod: { id: "period", assignmentRevision: 3, caseId: "case-a" },
    };
    const beforeInference = captureTransitionContext(status);
    status.activePeriod.assignmentRevision = 4;
    status.activePeriod.caseId = "lawyer-choice";
    expect(transitionInput(beforeInference, "2026-10-18T08:00:00Z", "case-b")).toEqual({
      sessionId: "session",
      transitionAt: "2026-10-18T08:00:00Z",
      caseId: "case-b",
      expectedActivePeriodId: "period",
      expectedAssignmentRevision: 3,
    });
  });
  it("carries an explicit empty-period snapshot", () => {
    expect(
      transitionInput(
        captureTransitionContext({ activeSession: { id: "session" } }),
        "2026-10-18T08:00:00Z",
        null,
      ),
    ).toMatchObject({ expectedActivePeriodId: null, expectedAssignmentRevision: null });
  });
});
