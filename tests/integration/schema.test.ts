import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { memoryDb } from "../../src/backend/adapters/sqlite/repository";
const expected = JSON.parse(
  readFileSync("src/backend/adapters/sqlite/expected-schema.json", "utf8"),
) as Record<string, string[]>;
describe("mockup schema mapping", () => {
  it("keeps the exact 18 mapped tables and columns with valid foreign keys", () => {
    const db = memoryDb();
    try {
      const actual = (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[]
      ).map((x) => x.name);
      expect(actual.sort()).toEqual(Object.keys(expected).sort());
      for (const [table, columns] of Object.entries(expected)) {
        const names = (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((x) => x.name);
        expect(names, table).toEqual(columns);
      }
      expect(
        (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })
          .foreign_keys,
      ).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
