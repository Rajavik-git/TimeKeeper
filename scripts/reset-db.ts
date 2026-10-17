import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../src/backend/adapters/sqlite/repository.js";

const path = resolve(process.env.TIMEKEEPER_DB ?? "data/timekeeper.db");
rmSync(path, { force: true });
const db = openDb(path);
db.close();
console.log(`Empty database created: ${path}`);
