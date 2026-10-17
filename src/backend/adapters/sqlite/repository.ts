import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const projectRoot = process.cwd();
import { refreshDemoRecognition } from "./recognition.js";
import type { components } from "../../../contracts/generated.js";
import { calculateLine, chooseRate } from "../../domain/pricing.js";

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
  "billable_by_default",
  "off_screen",
  "vat_applicable",
  "learned",
  "available",
  "billable",
  "vat",
]);
export function openDb(
  path = resolve(projectRoot, process.env.TIMEKEEPR_DB ?? "data/timekeepr.db"),
) {
  return new DatabaseSync(path);
}
export function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(resolve(projectRoot, "src/backend/adapters/sqlite/schema.sql"), "utf8"));
  db.exec(readFileSync(resolve(projectRoot, "src/backend/adapters/sqlite/seed.sql"), "utf8"));
  refreshDemoRecognition(db);
  return db;
}
export function reset(db: DatabaseSync) {
  for (const t of [...tables].reverse()) db.exec(`DELETE FROM ${t}`);
  db.exec(readFileSync(resolve(projectRoot, "src/backend/adapters/sqlite/seed.sql"), "utf8"));
  refreshDemoRecognition(db);
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
  result.pricing = pricingMap(db);
  result.alerts = ruleAlerts(db);
  result.invoice_previews = invoicePreviews(db);
  return result as components["schemas"]["State"];
}
export function pricingMap(db: DatabaseSync) {
  const map: Record<string, ReturnType<typeof priceLine>> = {};
  for (const line of all(db, "time_entry"))
    map[String(line.id)] = priceLine(db, line);
  return map;
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
export function priceLine(db: DatabaseSync, line: Row) {
  const r = rate(db, line.matter_id as number | null);
  const matter = line.matter_id
    ? one(db, "matter", Number(line.matter_id))
    : undefined;
  const client = matter
    ? one(db, "client", Number(matter.client_id))
    : undefined;
  const reference = r.flat_fee
    ? Number(
        matter?.own_rate_cents ??
          client?.rate_cents ??
          one(db, "firm", 1)!.base_rate_cents,
      )
    : r.rate_cents;
  const travel_excluded = Boolean(
    client &&
    all(db, "client_rule").some(
      (x) => x.client_id === client.id && x.type === "nonbillable_travel",
    ) &&
    one(db, "task", Number(line.task_id))?.code === "DEPL"
  );
  return calculateLine({
    tenths: Number(line.tenths_of_hour),
    reference_cents: reference,
    rate: r,
    billable: Boolean(line.billable),
    travel_excluded,
    billed_amount: line.billing_status === "billed" ? Number(line.amount_cents) : undefined,
  });
}
export function reprice(db: DatabaseSync) {
  for (const l of all(db, "time_entry")) {
    if (l.billing_status === "billed") continue;
    const p = priceLine(db, l);
    db.prepare(
      "UPDATE time_entry SET amount_cents=?,rate_origin=? WHERE id=?",
    ).run(p.amount_cents, p.origin, Number(l.id));
  }
}

export function ruleAlerts(db: DatabaseSync): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const entries = all(db, "time_entry");
  for (const matter of all(db, "matter")) {
    const alerts: string[] = [];
    for (const rule of all(db, "client_rule").filter(
      (r) => r.client_id === matter.client_id,
    )) {
      const unbilled = entries.filter(
        (e) =>
          e.matter_id === matter.id &&
          e.billable &&
          e.billing_status !== "billed",
      );
      if (rule.type === "daily_research_cap") {
        for (const date of new Set(
          unbilled
            .filter((e) => one(db, "task", Number(e.task_id))?.code === "RECH")
            .map((e) => String(e.date)),
        )) {
          const tenths = unbilled
            .filter(
              (e) =>
                e.date === date &&
                one(db, "task", Number(e.task_id))?.code === "RECH",
            )
            .reduce((n, e) => n + Number(e.tenths_of_hour), 0);
          if (tenths > Number(rule.value))
            alerts.push(
              `${rule.label}: ${(tenths / 10).toFixed(1)} h on ${date}.`,
            );
        }
      }
      if (rule.type === "nonbillable_travel")
        for (const e of unbilled.filter(
          (e) => one(db, "task", Number(e.task_id))?.code === "DEPL",
        ))
          alerts.push(`${rule.label}: ${e.label}.`);
    }
    result[String(matter.id)] = alerts;
  }
  return result;
}

export function invoicePreviews(db: DatabaseSync) {
  const previews: Record<
    string,
    {
      final: ReturnType<typeof invoicePreview>;
      deposit: ReturnType<typeof invoicePreview>;
    }
  > = {};
  for (const matter of all(db, "matter"))
    previews[String(matter.id)] = {
      final: invoicePreview(db, Number(matter.id), "final"),
      deposit: invoicePreview(db, Number(matter.id), "deposit"),
    };
  return previews;
}

export function invoicePreview(
  db: DatabaseSync,
  matterId: number,
  type: "final" | "deposit",
) {
  const matter = one(db, "matter", matterId)!;
  const client = one(db, "client", Number(matter.client_id))!;
  const firm = one(db, "firm", 1)!;
  const setting = rate(db, matterId);
  const entries = all(db, "time_entry").filter(
    (e) =>
      e.matter_id === matterId && e.billable && e.billing_status !== "billed",
  );
  const flat_fee_due =
    setting.flat_fee &&
    type === "final" &&
    !all(db, "invoice").some(
      (i) => i.matter_id === matterId && i.type === "final",
    );
  const fees_cents = setting.flat_fee
    ? flat_fee_due
      ? Number(matter.flat_fee_cents)
      : 0
    : entries.reduce((n, e) => n + Number(e.amount_cents), 0);
  const expenses = all(db, "expense").filter(
    (e) => e.matter_id === matterId && !e.invoice_id,
  );
  const expenses_cents = expenses
    .filter((e) => e.type === "expense")
    .reduce((n, e) => n + Number(e.amount_cents), 0);
  const disbursements_cents = expenses
    .filter((e) => e.type === "disbursement")
    .reduce((n, e) => n + Number(e.amount_cents), 0);
  const vat_cents = client.vat_applicable
    ? Math.round(((fees_cents + expenses_cents) * Number(firm.vat_rate)) / 100)
    : 0;
  return {
    fees_cents,
    expenses_cents,
    disbursements_cents,
    vat_cents,
    total_cents: fees_cents + expenses_cents + disbursements_cents + vat_cents,
    pending_entries: entries.filter((e) => e.review_status !== "approved")
      .length,
    flat_fee_due,
    rate_cents: setting.rate_cents,
    rate_origin: setting.origin,
  };
}
