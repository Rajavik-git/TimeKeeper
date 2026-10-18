import {
  AvailabilityStatus,
  BillingStatus,
  NonbillableReason,
  ValidationStatus,
} from "../../../contracts/states.generated";

export const timeValidationLabels = {
  [ValidationStatus.Unvalidated]: "Time to validate",
  [ValidationStatus.Validated]: "Time validated",
} as const satisfies Record<ValidationStatus, string>;

export const sourceValidationLabels = {
  [ValidationStatus.Unvalidated]: "Source not validated",
  [ValidationStatus.Validated]: "Source validated",
} as const satisfies Record<ValidationStatus, string>;

export const billingStatusLabels = {
  [BillingStatus.Unbilled]: "Unbilled",
  [BillingStatus.Billed]: "Billed",
} as const satisfies Record<BillingStatus, string>;

export const nonbillableReasonLabels = {
  [NonbillableReason.Offered]: "No charge",
  [NonbillableReason.Internal]: "Internal",
  [NonbillableReason.Admin]: "Administrative",
} as const satisfies Record<NonbillableReason, string>;

export const availabilityLabels = {
  [AvailabilityStatus.Unknown]: "Availability not checked",
  [AvailabilityStatus.Available]: "Available",
  [AvailabilityStatus.Unavailable]: "Unavailable in Screenpipe",
} as const satisfies Record<AvailabilityStatus, string>;
