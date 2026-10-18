import { stateValues, type StateValue } from "./values.js";

export const SourcePackScope = {
  Invoice: "invoice",
  Case: "case",
  DateRange: "dateRange",
  SelectedPeriods: "selectedPeriods",
} as const;
export type SourcePackScope = StateValue<typeof SourcePackScope>;
export const sourcePackScopes = stateValues(SourcePackScope);

export const SourcePackOption = {
  Blur: "blur",
  Personal: "personal",
  Audio: "audio",
  Audit: "audit",
} as const;
export type SourcePackOption = StateValue<typeof SourcePackOption>;
export const sourcePackOptions = stateValues(SourcePackOption);
