import { SourcePackScope, SourcePackOption } from "../../../contracts/states.generated";

export const sourcePackScopeLabels = {
  [SourcePackScope.Invoice]: "An invoice",
  [SourcePackScope.Case]: "The whole case",
  [SourcePackScope.DateRange]: "A date range",
  [SourcePackScope.SelectedPeriods]: "Selected work periods",
} satisfies Record<SourcePackScope, string>;

export const sourcePackOptionLabels = {
  [SourcePackOption.Blur]: "Redact other client names",
  [SourcePackOption.Personal]: "Exclude configured applications",
  [SourcePackOption.Audio]: "Include stored audio text",
  [SourcePackOption.Audit]: "Include audit history",
} satisfies Record<SourcePackOption, string>;

// Redaction is mandatory in canonical source packs, rather than a visible toggle.
export const selectableSourcePackOptions = Object.values(SourcePackOption).filter(
  (option) => option !== SourcePackOption.Blur,
);
export const defaultSourcePackOptions = [
  SourcePackOption.Blur,
  SourcePackOption.Personal,
  SourcePackOption.Audit,
];
