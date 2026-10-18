import type { DatabaseSync } from "node:sqlite";
let sequence = 0;
/** A unique savepoint composes application use cases in one SQLite transaction. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  const name = `timekeeper_${sequence++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw error;
  }
}
