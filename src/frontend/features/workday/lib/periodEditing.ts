import { api, type CoreState } from "../../../api/client";
import { effectiveMs } from "../../../calculations/billing";

export type EditablePeriod = CoreState["periods"][number];

export function durationMinutes(period: EditablePeriod) {
  const duration = effectiveMs(period);
  return duration === null ? "" : String(duration / 60000);
}

export function parseDurationMinutes(value: string) {
  const minutes = value.trim() ? Number(value) : NaN;
  const durationMs = Math.round(minutes * 60000);
  if (
    !Number.isFinite(minutes) ||
    minutes < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0
  )
    throw new Error("Enter a non-negative duration in minutes.");
  return durationMs;
}

export function savePeriodDuration(
  periodId: string,
  expectedRevision: number,
  minutes: string | null,
) {
  return api.POST("/api/work-periods/{id}/duration-override", {
    params: { path: { id: periodId } },
    body: { durationMs: minutes === null ? null : parseDurationMinutes(minutes), expectedRevision },
  });
}
