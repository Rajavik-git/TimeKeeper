import { describe, expect, test } from "vitest";
import type { CheckResult } from "../../../integrations/screenpipe/jev-check/check.ts";
import { decideTransition } from "../../../integrations/screenpipe/jev-check/decide.ts";

const tab = (answer: "yes" | "no" | "uncertain") => ({
  answer,
  model: "jev-1.13.0",
  choice: answer,
  probabilities: { yes: 0, no: 0, uncertain: 0, [answer]: 1 },
  confidence: 0.95,
});
const result = (o: Partial<CheckResult>): CheckResult => ({
  checked_at: "2026-10-17T09:00:30.000Z",
  status: "checked",
  detection: "focus_change",
  previous: null,
  current: null,
  transition_at: "2026-10-17T09:00:12.000Z",
  passed_through: [],
  tab_change: tab("yes"),
  assignment: null,
  still_current: true,
  display_proposal: false,
  applied: false,
  ...o,
});
const proposal = (caseId: string) => ({
  status: "proposal" as const,
  case_id: caseId,
  client_id: "c",
  reference: "R",
  title: "T",
  probability: 0.97,
  confidence: 0.95,
  model: "jev-1.13.0",
});
const unresolved = (reason: "no_unique_candidate" | "low_confidence", confidence = 0.9) => ({
  status: "unresolved" as const,
  reason,
  probability: 0.9,
  confidence,
  model: "jev-1.13.0",
});

describe("decideTransition", () => {
  test("confirmed change to another existing case -> transition at the capture time", () => {
    expect(decideTransition(result({ assignment: proposal("2") }), { caseId: "1" }, 0.7)).toEqual({
      action: "transition",
      caseId: "2",
      transitionAt: "2026-10-17T09:00:12.000Z",
    });
  });

  test("first assignment in a session without a period", () => {
    expect(decideTransition(result({ assignment: proposal("2") }), null, 0.7)).toMatchObject({
      action: "transition",
      caseId: "2",
    });
  });

  test("same case -> nothing", () => {
    expect(decideTransition(result({ assignment: proposal("1") }), { caseId: "1" }, 0.7)).toEqual({
      action: "none",
      reason: "same_case",
    });
  });

  test("unknown folder -> unresolved transition, but not twice", () => {
    expect(
      decideTransition(
        result({ assignment: unresolved("no_unique_candidate") }),
        { caseId: "1" },
        0.7,
      ),
    ).toMatchObject({ action: "transition", caseId: null });
    expect(
      decideTransition(result({ assignment: unresolved("no_unique_candidate") }), null, 0.7),
    ).toMatchObject({ action: "transition", caseId: null });
    expect(
      decideTransition(
        result({ assignment: unresolved("no_unique_candidate") }),
        { caseId: null },
        0.7,
      ),
    ).toEqual({ action: "none", reason: "already_unresolved" });
  });

  test("ambiguous or weak evidence keeps the active case", () => {
    expect(
      decideTransition(result({ assignment: unresolved("low_confidence") }), { caseId: "1" }, 0.7)
        .action,
    ).toBe("none");
    expect(
      decideTransition(
        result({ assignment: unresolved("no_unique_candidate", 0.5) }),
        { caseId: "1" },
        0.7,
      ).action,
    ).toBe("none");
  });

  test("no confirmed change, stale context, or failed check -> nothing", () => {
    expect(
      decideTransition(
        result({ tab_change: tab("no"), assignment: proposal("2") }),
        { caseId: "1" },
        0.7,
      ),
    ).toEqual({ action: "none", reason: "tab_change_no" });
    expect(
      decideTransition(result({ tab_change: tab("uncertain") }), { caseId: "1" }, 0.7).action,
    ).toBe("none");
    expect(
      decideTransition(
        result({ assignment: proposal("2"), still_current: false }),
        { caseId: "1" },
        0.7,
      ),
    ).toEqual({ action: "none", reason: "context_not_current" });
    expect(
      decideTransition(
        result({ status: "error", assignment: proposal("2") }),
        { caseId: "1" },
        0.7,
      ),
    ).toEqual({ action: "none", reason: "check_error" });
    expect(
      decideTransition(
        result({ assignment: { status: "skipped", reason: "no_cases_configured" } }),
        { caseId: "1" },
        0.7,
      ),
    ).toEqual({ action: "none", reason: "assignment_no_cases_configured" });
  });
});
