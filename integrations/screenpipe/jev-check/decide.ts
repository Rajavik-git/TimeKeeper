// Decides whether a JEV check result becomes a TimeKeeper case transition (sent through the TimeKeeper MCP server).
import type { CheckResult } from "./check.js";

export type Decision =
  | { action: "transition"; caseId: string | null; transitionAt: string }
  | { action: "none"; reason: string };

/**
 * Only a confirmed tab change on a context that is still current produces a command:
 * - a proposed existing case different from the current one -> that case;
 * - "no unique candidate" with enough confidence -> null (unresolved period; the lawyer is asked);
 * Everything else (no change, uncertain, low confidence, stale, errors) keeps the active case.
 */
export function decideTransition(
  r: CheckResult,
  currentPeriod: { caseId: string | null } | null,
  minConfidence: number,
): Decision {
  const currentCaseId = currentPeriod?.caseId ?? null;
  if (r.status !== "checked") return { action: "none", reason: `check_${r.status}` };
  if (r.tab_change?.answer !== "yes")
    return {
      action: "none",
      reason: r.tab_change ? `tab_change_${r.tab_change.answer}` : "no_tab_answer",
    };
  if (r.still_current !== true) return { action: "none", reason: "context_not_current" };
  if (!r.transition_at) return { action: "none", reason: "no_transition_time" };
  const a = r.assignment;
  if (!a || a.status === "skipped")
    return { action: "none", reason: a ? `assignment_${a.reason}` : "no_assignment" };
  if (a.status === "proposal") {
    return a.case_id === currentCaseId
      ? { action: "none", reason: "same_case" }
      : { action: "transition", caseId: a.case_id, transitionAt: r.transition_at };
  }
  if (a.reason === "no_unique_candidate" && a.confidence >= minConfidence) {
    return currentPeriod !== null && currentCaseId === null
      ? { action: "none", reason: "already_unresolved" }
      : { action: "transition", caseId: null, transitionAt: r.transition_at };
  }
  return { action: "none", reason: `unresolved_${a.reason}` };
}
