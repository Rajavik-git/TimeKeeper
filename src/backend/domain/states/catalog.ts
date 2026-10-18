import { stateValues, type StateValue } from "./values.js";

export const CaseStatus = {
  Active: "active",
  Archived: "archived",
} as const;
export type CaseStatus = StateValue<typeof CaseStatus>;
export const caseStatuses = stateValues(CaseStatus);

export const ClientType = {
  Individual: "individual",
  Company: "company",
} as const;
export type ClientType = StateValue<typeof ClientType>;
export const clientTypes = stateValues(ClientType);

export const ClientBillingMode = {
  Hourly: "hourly",
  Subscription: "subscription",
} as const;
export type ClientBillingMode = StateValue<typeof ClientBillingMode>;
export const clientBillingModes = stateValues(ClientBillingMode);

export const CaseBillingMode = {
  Hourly: "hourly",
  FlatFee: "flat_fee",
} as const;
export type CaseBillingMode = StateValue<typeof CaseBillingMode>;
export const caseBillingModes = stateValues(CaseBillingMode);

export const BaseUnit = {
  Hour: "hour",
  Intervention: "intervention",
} as const;
export type BaseUnit = StateValue<typeof BaseUnit>;
export const baseUnits = stateValues(BaseUnit);

export const PillDisplay = {
  Fees: "fees",
  Time: "time",
  Case: "case",
} as const;
export type PillDisplay = StateValue<typeof PillDisplay>;
export const pillDisplays = stateValues(PillDisplay);

export const ClientRuleType = {
  DailyResearchCap: "daily_research_cap",
  NonbillableTravel: "nonbillable_travel",
} as const;
export type ClientRuleType = StateValue<typeof ClientRuleType>;
export const clientRuleTypes = stateValues(ClientRuleType);

/** Built-in billing identities. Custom task codes remain open strings. */
export const SystemTaskCode = {
  Drafting: "REDAC",
  DocumentReview: "ANALY",
  Research: "RECH",
  Correspondence: "MAIL",
  ClientMeeting: "RDV",
  Call: "APPEL",
  Hearing: "AUD",
  Administrative: "ADMIN",
  CaseOrganization: "ORGA",
  Travel: "DEPL",
} as const;
export type SystemTaskCode = StateValue<typeof SystemTaskCode>;
export const systemTaskCodes = stateValues(SystemTaskCode);
