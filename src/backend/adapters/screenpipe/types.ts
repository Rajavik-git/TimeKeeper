import type { components } from "../../../contracts/generated.js";

/** A normalized OCR item from screenpipe's local GET /search response. */
export interface ScreenpipeOcrResult {
  frame_id: number;
  text: string;
  timestamp: string;
  app_name: string;
  window_name: string;
  browser_url?: string | null;
}

/** A normalized audio item from screenpipe's local GET /search response. */
export interface ScreenpipeAudioResult {
  chunk_id: number;
  transcription: string;
  speaker?: string | null;
  start_time: string;
  end_time: string;
}

export type ScreenpipeSearchResult =
  | { content_type: "ocr"; item: ScreenpipeOcrResult }
  | { content_type: "audio"; item: ScreenpipeAudioResult };

/** Records to persist after consolidation and human review. No media is copied. */
export interface IngestionDraft {
  block: Omit<components["schemas"]["block"], "id">;
  sources: Array<Omit<components["schemas"]["source"], "id" | "block_id">>;
  time_entry: Omit<components["schemas"]["time_entry"], "id" | "block_id">;
}

/**
 * TODO: turn local search results into contiguous blocks, source references and
 * a proposed time entry. Do not call screenpipe, Jev or a language model here yet.
 */
export type ConsolidateSearchResults = (
  items: ScreenpipeSearchResult[],
) => IngestionDraft[];
