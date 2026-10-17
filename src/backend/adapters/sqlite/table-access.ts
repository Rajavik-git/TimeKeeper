import type { DatabaseSync } from "node:sqlite";
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { orm } from "./orm.js";
import { tables } from "./tables.js";

/** Compatibility routes select from this fixed schema map, never request SQL identifiers. */
export function mappedTable(name: string): SQLiteTable {
  if (!Object.hasOwn(tables, name)) throw Error("Unknown database table");
  return tables[name as keyof typeof tables];
}
export function readRows(db: DatabaseSync, name: string) {
  return orm(db).select().from(mappedTable(name)).all();
}
export function readRow(db: DatabaseSync, name: string, id: number | string) {
  const table = mappedTable(name);
  const columns = getTableColumns(table);
  const key = columns[name === "schema_version" ? "version" : "id"];
  if (!key) throw Error("Table has no compatibility identity");
  return orm(db).select().from(table).where(eq(key, id)).get();
}
export function writeRow(
  db: DatabaseSync,
  name: string,
  data: Record<string, string | number | null>,
  id?: number | string,
) {
  const table = mappedTable(name);
  if (id === undefined) return orm(db).insert(table).values(data).run();
  const key = getTableColumns(table).id;
  if (!key) throw Error("Table has no compatibility identity");
  return orm(db).update(table).set(data).where(eq(key, id)).run();
}
export function deleteRow(db: DatabaseSync, name: string, id: number | string) {
  const table = mappedTable(name);
  const key = getTableColumns(table).id;
  if (!key) throw Error("Table has no compatibility identity");
  orm(db).delete(table).where(eq(key, id)).run();
}
