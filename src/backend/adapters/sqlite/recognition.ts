import type { DatabaseSync } from "node:sqlite";
import { all, type Row } from "./repository.js";
import { recognize, type Catalog, type Signals, type Candidate } from "../../domain/recognition.js";

export function catalogFromDb(db: DatabaseSync): Catalog {
  return {
    clients: all(db, "client") as unknown as Catalog["clients"],
    matters: all(db, "matter") as unknown as Catalog["matters"],
    markers: all(db, "marker") as unknown as Catalog["markers"],
  };
}
export function signalsForBlock(db: DatabaseSync, block: Row): Signals {
  const sources = all(db, "source").filter((x) => x.block_id === block.id);
  return {
    app: String(block.app),
    window_title: String(block.window_title),
    ocr_texts: sources
      .filter((x) => x.type === "screen")
      .map((x) => String(x.excerpt)),
    audio_transcripts: sources
      .filter((x) => x.type === "audio")
      .map((x) => String(x.excerpt)),
    speakers: sources
      .filter((x) => x.type === "audio")
      .flatMap((x) => String(x.excerpt).match(/[\p{L} ]+(?=\s*:)/gu) ?? []),
  };
}
export function recognizeBlock(db: DatabaseSync, block: Row): Candidate[] {
  return recognize(signalsForBlock(db, block), catalogFromDb(db));
}
export function refreshDemoRecognition(db: DatabaseSync) {
  db.prepare("UPDATE marker SET hits=0,last_seen_at=NULL").run();
  for (const block of all(db, "block").sort((a, b) =>
    `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`),
  )) {
    const candidates = recognizeBlock(db, block);
    const assigned = candidates.find((x) => x.matter_id === block.matter_id);
    db.prepare("UPDATE block SET confidence=? WHERE id=?").run(
      assigned?.score ?? candidates[0]?.score ?? 0,
      Number(block.id),
    );
    for (const candidate of candidates)
      for (const cue of candidate.found)
        if (cue.marker_id !== null)
          db.prepare(
            "UPDATE marker SET hits=hits+1,last_seen_at=? WHERE id=?",
          ).run(`${block.date} ${block.start_time}`, cue.marker_id);
  }
}
