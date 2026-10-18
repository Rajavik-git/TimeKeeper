import { timeValidationUnavailable } from "../../../../shared/lib/timeValidation";
import { useToday } from "../../../../shared/hooks/useToday";
import {
  billingStatusLabels,
  nonbillableReasonLabels,
  timeValidationLabels,
} from "../../../../shared/presentation/work-period";
import { BillingStatus, ValidationStatus } from "../../../../../contracts/states.generated";
import { calendarTime } from "../../../../../shared/dates";
import type { Case } from "../../../../api/client";
import {
  effectiveMs,
  formatNearestMinuteDuration,
  type Period,
} from "../../../../calculations/billing";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";
type Props = {
  period: Period;
  item?: Case;
  clientName?: string;
  taskLabel: string;
  rateLabel: string;
  sourceCount: number;
  highlighted: boolean;
  validating: boolean;
  onValidate: () => Promise<void>;
  openPeriodReview?: () => void;
  openPeriodActivity: () => void;
};
/** Duration and Review open the same guarded period editor. */
export function DayPeriodRow({
  period,
  item,
  clientName,
  taskLabel,
  rateLabel,
  sourceCount,
  highlighted,
  validating,
  onValidate,
  openPeriodReview,
  openPeriodActivity,
}: Props) {
  const today = useToday();
  const validationUnavailable = timeValidationUnavailable(period, today);
  return (
    <tr key={period.id} className={highlighted ? "recently-assigned" : undefined}>
      <td className="num">
        {calendarTime(period.startedAt)}–
        {(period.endedAt ? calendarTime(period.endedAt) : undefined) ?? "…"}
        <span className="sub">{period.observedAppName ?? "Application unavailable"}</span>
      </td>
      <td>
        {item ? (
          <>
            <span className="day-client" title={clientName}>
              {clientName}
            </span>
            <span className="sub" title={`${item.title} · ${item.reference}`}>
              {item.title} · <CaseReference value={item.reference} />
            </span>
          </>
        ) : (
          <>
            <span className="flag">
              <Icon name="alert" small />
              Case not assigned
            </span>
            <span className="sub">Assign a case to review this period</span>
          </>
        )}
      </td>
      <td className="wrap">
        {period.label}
        <span className="sub">
          {taskLabel} · {rateLabel}
        </span>
        <span className="sub">
          {period.billable
            ? "Billable"
            : period.nonbillableReason
              ? nonbillableReasonLabels[period.nonbillableReason]
              : "Non-billable"}{" "}
          · {billingStatusLabels[period.billingStatus]} ·{" "}
          {
            timeValidationLabels[
              period.timeValidated ? ValidationStatus.Validated : ValidationStatus.Unvalidated
            ]
          }
        </span>
      </td>
      <td className="r num">
        <button
          className={`day-duration${period.durationOverrideMs !== null ? " corrected" : ""}`}
          disabled={period.billingStatus === BillingStatus.Billed || !openPeriodReview}
          aria-label={`Correct duration for ${period.label}`}
          title="Review and correct duration"
          onClick={openPeriodReview}
        >
          {formatNearestMinuteDuration(effectiveMs(period))}
          <Icon name="edit" small />
        </button>
        {period.durationOverrideMs !== null && (
          <span className="sub">was {formatNearestMinuteDuration(period.detectedDurationMs)}</span>
        )}
      </td>
      <td>
        <div className="day-actions">
          {openPeriodReview && (
            <button
              className="btn sm"
              data-review-period-id={period.id}
              onClick={() => openPeriodReview()}
            >
              Review
            </button>
          )}
          {period.timeValidated ? (
            <span className="day-validated">
              ✓ {timeValidationLabels[ValidationStatus.Validated]}
            </span>
          ) : period.caseId ? (
            <button
              className="btn sm attn"
              disabled={validating || validationUnavailable !== null}
              title={validationUnavailable ?? undefined}
              aria-busy={validating}
              onClick={() => void onValidate()}
            >
              Validate time
            </button>
          ) : null}
          <button
            className="btn sm"
            data-source-period-id={period.id}
            disabled={!sourceCount}
            onClick={() => openPeriodActivity()}
          >
            Sources
          </button>
        </div>
      </td>
    </tr>
  );
}
