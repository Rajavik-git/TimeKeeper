import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
const projectRoot = process.cwd();
import { refreshDemoRecognition } from "./recognition.js";
import { seedCanonicalDemo } from "./demo-core.js";
import type { components } from "../../../contracts/generated.js";
import { chooseRate } from "../../domain/pricing.js";

// The sidecar bundle substitutes these constants with the SQL files at build time.
declare const __TIMEKEEPER_SCHEMA_SQL__: string | undefined;
declare const __TIMEKEEPER_SEED_SQL__: string | undefined;
const schemaSql = () => typeof __TIMEKEEPER_SCHEMA_SQL__ === "undefined"
  ? readFileSync(resolve(projectRoot, "src/backend/adapters/sqlite/schema.sql"), "utf8")
  : __TIMEKEEPER_SCHEMA_SQL__;
const seedSql = () => typeof __TIMEKEEPER_SEED_SQL__ === "undefined"
  ? readFileSync(resolve(projectRoot, "src/backend/adapters/sqlite/seed.sql"), "utf8")
  : __TIMEKEEPER_SEED_SQL__;

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
  mkdirSync(dirname(path), { recursive: true });
  const firstRun = !existsSync(path);
  const db = new DatabaseSync(path);
  if (firstRun) {
    try {
      db.exec(schemaSql());
      db.exec(seedSql());
      refreshDemoRecognition(db);
      seedCanonicalDemo(db);
      return db;
    } catch (error) {
      db.close();
      rmSync(path, { force: true });
      throw error;
    }
  }
  const settingColumns=new Set((db.prepare('PRAGMA table_info(setting)').all() as Array<{name:string}>).map(row=>row.name));
  if(settingColumns.size){
    if(!settingColumns.has('pill_always_on_top')) db.exec("ALTER TABLE setting ADD COLUMN pill_always_on_top INTEGER NOT NULL DEFAULT 1 CHECK(pill_always_on_top IN (0,1))");
    if(!settingColumns.has('pill_display')) db.exec("ALTER TABLE setting ADD COLUMN pill_display TEXT NOT NULL DEFAULT 'fees' CHECK(pill_display IN ('fees','time','case'))");
    if(!settingColumns.has('pill_withhold_calls')) db.exec("ALTER TABLE setting ADD COLUMN pill_withhold_calls INTEGER NOT NULL DEFAULT 1 CHECK(pill_withhold_calls IN (0,1))");
  }
  seedCanonicalDemo(db);
  return db;
}
export function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql());
  db.exec(seedSql());
  refreshDemoRecognition(db);
  seedCanonicalDemo(db);
  return db;
}
export function reset(db: DatabaseSync) {
  for (const table of [
    "assignment_deliveries", "retrieval_progress", "reconstruction_conflicts",
    "pending_questions", "processed_commands", "sources", "tag_targets",
    "source_exports", "jev_reviews", "audit_events", "invoice_lines",
    "expenses", "demo_block_periods", "work_periods", "invoices", "client_rules", "markers",
    "task_types", "sessions", "cases", "clients", "settings",
  ]) db.exec(`DELETE FROM ${table}`);
  for (const t of [...tables].reverse()) db.exec(`DELETE FROM ${t}`);
  db.exec(seedSql());
  refreshDemoRecognition(db);
  seedCanonicalDemo(db);
}
export function normalize(row: Row): Row {
  const out = { ...row };
  for (const [k, v] of Object.entries(out))
    if (bools.has(k) && v !== null) out[k] = Boolean(v);
  return out;
}
export function sqlValue(v: unknown) {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}
export function all(db: DatabaseSync, table: Table): Row[] {
  return (db.prepare(`SELECT * FROM ${table}`).all() as Row[]).map(normalize);
}
export function one(
  db: DatabaseSync,
  table: Table,
  id: number,
): Row | undefined {
  const pk = table === "schema_version" ? "version" : "id";
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${pk}=?`).get(id) as
    Row | undefined;
  return row ? normalize(row) : undefined;
}
export function insert(db: DatabaseSync, table: Table, data: Row): Row {
  const keys = Object.keys(data);
  const id = Number(
    db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .run(...keys.map((k) => sqlValue(data[k]) as string | number | null))
      .lastInsertRowid,
  );
  return one(db, table, id)!;
}
export function update(
  db: DatabaseSync,
  table: Table,
  id: number,
  data: Row,
): Row {
  const allowed = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (x) => x.name,
    ),
  );
  const keys = Object.keys(data).filter(
    (k) => allowed.has(k) && k !== "id" && k !== "version",
  );
  if (!keys.length) throw Error("No updatable field");
  db.prepare(
    `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
  ).run(...keys.map((k) => sqlValue(data[k]) as string | number | null), id);
  const row = one(db, table, id);
  if (!row) throw Error("Not found");
  return row;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = work();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function audit(
  db: DatabaseSync,
  action: string,
  before = "",
  after = "",
  time_entry_id: number | null = null,
  block_id: number | null = null,
  actor = "Claire Morel",
) {
  const timestamp = `2026-10-16 ${new Date().toTimeString().slice(0, 5)}`;
  insert(db, "audit_event", {
    time_entry_id,
    block_id,
    timestamp,
    actor,
    action,
    before,
    after,
  });
}
export function state(db: DatabaseSync): components["schemas"]["State"] {
  const result: Row = {};
  for (const t of tables) result[t] = all(db, t);
  return result as components["schemas"]["State"];
}
export function rate(db: DatabaseSync, dossierId: number | null) {
  const cab = one(db, "firm", 1)!;
  const matter = dossierId ? one(db, "matter", dossierId) : undefined;
  const client = matter ? one(db, "client", Number(matter.client_id)) : undefined;
  return chooseRate({
    base_cents: Number(cab.base_rate_cents),
    client_cents: client ? Number(client.rate_cents) : undefined,
    matter_cents: matter?.own_rate_cents == null ? undefined : Number(matter.own_rate_cents),
    flat_fee: matter?.mode === "flat_fee",
  });
}
