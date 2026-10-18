import type { DatabaseSync } from "node:sqlite";
import type {
  HistoryStorage,
  StoredHistoryJob,
  StoredHistoryProposal,
} from "../../ports/history.js";
import { transaction } from "./transaction.js";

/** Persist private workflow claims separately from the public job projection. */
export function historyStorage(db: DatabaseSync): HistoryStorage {
  function read<T>(table: "history_jobs" | "history_proposals", id: string): T | null {
    const row = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id);
    return row ? (JSON.parse(String(row.payload)) as T) : null;
  }
  return {
    transaction: (work) => transaction(db, work),
    jobs: () =>
      db
        .prepare("SELECT payload FROM history_jobs ORDER BY created_at DESC, id")
        .all()
        .map((row) => JSON.parse(String(row.payload)) as StoredHistoryJob),
    job: (id) => read<StoredHistoryJob>("history_jobs", id),
    saveJob(value) {
      db.prepare(
        "INSERT INTO history_jobs (id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(value.job.id, value.job.createdAt, JSON.stringify(value));
    },
    proposals: (jobId) =>
      db
        .prepare(
          "SELECT payload FROM history_proposals WHERE (? IS NULL OR job_id = ?) ORDER BY id",
        )
        .all(jobId ?? null, jobId ?? null)
        .map((row) => JSON.parse(String(row.payload)) as StoredHistoryProposal),
    proposal: (id) => read<StoredHistoryProposal>("history_proposals", id),
    saveProposal(value) {
      db.prepare(
        "INSERT INTO history_proposals (id, job_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(value.proposal.id, value.proposal.jobId, JSON.stringify(value));
    },
  };
}
