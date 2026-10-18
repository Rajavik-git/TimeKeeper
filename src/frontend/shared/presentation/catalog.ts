import {
  BaseUnit,
  CaseBillingMode,
  CaseStatus,
  ClientBillingMode,
  ClientRuleType,
  ClientType,
  MarkerType,
  PillDisplay,
} from "../../../contracts/states.generated";

/** Display wording belongs to the interface, separate from stored state values. */
export const clientTypeLabels = {
  [ClientType.Individual]: "Individual",
  [ClientType.Company]: "Company",
} as const satisfies Record<ClientType, string>;

export const clientBillingModeLabels = {
  [ClientBillingMode.Hourly]: "Hourly",
  [ClientBillingMode.Subscription]: "Subscription",
} as const satisfies Record<ClientBillingMode, string>;

export const caseBillingModeLabels = {
  [CaseBillingMode.Hourly]: "Hourly",
  [CaseBillingMode.FlatFee]: "Flat fee",
} as const satisfies Record<CaseBillingMode, string>;

export const caseStatusLabels = {
  [CaseStatus.Active]: "Active",
  [CaseStatus.Archived]: "Archived",
} as const satisfies Record<CaseStatus, string>;

export const markerTypeLabels = {
  [MarkerType.Reference]: "Case reference",
  [MarkerType.CaseNumber]: "Case number",
  [MarkerType.OpposingParty]: "Opposing party",
  [MarkerType.ClientName]: "Client name",
  [MarkerType.File]: "File",
  [MarkerType.Email]: "Email",
  [MarkerType.Domain]: "Website domain",
  [MarkerType.Keyword]: "Keyword",
} as const satisfies Record<MarkerType, string>;

export const baseUnitLabels = {
  [BaseUnit.Hour]: "Hour",
  [BaseUnit.Intervention]: "Intervention",
} as const satisfies Record<BaseUnit, string>;

export const pillDisplayLabels = {
  [PillDisplay.Fees]: "Estimated fees",
  [PillDisplay.Time]: "Time",
  [PillDisplay.Case]: "Case",
} as const satisfies Record<PillDisplay, string>;

export const clientRuleTypeLabels = {
  [ClientRuleType.DailyResearchCap]: "Daily research limit",
  [ClientRuleType.NonbillableTravel]: "Non-billable travel",
} as const satisfies Record<ClientRuleType, string>;
