import type { BillingStatus, NonbillableReason } from "../../../../contracts/states.generated";
import {
  BillingStatus as BillingState,
  ValidationStatus,
} from "../../../../contracts/states.generated";
import {
  billingStatusLabels,
  nonbillableReasonLabels,
  timeValidationLabels,
} from "../../presentation/work-period";
import { Pill } from "../Pill/Pill";

export function Status({
  timeValidated,
  billingStatus,
  billable = true,
  reason = null,
}: {
  timeValidated: boolean;
  billingStatus: BillingStatus;
  billable?: boolean;
  reason?: NonbillableReason | null;
}) {
  if (!billable) {
    return <Pill kind="out">{reason ? nonbillableReasonLabels[reason] : "Non-billable"}</Pill>;
  }
  if (billingStatus === BillingState.Billed) {
    return <Pill kind="solid">{billingStatusLabels[billingStatus]}</Pill>;
  }
  const validation = timeValidated ? ValidationStatus.Validated : ValidationStatus.Unvalidated;
  return <Pill kind={timeValidated ? "ok" : "warn"}>{timeValidationLabels[validation]}</Pill>;
}
