import { systemTimeZone } from "../../shared/dates";
import type { components } from "../../contracts/generated";

export type SourcePackRequest = components["schemas"]["CanonicalSourcePackRequest"];
export type SourcePackScope = SourcePackRequest["scope"];
export type SourcePackOption = SourcePackRequest["options"][number];

/** Freeze the desktop calendar zone used to select date-range evidence. */
export function sourcePackRequest(body: SourcePackRequest): SourcePackRequest {
  return { ...body, timeZone: systemTimeZone() };
}
