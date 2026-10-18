import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedCanonicalDemo } from "./demo-core.js";
import { refreshDemoRecognition } from "./recognition.js";

/** Fictional records for isolated automated tests only. */
export function loadFixture(db: DatabaseSync): void {
  db.exec(readFileSync(resolve("src/backend/adapters/sqlite/schema.sql"), "utf8"));
  db.exec(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
  seedCanonicalDemo(db);
  refreshDemoRecognition(db);
}

export function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  loadFixture(db);
  return db;
}
