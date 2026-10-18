import { AvailabilityStatus } from "../../contracts/states.generated";
import type { CoreState } from "../api/client";
import { effectiveMs, hasCoverageGap } from "./billing";

/** Explain the same conditions that make billing totals incomplete. */
export function coverageProblems(
  period: CoreState["periods"][number],
  sources: CoreState["sources"],
): string[] {
  if (!hasCoverageGap(period, sources)) return [];
  const reasons: string[] = [];
  if (effectiveMs(period) === null)
    reasons.push("Duration is unknown. Review and correct the duration.");
  const linked = sources.filter((source) => source.workPeriodId === period.id);
  if (!linked.length && period.durationOverrideMs === null)
    reasons.push("No evidence is linked and no duration correction is recorded.");
  if (linked.some((source) => source.availabilityStatus === AvailabilityStatus.Unavailable))
    reasons.push("A linked source is unavailable in Screenpipe.");
  if (linked.some((source) => source.availabilityStatus === AvailabilityStatus.Unknown))
    reasons.push("Availability of a linked source has not been checked.");
  return reasons;
}
