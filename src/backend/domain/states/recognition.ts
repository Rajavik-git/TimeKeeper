import { stateValues, type StateValue } from "./values.js";

export const MarkerType = {
  Reference: "reference",
  CaseNumber: "case_number",
  OpposingParty: "opposing_party",
  ClientName: "client_name",
  File: "file",
  Email: "email",
  Domain: "domain",
  Keyword: "keyword",
} as const;
export type MarkerType = StateValue<typeof MarkerType>;
export const markerTypes = stateValues(MarkerType);

export const SignalPlace = {
  App: "app",
  WindowTitle: "window_title",
  BrowserUrl: "browser_url",
  Ocr: "ocr",
  Audio: "audio",
  Speaker: "speaker",
} as const;
export type SignalPlace = StateValue<typeof SignalPlace>;
export const signalPlaces = stateValues(SignalPlace);
