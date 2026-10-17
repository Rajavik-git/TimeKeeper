import { refreshDemoRecognition } from "../src/backend/adapters/sqlite/recognition.js";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
const path = resolve(process.env.TIMEKEEPR_DB ?? "data/timekeepr.db");
mkdirSync(dirname(path), { recursive: true });
rmSync(path, { force: true });
const db = new DatabaseSync(path);
try {
  db.exec(readFileSync("src/backend/adapters/sqlite/schema.sql", "utf8"));
  db.exec(readFileSync("src/backend/adapters/sqlite/seed.sql", "utf8"));
  refreshDemoRecognition(db);
  console.log(`Database created: ${path}`);
} finally {
  db.close();
}
