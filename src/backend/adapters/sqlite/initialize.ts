import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { SystemTaskCode } from "../../domain/states.js";
import { migrate } from "./migrate.js";
import { transaction } from "./transaction.js";

const taskTypes = [
  [SystemTaskCode.Drafting, "Drafting", 1, 0],
  [SystemTaskCode.DocumentReview, "Document review", 1, 0],
  [SystemTaskCode.Research, "Legal research", 1, 0],
  [SystemTaskCode.Correspondence, "Correspondence", 1, 0],
  [SystemTaskCode.ClientMeeting, "Client meeting", 1, 1],
  [SystemTaskCode.Call, "Call or video meeting", 1, 0],
  [SystemTaskCode.Hearing, "Hearing", 1, 1],
  [SystemTaskCode.Administrative, "Administrative", 0, 0],
  [SystemTaskCode.CaseOrganization, "Case organization", 0, 0],
  [SystemTaskCode.Travel, "Travel", 1, 1],
] as const;

/** Create the schema and initial preferences without sample business records. */
export function initializeDatabase(db: DatabaseSync): void {
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
