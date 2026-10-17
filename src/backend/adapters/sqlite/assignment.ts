import type { DatabaseSync } from "node:sqlite";
import type { AssignmentPort } from "../../ports/assignment.js";
import { audit, one, transaction, update } from "./repository.js";

export function assignmentPort(db: DatabaseSync): AssignmentPort {
  return {
    transaction: (work) => transaction(db, work),
    timeEntry: (id) => one(db, "time_entry", id),
    updateTimeEntry: (id, values) => update(db, "time_entry", id, values),
    updateBlock: (id, values) => update(db, "block", id, values),
    audit: (action, before, after, entryId, blockId, actor) =>
      audit(db, action, before, after, entryId, blockId, actor),
  };
}
