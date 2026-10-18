import { calendarDay, isCalendarDay, isTimeZone, systemTimeZone } from "../../shared/dates.js";
import type { components } from "../../contracts/generated.js";
import type { PeriodView } from "../../contracts/index.js";
import { AppError } from "./errors.js";

type State = components["schemas"]["State"];
export type SourcePackScope = "invoice" | "case" | "period" | "chosen";
export interface SourcePackFilters {
  invoiceId?: number;
  timeZone?: string;
  from?: string;
  to?: string;
  periodIds?: Array<string | number>;
}
export interface SourcePackSource {
  [field: string]: unknown;
  work_period_id: string | null;
  block_id: number | null;
  type: string;
  excerpt: string;
  detected_marker: string;
}
type Snapshot = Pick<State, "time_entry" | "setting" | "block" | "client" | "audit_event">;
type PackEntry = Partial<Omit<components["schemas"]["time_entry"], "id">> & {
  id: string;
  matter_id: number | string;
  invoice_id: number | null;
  date: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  effective_duration_ms: number | null;
};
interface SelectedPeriod {
  entry: PackEntry;
  compatibilityId: number;
}

function matchesScope(
  { entry, compatibilityId }: SelectedPeriod,
  scope: SourcePackScope,
  filters: SourcePackFilters,
): boolean {
  if (scope === "invoice") return entry.invoice_id === filters.invoiceId;
  if (scope === "period")
    return entry.date >= (filters.from ?? "") && entry.date <= (filters.to ?? "");
  if (scope === "chosen")
    return (
      filters.periodIds?.some((id) =>
        typeof id === "string" ? id === entry.id : id === compatibilityId,
      ) ?? false
    );
  return true;
}

function redactStrings(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, redact));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStrings(item, redact)]),
    );
  return value;
}

/** Builds export contents from one storage snapshot; the caller owns persistence. */
export function buildCaseSourcePack(input: {
  caseId: number | string;
  clientId: string;
  scope: SourcePackScope;
  options: string[];
  filters: SourcePackFilters;
  snapshot: Snapshot;
  // Public state removes work_period_id. Export selection needs the original source rows.
  sourceRows: readonly SourcePackSource[];
  periods: readonly PeriodView[];
  compatibilityEntryIds: ReadonlyMap<string, number>;
}) {
  const { caseId, clientId, scope, options, filters, snapshot } = input;
  const timeZone = filters.timeZone ?? systemTimeZone();
  if (!isTimeZone(timeZone)) throw new AppError("invalid-request", "invalid timeZone");
  for (const day of [filters.from, filters.to]) {
    if (day !== undefined && !isCalendarDay(day))
      throw new AppError("invalid-request", "source pack dates must be valid calendar days");
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw new AppError("invalid-request", "from must be on or before to");
  const legacyEntries = new Map(snapshot.time_entry.map((entry) => [entry.id, entry]));
  const candidates = input.periods
    .filter((period) => period.caseId === String(caseId) && !period.excluded)
    .map((period): SelectedPeriod => {
      const compatibilityId = input.compatibilityEntryIds.get(period.id);
      if (compatibilityId === undefined) throw Error("Compatibility entry ID not found");
      return {
        compatibilityId,
        entry: {
          ...legacyEntries.get(compatibilityId),
          id: period.id,
          matter_id: caseId,
          invoice_id: period.invoiceId ?? null,
          date: calendarDay(period.startedAt, timeZone),
          label: period.label ?? "",
          started_at: period.startedAt,
          ended_at: period.endedAt,
          effective_duration_ms: period.durationOverrideMs ?? period.detectedDurationMs,
        },
      };
    });
  const blockedApps = (snapshot.setting[0]?.excluded_apps ?? "")
    .split(",")
    .map((app) => app.trim().toLocaleLowerCase("en-US"));
  const blockApps = new Map(
    snapshot.block.map((block) => [block.id, block.app.toLocaleLowerCase("en-US")]),
  );
  const isBlocked = (blockId: number | null | undefined) =>
    blockId != null && blockedApps.some((app) => app && blockApps.get(blockId)?.includes(app));
  const selected = candidates.filter(
    (period) =>
      matchesScope(period, scope, filters) &&
      (!options.includes("personal") || !isBlocked(period.entry.block_id)),
  );
  if (!selected.length) throw new AppError("invalid-request", "No periods in source pack scope");
  const entries = selected.map((period) => period.entry);
  const periodIds = entries.map((entry) => entry.id);
  const selectedIds = new Set(periodIds);
  const selectedEntryIds = new Set(selected.map((period) => period.compatibilityId));
  const otherNames = snapshot.client
    .filter((client) => String(client.id) !== clientId)
    .map((client) => client.name);
  const redact = (text: string) =>
    options.includes("blur")
      ? otherNames.reduce((out, name) => out.replaceAll(name, "[client redacted]"), text)
      : text;
  const sources = input.sourceRows
    .filter(
      (source) =>
        source.work_period_id !== null &&
        selectedIds.has(source.work_period_id) &&
        (options.includes("transcripts") || source.type !== "audio") &&
        (!options.includes("personal") || !isBlocked(source.block_id)),
    )
    .map((source) => ({
      ...source,
      excerpt: redact(source.excerpt),
      detected_marker: redact(source.detected_marker),
    }));
  const audit = options.includes("audit")
    ? snapshot.audit_event
        .filter((event) => selectedEntryIds.has(Number(event.time_entry_id)))
        .map((event) => ({ ...event, before: redact(event.before), after: redact(event.after) }))
    : [];
  const pack = { caseId, scope, timeZone, entries, sources, audit, options };
  return {
    payload: JSON.stringify(redactStrings(pack, redact)),
    periodIds,
    firstCompatibilityEntryId: selected[0].compatibilityId,
  };
}
