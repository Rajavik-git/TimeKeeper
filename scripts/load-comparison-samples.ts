import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { openDb } from "../src/backend/adapters/sqlite/repository.js";
import { comparisonSamplePlan } from "./comparison-samples/plan.js";
import { loadComparisonSamples } from "./comparison-samples/load.js";

const { values } = parseArgs({
  options: {
    database: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.database?.trim()) {
  throw new Error(
    "An explicit --database PATH is required. Usage: npm run db:samples -- --database /tmp/timekeeper-comparison.db [--dry-run]",
  );
}
const path = resolve(values.database);
const plan = comparisonSamplePlan();
console.log(`Comparison samples: ${plan.today} vs ${plan.previousDay}`);
console.log(`Database: ${path}`);
const currentMs = plan.periods
  .filter((period) => period.day === plan.today)
  .reduce((sum, period) => sum + period.durationMs, 0);
const previousMs = plan.periods
  .filter((period) => period.day === plan.previousDay)
  .reduce((sum, period) => sum + period.durationMs, 0);
const minutes = (milliseconds: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(milliseconds / 60000);
const change = ((currentMs - previousMs) * 100) / previousMs;
console.log(
  `Planned sample time: ${minutes(currentMs)} min vs ${minutes(previousMs)} min (${change >= 0 ? "+" : ""}${change}%).`,
);
console.log(
  "Existing sample batches and human edits are retained, so actual aggregate figures can differ.",
);
if (values["dry-run"]) {
  console.log(JSON.stringify(plan, null, 2));
  console.log("Dry run: no database was opened or changed.");
} else {
  const existing = existsSync(path);
  if (existing) {
    const backupPath = resolve(dirname(path), "backups", `comparison-${randomUUID()}.db`);
    mkdirSync(dirname(backupPath), { recursive: true });
    const original = new DatabaseSync(path, { readOnly: true });
    try {
      const reference = openDb(":memory:");
      try {
        const versions = (database: DatabaseSync) =>
          database.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
        if (JSON.stringify(versions(original)) !== JSON.stringify(versions(reference)))
          throw new Error(
            "Database migrations differ. Apply the normal application migration before importing samples.",
          );
      } finally {
        reference.close();
      }
      await backup(original, backupPath);
      console.log(`Backup: ${backupPath}`);
    } finally {
      original.close();
    }
  }
  const db = existing ? new DatabaseSync(path) : openDb(path);
  try {
    const result = loadComparisonSamples(db, plan);
    console.log(JSON.stringify(result));
    console.log(
      "Open Cases to view [Sample] client bars and this month's recorded-time comparison.",
    );
    console.log(
      "Existing records were preserved. Missing evidence in other records can keep the global comparison unavailable.",
    );
    console.log(
      "For a sample-only preview, rerun with --database /tmp/timekeeper-comparison.db and start the API with that TIMEKEEPER_DB.",
    );
  } finally {
    db.close();
  }
}
