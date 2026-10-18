import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadFixture } from "./database.js";

// Browser checks must explicitly select a new disposable database.
if (!process.env.TIMEKEEPER_DB) throw Error("Set TIMEKEEPER_DB to an isolated test path");
const path = resolve(process.env.TIMEKEEPER_DB);
if (existsSync(path)) throw Error("The test database must not already exist");
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
try {
  loadFixture(db);
} finally {
  db.close();
}
