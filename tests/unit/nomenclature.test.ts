import { describe, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app";

describe("matter nomenclature and learning", () => {
  it("allocates a firm-wide annual reference and preserves it", async () => {
    const db = memoryDb();
    try {
      const app = createApp(db);
      const create = (client_id: number) =>
        app.request("/api/matters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id, title: "New case" }),
        });
      const first = (await (await create(1)).json()) as {
        id: number;
        reference: string;
      };
      const second = (await (await create(2)).json()) as { reference: string };
      const year = new Date().getFullYear();
      expect(first.reference).toBe(`${year}-${year === 2026 ? "022" : "001"}-DAWSON`);
      expect(second.reference).toBe(`${year}-${year === 2026 ? "023" : "002"}-LUMEN`);
      const change = await app.request(`/api/matter/${first.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference: "2000-001-OTHER" }),
      });
      expect(change.status).toBe(400);
      expect(
        (
          db.prepare("SELECT reference FROM cases WHERE id=?").get(String(first.id)) as {
            reference: string;
          }
        ).reference,
      ).toBe(first.reference);
      expect(() =>
        db
          .prepare("UPDATE cases SET reference=? WHERE id=?")
          .run(second.reference, String(first.id)),
      ).toThrow();
      expect(() =>
        db
          .prepare("UPDATE cases SET reference=? WHERE id=?")
          .run("2000-001-OTHER", String(first.id)),
      ).toThrow();
    } finally {
      db.close();
    }
  });
  it("loads the expanded demo cases with coherent historical time", () => {
    const db = memoryDb();
    try {
      const count = (table: string) =>
        (
          db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n;
      expect(count("client")).toBe(8);
      expect(count("matter")).toBe(12);
      expect(count("marker")).toBe(25);
      expect(count("time_entry")).toBe(37);
      expect(db.prepare("SELECT COUNT(*) AS n FROM matter WHERE status='closed'").get()).toEqual({
        n: 1,
      });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM time_entry WHERE date='2026-10-16'").get(),
      ).toEqual({ n: 5 });
      const added = db
        .prepare(
          "SELECT id, matter_id, date, tenths_of_hour, amount_cents, rate_origin, review_status, billing_status, invoice_id FROM time_entry WHERE id BETWEEN 20 AND 27 ORDER BY id",
        )
        .all() as Array<Record<string, unknown>>;
      expect(new Set(added.map((x) => x.matter_id)).size).toBe(4);
      for (const entry of added) {
        expect(String(entry.date) < "2026-10-16").toBe(true);
        expect(entry.review_status).toBe("approved");
        expect(entry.billing_status).toBe("to_bill");
        expect(entry.invoice_id).toBeNull();
        expect(entry.amount_cents).toBe(0);
        const period = db
          .prepare("SELECT duration_override_ms FROM work_periods WHERE id=?")
          .get(String(entry.id)) as { duration_override_ms: number };
        expect(period.duration_override_ms).toBe(Number(entry.tenths_of_hour) * 360000);
      }
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("assigns the JAF block without learning a marker", async () => {
    const db = memoryDb();
    try {
      const response = await createApp(db).request("/api/time-entries/13", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matter_id: 5, expected_assignment_revision: 0 }),
      });
      expect(response.status).toBe(200);
      expect(
        db.prepare("SELECT case_id,assignment_revision FROM work_periods WHERE id='13'").get(),
      ).toMatchObject({
        case_id: "5",
        assignment_revision: 1,
      });
      expect(
        db
          .prepare("SELECT type,value,weight,learned FROM markers WHERE case_id='5' AND learned=1")
          .all(),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});
