import type { DatabaseSync } from "node:sqlite";
import { and, asc, eq, ne } from "drizzle-orm";
import type { RetrievalStore } from "../../ports/retrieval.js";
import { retrieval_progress } from "./tables.js";
import { orm } from "./orm.js";
import { transaction } from "./transaction.js";

/** Retrieval progress shares the application's SQLite connection and savepoints. */
export function retrievalStore(db: DatabaseSync): RetrievalStore {
  const sql = orm(db);
  const rows = (sessionId: string, instanceId: string) =>
    sql
      .select()
      .from(retrieval_progress)
      .where(
        and(
          eq(retrieval_progress.session_id, sessionId),
          eq(retrieval_progress.screenpipe_instance_id, instanceId),
        ),
      )
      .orderBy(asc(retrieval_progress.requested_start_at))
      .all();
  return {
    transaction: (work) => transaction(db, work),
    checkpoint(sessionId, instanceId) {
      return (
        rows(sessionId, instanceId)
          .filter((r) => r.status === "complete" && r.content_version >= 1)
          .map((r) => r.requested_end_at)
          .sort()
          .at(-1) ?? null
      );
    },
    earliestIncomplete(sessionId, instanceId) {
      return (
        rows(sessionId, instanceId).find((r) => r.status !== "complete")?.requested_start_at ?? null
      );
    },
    save(window, status, now) {
      const values = {
        content_version: 1,
        id: window.id,
        session_id: window.sessionId,
        screenpipe_instance_id: window.instanceId,
        requested_start_at: window.startAt,
        requested_end_at: window.endAt,
        status,
        last_completed_at: status === "complete" ? now : null,
      };
      sql
        .insert(retrieval_progress)
        .values(values)
        .onConflictDoUpdate({
          target: retrieval_progress.id,
          set: { status, content_version: 1, last_completed_at: values.last_completed_at },
        })
        .run();
    },
    discard(id) {
      sql.delete(retrieval_progress).where(eq(retrieval_progress.id, id)).run();
    },
    closeCoveredGaps(sessionId, instanceId, now) {
      const progress = rows(sessionId, instanceId);
      const complete = progress.filter((r) => r.status === "complete" && r.content_version >= 1);
      for (const gap of progress.filter((r) => r.status !== "complete")) {
        let through = Date.parse(gap.requested_start_at);
        const end = Date.parse(gap.requested_end_at);
        for (const span of complete) {
          if (Date.parse(span.requested_start_at) > through) break;
          through = Math.max(through, Date.parse(span.requested_end_at));
          if (through >= end) break;
        }
        if (through >= end)
          sql
            .update(retrieval_progress)
            .set({ status: "complete", content_version: 1, last_completed_at: now })
            .where(
              and(eq(retrieval_progress.id, gap.id), ne(retrieval_progress.status, "complete")),
            )
            .run();
      }
    },
  };
}
