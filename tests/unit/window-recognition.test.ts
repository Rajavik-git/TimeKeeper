import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { recognizeWindow } from "../../src/backend/application/window-recognition.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function catalog() {
  const db = memoryDb();
  databases.push(db);
  return catalogRepository(db).state();
}

it("suggests the active case whose reference appears in the file name", () => {
  expect(recognizeWindow("2025-031 Opposition Brief v3.docx", "Word", catalog())).toMatchObject({
    confidence: "high",
    suggestion: { caseId: "1", title: "Dawson v Martin", client: "Paul Dawson" },
  });
});

it("keeps client-only matches ambiguous and offers alternatives", () => {
  const state = catalog();
  const dawson = state.cases.find((item) => item.title === "Dawson v Martin")!;
  state.cases.push({
    ...dawson,
    id: "dawson-2",
    title: "Another Dawson case",
    reference: "2026-999",
  });
  const result = recognizeWindow("Paul Dawson notes.docx", "Word", state);
  expect(result.confidence).toBe("low");
  expect([result.suggestion, ...result.alternatives]).toContainEqual(
    expect.objectContaining({ caseId: "dawson-2" }),
  );
});

it("ignores archived cases", () => {
  const state = catalog();
  for (const item of state.cases) if (item.id === "1") item.status = "archived";
  expect(
    recognizeWindow("2025-031 Opposition Brief v3.docx", "Word", state).suggestion?.caseId,
  ).not.toBe("1");
});

it("returns no suggestion for an unmatched file or a shell window", () => {
  for (const title of ["Unrelated notes.docx", "Program Manager"])
    expect(recognizeWindow(title, "Explorer", catalog())).toEqual({
      suggestion: null,
      alternatives: [],
      confidence: "low",
    });
});
