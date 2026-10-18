import { CaseBillingMode } from "../../domain/states.js";
import { AppError } from "../../application/errors.js";
import { readRow, readRows, writeRow } from "./table-access.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const projectRoot = process.cwd();
import { initializeDatabase } from "./initialize.js";
import type { components } from "../../../contracts/generated.js";
import { blocks, entries, insertEntry } from "./entries.js";
import { catalogRows, catalogWrite } from "./catalog.js";
import { transaction as sqliteTransaction } from "./transaction.js";
import { chooseRate } from "../../domain/pricing.js";

export const tables = [
  "firm",
  "setting",
  "task",
  "client",
  "matter",
  "marker",
  "client_rule",
  "block",
  "source",
  "pause",
  "jev_review",
  "invoice",
  "time_entry",
  "expense",
  "invoice_line",
  "audit_event",
  "source_export",
  "schema_version",
] as const;
export type Table = (typeof tables)[number];
export type Row = Record<string, unknown>;
const bools = new Set([
  "notifications",
  "pill_always_on_top",
  "pill_withhold_calls",
  "billable_by_default",
  "off_screen",
  "vat_applicable",
  "learned",
  "available",
  "billable",
  "vat",
]);
export function openDb(
  path = resolve(projectRoot, process.env.TIMEKEEPER_DB ?? "data/timekeeper.db"),
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    initializeDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function normalize(row: Row): Row {
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) if (bools.has(k) && v !== null) out[k] = Boolean(v);
  return out;
}
export function sqlValue(v: unknown) {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}
function databaseValue(value: unknown): string | number | null {
  const result = sqlValue(value);
  if (result === null || typeof result === "string" || typeof result === "number") return result;
  throw Error("Invalid database value");
}
const optionalHistoricalTables = new Set<Table>(["block", "pause", "jev_review", "schema_version"]);
function historicalTableMissing(db: DatabaseSync, table: Table): boolean {
  return (
    optionalHistoricalTables.has(table) &&
    !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  );
}
export function all(db: DatabaseSync, table: Table): Row[] {
  if (historicalTableMissing(db, table)) return [];
  if (table === "time_entry") return entries(db);
  if (table === "block") return blocks(db);
  return (catalogRows(db, table) ?? readRows(db, table)).map(normalize);
}
export function one(db: DatabaseSync, table: Table, id: number | string): Row | undefined {
  if (historicalTableMissing(db, table)) return undefined;
  if (table === "time_entry")
    return entries(db, true).find((item) => String(item.id) === String(id));
  if (table === "block") return blocks(db).find((item) => String(item.id) === String(id));
  const projected = catalogRows(db, table);
  if (projected) return projected.map(normalize).find((row) => String(row.id) === String(id));
  const row = readRow(db, table, id);
  return row ? normalize(row) : undefined;
}
export function insert(db: DatabaseSync, table: Table, data: Row): Row {
  if (historicalTableMissing(db, table))
    throw new AppError("pending", "historical capture controls are unavailable");
  if (table === "time_entry") return insertEntry(db, data);
  const projected = catalogWrite(db, table, data);
  if (projected) return normalize(projected);
  const values = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, databaseValue(value)]),
  );
  const id = Number(writeRow(db, table, values).lastInsertRowid);
  return one(db, table, id)!;
}
export function update(db: DatabaseSync, table: Table, id: number | string, data: Row): Row {
  if (table === "time_entry")
    throw new AppError("invalid-request", "period writes require an application use case");
  if (table === "block")
    data = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "matter_id"));
  const projected = catalogWrite(db, table, data, id);
  if (projected) return normalize(projected);
  const allowed = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((x) => x.name),
  );
  const keys = Object.keys(data).filter((k) => allowed.has(k) && k !== "id" && k !== "version");
  if (!keys.length) throw Error("No updatable field");
  writeRow(db, table, Object.fromEntries(keys.map((key) => [key, databaseValue(data[key])])), id);
  const row = one(db, table, id);
  if (!row) throw new AppError("not-found", "resource not found");
  return row;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  return sqliteTransaction(db, work);
}
export function audit(
  db: DatabaseSync,
  action: string,
  before = "",
  after = "",
  time_entry_id: number | null = null,
  block_id: number | null = null,
  actor?: string,
) {
  const timestamp = new Date().toISOString();
  const auditActor = actor ?? (String(one(db, "firm", 1)?.lawyer_name ?? "").trim() || "User");
  db.prepare(
    `INSERT INTO audit_events(work_period_id,timestamp,actor,action,before,after) VALUES (?,?,?,?,?,?)`,
  ).run(
    time_entry_id === null
      ? block_id === null
        ? null
        : (db.prepare("SELECT period_id FROM demo_block_periods WHERE block_id=?").get(block_id)
            ?.period_id ?? null)
      : (db.prepare("SELECT period_id FROM demo_period_entries WHERE entry_id=?").get(time_entry_id)
          ?.period_id ?? String(time_entry_id)),
    timestamp,
    auditActor,
    action,
    before,
    after,
  );
}
export function state(db: DatabaseSync): components["schemas"]["State"] {
  const result: Row = {};
  for (const t of tables)
    result[t] = all(db, t).map((row) => {
      if (t !== "source") return row;
      const { work_period_id: _period, ...publicRow } = row;
      return publicRow;
    });
  return result as components["schemas"]["State"];
}
export function rate(db: DatabaseSync, dossierId: number | string | null) {
  const cab = one(db, "firm", 1)!;
  const matter = dossierId ? one(db, "matter", dossierId) : undefined;
  const client = matter ? one(db, "client", String(matter.client_id)) : undefined;
  return chooseRate({
    base_cents: Number(cab.base_rate_cents),
    client_cents: client?.rate_cents == null ? undefined : Number(client.rate_cents),
    matter_cents: matter?.own_rate_cents == null ? undefined : Number(matter.own_rate_cents),
    flat_fee: matter?.mode === CaseBillingMode.FlatFee,
  });
}
