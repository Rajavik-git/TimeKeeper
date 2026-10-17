import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "./migrate.js";
import { transaction } from "./transaction.js";

const taskTypes = [
  ["REDAC", "Drafting", 1, 0],
  ["ANALY", "Document review", 1, 0],
  ["RECH", "Legal research", 1, 0],
  ["MAIL", "Correspondence", 1, 0],
  ["RDV", "Client meeting", 1, 1],
  ["APPEL", "Call or video meeting", 1, 0],
  ["AUD", "Hearing", 1, 1],
  ["ADMIN", "Administrative", 0, 0],
  ["ORGA", "Case organization", 0, 0],
  ["DEPL", "Travel", 1, 1],
] as const;

/** Create the schema and initial preferences without sample business records. */
export function initializeDatabase(db: DatabaseSync): void {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='firm'").get()) {
    db.exec(readFileSync(resolve("src/backend/adapters/sqlite/schema.sql"), "utf8"));
  }
  migrate(db);
  transaction(db, () => {
    const created = db
      .prepare(
        `INSERT OR IGNORE INTO settings(
          id,global_hourly_rate_cents,currency,workspace_id,updated_at,
          lawyer_name,address,vat_number,vat_rate,invoice_prefix,pill_position
        ) VALUES (1,0,'USD',?,?, '', '', '',0,'F-','top-center')`,
      )
      .run(randomUUID(), new Date().toISOString());
    if (created.changes && !db.prepare("SELECT 1 FROM task_types LIMIT 1").get()) {
      const insertTask = db.prepare(
        `INSERT INTO task_types(code,label,billable_by_default,off_screen,sort_order)
         VALUES (?,?,?,?,?)`,
      );
      taskTypes.forEach(([code, label, billable, offScreen], index) => {
        insertTask.run(code, label, billable, offScreen, index + 1);
      });
    }
  });
}
