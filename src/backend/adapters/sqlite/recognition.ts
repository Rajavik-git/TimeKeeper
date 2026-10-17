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
    ocr_texts: sources.filter((x) => x.type === "screen").map((x) => String(x.excerpt)),
    audio_transcripts: sources.filter((x) => x.type === "audio").map((x) => String(x.excerpt)),
    speakers: sources
      .filter((x) => x.type === "audio")
      .flatMap((x) => String(x.excerpt).match(/[\p{L} ]+(?=\s*:)/gu) ?? []),
  };
}
export function recognizeBlock(db: DatabaseSync, block: Row): Candidate[] {
  return recognize(signalsForBlock(db, block), catalogFromDb(db));
}
