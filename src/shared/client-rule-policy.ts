/** Existing API research-cap values are measured in tenths of an hour. */
export const RESEARCH_CAP_MINUTES_PER_UNIT = 6;
export const DEFAULT_DAILY_RESEARCH_CAP_MINUTES = 30;
export const DEFAULT_DAILY_RESEARCH_CAP_UNITS =
  DEFAULT_DAILY_RESEARCH_CAP_MINUTES / RESEARCH_CAP_MINUTES_PER_UNIT;

export const researchCapMinutes = (units: number) => units * RESEARCH_CAP_MINUTES_PER_UNIT;
export const researchCapDurationMs = (units: number) => researchCapMinutes(units) * 60000;
export const researchCapHours = (units: number) => researchCapMinutes(units) / 60;
export const researchCapUnits = (minutes: number) => minutes / RESEARCH_CAP_MINUTES_PER_UNIT;
