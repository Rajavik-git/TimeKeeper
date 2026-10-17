import { eq, sql } from "drizzle-orm";
import type { DatabaseSync } from "node:sqlite";
import { orm } from "../../src/backend/adapters/sqlite/orm.js";
import {
  block as blocksTable,
  markers,
  work_periods,
  demo_block_periods,
} from "../../src/backend/adapters/sqlite/tables.js";
import { all } from "../../src/backend/adapters/sqlite/repository.js";
import { recognizeBlock } from "../../src/backend/adapters/sqlite/recognition.js";

/** Recompute fictional recognition scores for isolated test fixtures only. */
export function refreshDemoRecognition(db: DatabaseSync) {
  orm(db).update(markers).set({ hits: 0, last_seen_at: null }).run();
  for (const block of all(db, "block").sort((a, b) =>
    `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`),
  )) {
    const candidates = recognizeBlock(db, block);
    const assigned = candidates.find((x) => x.matter_id === block.matter_id);
    const confidence = assigned?.score ?? candidates[0]?.score ?? 0;
    orm(db)
      .update(blocksTable)
      .set({ confidence })
      .where(eq(blocksTable.id, Number(block.id)))
      .run();
    const link = orm(db)
      .select()
      .from(demo_block_periods)
      .where(eq(demo_block_periods.block_id, Number(block.id)))
      .get();
    if (link)
      orm(db)
        .update(work_periods)
        .set({ demo_confidence: confidence })
        .where(eq(work_periods.id, link.period_id))
        .run();
    for (const candidate of candidates)
      for (const cue of candidate.found)
        if (cue.marker_id !== null)
          orm(db)
            .update(markers)
            .set({
              hits: sql`${markers.hits}+1`,
              last_seen_at: `${block.date} ${block.start_time}`,
            })
            .where(eq(markers.id, cue.marker_id))
            .run();
  }
}
