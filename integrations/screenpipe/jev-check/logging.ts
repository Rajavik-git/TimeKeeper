import { createHash } from "node:crypto";
import type { CheckResult } from "./check.js";

const timestamp = (value: string) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const probability = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : null;
const opaqueId = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

/** Diagnostic output never includes captured content, catalogue labels, or provider errors. */
export function safeCheckResult(result: CheckResult) {
  const capture = (value: CheckResult["current"]) =>
    value ? { ts: timestamp(value.ts), frame_id: value.frame_id } : null;
  const assignment = result.assignment;
  return {
    checked_at: timestamp(result.checked_at),
    status: result.status,
    detection: result.detection,
    previous: capture(result.previous),
    current: capture(result.current),
    passed_through_count: result.passed_through.length,
    tab_change: result.tab_change
      ? {
          answer: result.tab_change.answer,
          confidence: probability(result.tab_change.confidence),
        }
      : null,
    assignment: assignment
      ? {
          status: assignment.status,
          ...("confidence" in assignment ? { confidence: probability(assignment.confidence) } : {}),
          ...(assignment.status === "proposal"
            ? {
                case_id_hash: opaqueId(assignment.case_id),
                client_id_hash: opaqueId(assignment.client_id),
              }
            : {}),
        }
      : null,
    still_current: result.still_current,
    display_proposal: result.display_proposal,
    applied: false,
  };
}

export function formatCheckLog(result: CheckResult): string {
  const safe = safeCheckResult(result);
  return `[${safe.checked_at}] status=${safe.status}\n  diagnostics: ${JSON.stringify(safe)}`;
}
