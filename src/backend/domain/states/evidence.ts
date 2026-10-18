import { stateValues, type StateValue } from "./values.js";

export const AvailabilityStatus = {
  Unknown: "unknown",
  Available: "available",
  Unavailable: "unavailable",
} as const;
export type AvailabilityStatus = StateValue<typeof AvailabilityStatus>;
export const availabilityStatuses = stateValues(AvailabilityStatus);

export const CoverageGapStatus = {
  Pending: "pending",
  Failed: "failed",
} as const;
export type CoverageGapStatus = StateValue<typeof CoverageGapStatus>;
export const coverageGapStatuses = stateValues(CoverageGapStatus);

export const DeliveryStatus = {
  Pending: "pending",
  Verified: "verified",
  Failed: "failed",
  Blocked: "blocked",
} as const;
export type DeliveryStatus = StateValue<typeof DeliveryStatus>;
export const deliveryStatuses = stateValues(DeliveryStatus);

export const RetrievalStatus = {
  Pending: "pending",
  Complete: "complete",
  Failed: "failed",
} as const;
export type RetrievalStatus = StateValue<typeof RetrievalStatus>;
export const retrievalStatuses = stateValues(RetrievalStatus);
