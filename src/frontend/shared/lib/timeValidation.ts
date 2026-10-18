import { calendarDay } from "../../../shared/dates";
import type { CoreState } from "../../api/client";
import { effectiveMs } from "../../calculations/billing";

type Period = CoreState["periods"][number];

/** The local start day owns validation eligibility, even for an overnight period. */
export function timeValidationUnavailable(
  period: Period,
  today = calendarDay(new Date()),
): string | null {
  if (period.endedAt === null) return "Finish this period before validating time.";
  if (calendarDay(period.startedAt) >= today)
    return "Time can be validated from the next local calendar day.";
  if (period.excluded) return "Excluded periods cannot be time-validated.";
  if (!period.caseId) return "Assign a case before validating time.";
  if (effectiveMs(period) === null) return "Correct the unknown duration before validating time.";
  return null;
}
