import { getTableColumns } from "drizzle-orm";
import { mappedTable, readRows, writeRow } from "./table-access.js";
import { displayId } from "./identifiers.js";
import { ensureCompatibilityEntryId } from "./entries.js";
import type { components } from "../../../contracts/generated.js";
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;
interface Projection {
  table: string;
  rename?: Record<string, string>;
  numericIds?: string[];
}
type CompatibilityPayloads = Pick<
  components["schemas"],
  | "client"
  | "matter"
  | "firm"
  | "setting"
  | "task"
  | "marker"
  | "client_rule"
  | "expense"
  | "invoice"
  | "invoice_line"
  | "audit_event"
  | "source_export"
> & { source: components["schemas"]["source"] & { work_period_id: string | null } };
type CompatibilityFields = {
  [Name in keyof CompatibilityPayloads]: readonly (keyof CompatibilityPayloads[Name])[];
};
/** Reject both unknown names and missing contract fields at compile time. */
function defineCompatibilityFields<const Fields extends CompatibilityFields>(
  fields: Fields & {
    [Name in keyof CompatibilityPayloads]: Exclude<
      keyof CompatibilityPayloads[Name],
      Fields[Name][number]
    > extends never
      ? unknown
      : never;
  },
): Fields {
  return fields;
}
/** Explicit wire fields for the imported interface; independent of historical SQL tables. */
const compatibilityFields = defineCompatibilityFields({
  client: ["id", "name", "code", "type", "mode", "rate_cents", "vat_applicable", "billing_address"],
  matter: [
    "id",
    "client_id",
    "reference",
    "title",
    "category",
    "case_number",
    "opposing_party",
    "mode",
    "own_rate_cents",
    "flat_fee_cents",
    "hour_cap",
    "success_fee_percent",
    "budget_cents",
    "status",
    "opened_on",
  ],
  firm: [
    "id",
    "lawyer_name",
    "address",
    "vat_number",
    "base_rate_cents",
    "base_unit",
    "vat_rate",
    "currency",
  ],
  setting: [
    "id",
    "confidence_threshold",
    "excluded_apps",
    "capture_retention",
    "notifications",
    "pill_position",
    "pill_always_on_top",
    "pill_display",
    "pill_withhold_calls",
    "invoice_prefix",
    "next_number",
  ],
  task: ["id", "code", "label", "billable_by_default", "off_screen", "sort_order"],
  marker: ["id", "matter_id", "type", "value", "weight", "learned", "hits", "last_seen_at"],
  client_rule: ["id", "client_id", "type", "value", "label"],
  expense: ["id", "matter_id", "date", "label", "type", "amount_cents", "invoice_id"],
  invoice: [
    "id",
    "matter_id",
    "number",
    "date",
    "type",
    "subtotal_cents",
    "vat_cents",
    "disbursements_cents",
    "status",
  ],
  invoice_line: [
    "id",
    "invoice_id",
    "origin",
    "origin_id",
    "label",
    "tenths_of_hour",
    "rate_cents",
    "amount_cents",
    "vat",
  ],
  source: [
    "id",
    "block_id",
    "type",
    "screenpipe_ref",
    "timestamp",
    "excerpt",
    "detected_marker",
    "available",
    "work_period_id",
  ],
  audit_event: [
    "id",
    "time_entry_id",
    "block_id",
    "timestamp",
    "actor",
    "action",
    "before",
    "after",
  ],
  source_export: ["id", "time_entry_ids", "options", "sha256", "created_at"],
});
const projections: Record<string, Projection> = {
  client: { table: "clients", rename: { rate_cents: "hourly_rate_cents" }, numericIds: ["id"] },
  matter: {
    table: "cases",
    rename: { own_rate_cents: "hourly_rate_cents" },
    numericIds: ["id", "client_id"],
  },
  firm: { table: "settings", rename: { base_rate_cents: "global_hourly_rate_cents" } },
  setting: { table: "settings" },
  task: { table: "task_types" },
  marker: { table: "markers", rename: { matter_id: "case_id" }, numericIds: ["case_id"] },
  client_rule: { table: "client_rules", numericIds: ["client_id"] },
  expense: { table: "expenses", rename: { matter_id: "case_id" }, numericIds: ["case_id"] },
  invoice: { table: "invoices", rename: { matter_id: "case_id" }, numericIds: ["case_id"] },
  invoice_line: { table: "invoice_lines", rename: { tenths_of_hour: "billed_minutes" } },
  source: {
    table: "sources",
    rename: { type: "content_type", screenpipe_ref: "external_id", timestamp: "recorded_at" },
    numericIds: ["id"],
  },
  audit_event: {
    table: "audit_events",
    rename: { time_entry_id: "work_period_id" },
    numericIds: ["work_period_id"],
  },
  source_export: {
    table: "source_exports",
    rename: { time_entry_ids: "period_ids_json", options: "options_json" },
  },
};
export function canonicalTable(db: DatabaseSync, name: string): Projection | undefined {
  const projection = projections[name];
  return projection &&
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(projection.table)
    ? projection
    : undefined;
}
function numericId(value: unknown): unknown {
  return typeof value === "string" ? displayId(value) : value;
}
function project(name: string, projection: Projection, row: Row): Row {
  const result = { ...row };
  for (const field of projection.numericIds ?? []) result[field] = numericId(result[field]);
  for (const [external, internal] of Object.entries(projection.rename ?? {})) {
    result[external] = result[internal];
    if (external !== internal) delete result[internal];
  }
  if (name === "matter") result.status = result.status === "archived" ? "closed" : "open";
  if (name === "invoice_line") {
    result.tenths_of_hour = Number(result.tenths_of_hour) / 6;
    if (result.origin === "work_period") result.origin = "time_entry";
    result.origin_id = numericId(result.origin_id);
  }
  return result;
}
export function catalogRows(db: DatabaseSync, name: string): Row[] | undefined {
  const projection = canonicalTable(db, name);
  if (!projection) return undefined;
  return readRows(db, projection.table).map((row) => {
    const result = project(name, projection, row);
    if (name === "client") result.code ??= "";
    if (name === "matter") result.opened_on ??= "";
    if (name === "source" || name === "audit_event") {
      const periodId = row.work_period_id;
      const link = db
        .prepare("SELECT block_id FROM demo_block_periods WHERE period_id=?")
        .get(periodId === null ? null : String(periodId));
      result.block_id = link?.block_id ?? null;
      if (name === "source") {
        result.available = row.availability_status === "available";
        result.excerpt ??= "";
        result.detected_marker ??= "";
      }
      if (name === "audit_event" && row.work_period_id !== null)
        result.time_entry_id = ensureCompatibilityEntryId(db, String(row.work_period_id));
    }
    return Object.fromEntries(
      compatibilityFields[name as keyof typeof compatibilityFields].map((key) => [
        key,
        result[key],
      ]),
    );
  });
}
function input(value: unknown): string | number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw Error("Invalid database value");
}
export function catalogWrite(
  db: DatabaseSync,
  name: string,
  values: Row,
  id?: number | string,
): Row | undefined {
  const projection = canonicalTable(db, name);
  if (!projection) return undefined;
  const columns = getTableColumns(mappedTable(projection.table));
  const allowed = new Set(Object.keys(columns));
  const textFields = new Set(
    Object.entries(columns)
      .filter(([, column]) => column.dataType === "string")
      .map(([name]) => name),
  );
  const data: Record<string, string | number | null> = {};
  for (const [external, value] of Object.entries(values)) {
    const field = projection.rename?.[external] ?? external;
    if (!allowed.has(field) || field === "id" || field === "created_at" || field === "updated_at")
      continue;
    data[field] = input(
      name === "matter" && field === "status"
        ? value === "closed"
          ? "archived"
          : "active"
        : value,
    );
  }
  for (const [field, value] of Object.entries(data))
    if (textFields.has(field) && typeof value === "number") data[field] = String(value);
  const now = new Date().toISOString();
  if (allowed.has("updated_at")) data.updated_at = now;
  if (id === undefined) {
    if (allowed.has("created_at")) data.created_at = now;
    if (name === "client" || name === "matter") {
      const next = db
        .prepare(`SELECT COALESCE(MAX(CAST(id AS INTEGER)),0)+1 AS id FROM ${projection.table}`)
        .get();
      data.id = String(next?.id);
    }
    const result = writeRow(db, projection.table, data);
    id = data.id === undefined ? Number(result.lastInsertRowid) : Number(data.id);
  } else {
    const keys = Object.keys(data);
    if (!keys.length) throw Error("No updatable field");
    writeRow(db, projection.table, data, textFields.has("id") ? String(id) : id);
  }
  return catalogRows(db, name)?.find((row) => String(row.id) === String(id));
}
