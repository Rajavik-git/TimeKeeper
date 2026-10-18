import { describe, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { catalogFromDb, recognizeBlock } from "../../src/backend/adapters/sqlite/recognition";
import { decision, recognize } from "../../src/backend/domain/recognition";

describe("recognition", () => {
  it("recognizes references, opposing parties, boundaries and continuity", () => {
    const db = memoryDb();
    try {
      const catalog = catalogFromDb(db);
      const match = (
        window_title: string,
        ocr_texts: string[] = [],
        previous = null as null | {
          app: string;
          window_title: string;
          matter_id: number;
        },
      ) => recognize({ app: "Word processor", window_title, ocr_texts, previous }, catalog);
      expect(match("2025-031 Conclusions v3.docx")[0]).toMatchObject({
        matter_id: 1,
        score: 0.95,
      });
      expect(match("Nothing", ["Martin Distribution"])[0]).toMatchObject({
        matter_id: 1,
        score: 0.6,
      });
      expect(match("Paul Dawson").filter((x) => x.score >= 0.5)).toEqual([]);
      expect(decision(match("Paul Dawson"), 0.2)).toMatchObject({
        state: "to_check",
        matter_id: null,
      });
      expect(match("Nothing", ["MARTIN DISTRIBUTION"])[0].score).toBe(0.6);
      catalog.markers.push({
        id: 999,
        matter_id: 2,
        type: "keyword",
        value: "échéance",
        weight: 0.15,
      });
      expect(match("Nothing", ["ECHEANCE"])[0].found.some((x) => x.value === "échéance")).toBe(
        true,
      );
      expect(
        match("Nothing", ["bailleur"]).some((x) => x.found.some((f) => f.value === "bail")),
      ).toBe(false);
      const continuity = match("Martin Distribution", [], {
        app: "Word processor",
        window_title: "Martin Distribution",
        matter_id: 1,
      })[0];
      expect(continuity.score).toBeCloseTo(0.7);
      expect(
        match("Nothing", [], {
          app: "Word processor",
          window_title: "Nothing",
          matter_id: 1,
        })[0].score,
      ).toBeCloseTo(0.1);
      expect(
        match("2025-031 Conclusions v3.docx", ["Martin Distribution"], {
          app: "Word processor",
          window_title: "2025-031 Conclusions v3.docx",
          matter_id: 1,
        })[0].score,
      ).toBe(0.99);
      expect(decision(match("Martin Distribution"), 0.8)).toMatchObject({
        state: "to_check",
        matter_id: 1,
      });
    } finally {
      db.close();
    }
  });
  it("scores seeded blocks from their actual signals", () => {
    const db = memoryDb();
    try {
      for (const block of db.prepare("SELECT * FROM block").all() as Array<{
        id: number;
        confidence: number;
        matter_id: number | null;
      }>) {
        const candidates = recognizeBlock(db, block);
        const score =
          candidates.find((x) => x.matter_id === block.matter_id)?.score ??
          candidates[0]?.score ??
          0;
        expect(block.confidence, `block ${block.id}`).toBeCloseTo(score, 8);
      }
    } finally {
      db.close();
    }
  });
});
