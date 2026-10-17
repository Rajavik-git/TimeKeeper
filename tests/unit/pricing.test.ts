import { describe, it, expect } from "vitest";
import { memoryDb, one, priceLine, rate, reprice, state } from "../../src/backend/adapters/sqlite/repository";
import { createApp } from "../../src/backend/api/app";

const call = async (
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  body?: unknown,
) => {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: (await res.json()) as Record<string, unknown>,
  };
};

describe("server pricing and invoice behavior", () => {
  it("uses base, client and matter rates in order", () => {
    const db = memoryDb();
    try {
      expect(priceLine(db, one(db, "time_entry", 13)!).amount_cents).toBe(3000);
      expect(rate(db, null).origin).toBe("base");
      db.prepare("UPDATE time_entry SET matter_id=5 WHERE id=13").run();
      expect(priceLine(db, one(db, "time_entry", 13)!).amount_cents).toBe(5000);
      expect(rate(db, 5).origin).toBe("client");
      db.prepare("UPDATE matter SET own_rate_cents=40000 WHERE id=5").run();
      expect(priceLine(db, one(db, "time_entry", 13)!).amount_cents).toBe(8000);
      expect(rate(db, 5).origin).toBe("matter");
    } finally {
      db.close();
    }
  });

  it("tracks flat-fee and non-billable value without billing the time", () => {
    const db = memoryDb();
    try {
      const flat = priceLine(db, one(db, "time_entry", 9)!);
      expect(flat).toMatchObject({
        origin: "flat_fee",
        amount_cents: 0,
        value_cents: 54000,
      });
      const offered = priceLine(db, one(db, "time_entry", 2)!);
      expect(offered).toMatchObject({ amount_cents: 0, value_cents: 9000 });
      expect(state(db).alerts["1"]).toContain(
        "No more than 0.5 h of billable research per day: 1.3 h on 2026-10-13.",
      );
    } finally {
      db.close();
    }
  });

  it("prices non-billable travel at zero and flags the client rule", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      const result = await call(app, "/api/time-entries/manual", "POST", {
        matter_id: 4,
        task_id: 10,
        date: "2026-10-16",
        tenths_of_hour: 5,
        label: "Travel to court",
      });
      expect(result.status).toBe(200);
      const entry = one(db, "time_entry", Number(result.data.id))!;
      expect(entry.amount_cents).toBe(0);
      expect(priceLine(db, entry).value_cents).toBe(15000);
      expect(state(db).alerts["4"]).toContain(
        "Travel is not billable: Travel to court.",
      );
    } finally {
      db.close();
    }
  });

  it("reassigns JAF work, learns a marker and audits the change", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      const before = state(db).audit_event.length;
      const result = await call(app, "/api/time-entries/13", "PATCH", {
        matter_id: 5,
      });
      expect(result.status).toBe(200);
      expect(result.data.amount_cents).toBe(5000);
      expect(one(db, "block", 13)?.matter_id).toBe(5);
      expect(state(db).marker.some((m) => m.matter_id === 5 && m.learned)).toBe(
        true,
      );
      expect(state(db).audit_event.length).toBeGreaterThan(before);
    } finally {
      db.close();
    }
  });

  it("approves a day while leaving unassigned time for review", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      const result = await call(app, "/api/day/approve", "POST", {
        date: "2026-10-16",
      });
      expect(result).toMatchObject({
        status: 200,
        data: { approved: 4, unassigned: 1 },
      });
      expect(one(db, "time_entry", 13)?.review_status).toBe("to_review");
      expect(
        state(db).audit_event.filter((e) => e.action === "Time entry approved")
          .length,
      ).toBeGreaterThan(1);
    } finally {
      db.close();
    }
  });

  it("freezes billed entries and invoice lines when a client rate changes", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      const issued = await call(app, "/api/invoices", "POST", {
        matter_id: 2,
        type: "final",
      });
      expect(issued.status).toBe(200);
      expect(issued.data.number).toBe("F-2026-0042");
      const invoiceId = Number(issued.data.id);
      const frozen = state(db).invoice_line.filter(
        (l) => l.invoice_id === invoiceId,
      );
      expect(frozen.map((l) => l.amount_cents)).toEqual([12000, 21000]);
      expect(
        state(db)
          .time_entry.filter((l) => l.matter_id === 2)
          .every((l) => l.billing_status === "billed"),
      ).toBe(true);
      await call(app, "/api/client/1", "PATCH", { rate_cents: 40000 });
      reprice(db);
      expect(
        state(db).invoice_line.filter((l) => l.invoice_id === invoiceId),
      ).toEqual(frozen);
      expect(one(db, "time_entry", 7)?.amount_cents).toBe(12000);
    } finally {
      db.close();
    }
  });

  it("rejects unapproved work and charges VAT on fees, not disbursements", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      expect(
        (
          await call(app, "/api/invoices", "POST", {
            matter_id: 5,
            type: "final",
          })
        ).status,
      ).toBe(400);
      await call(app, "/api/expenses", "POST", {
        matter_id: 2,
        date: "2026-10-16",
        label: "Filing fee",
        type: "expense",
        amount_cents: 1000,
      });
      await call(app, "/api/expenses", "POST", {
        matter_id: 2,
        date: "2026-10-16",
        label: "Court charge",
        type: "disbursement",
        amount_cents: 2000,
      });
      const preview = state(db).invoice_previews["2"].final;
      const result = await call(app, "/api/invoices", "POST", {
        matter_id: 2,
        type: "final",
      });
      expect(result.data).toMatchObject({
        subtotal_cents: preview.fees_cents + preview.expenses_cents,
        vat_cents: preview.vat_cents,
        disbursements_cents: preview.disbursements_cents,
      });
      expect(result.data).toMatchObject({
        subtotal_cents: 34000,
        vat_cents: 6800,
        disbursements_cents: 2000,
      });
    } finally {
      db.close();
    }
  });
});

describe("flat-fee final invoice", () => {
  it("charges the agreed fee once and freezes the tracked time at zero", async () => {
    const db = memoryDb(),
      app = createApp(db);
    try {
      await call(app, "/api/matters/3/approve", "POST");
      const issued = await call(app, "/api/invoices", "POST", {
        matter_id: 3,
        type: "final",
      });
      expect(issued.status).toBe(200);
      expect(issued.data.subtotal_cents).toBe(200000);
      const lines = state(db).invoice_line.filter(
        (x) => x.invoice_id === issued.data.id,
      );
      expect(lines.filter((x) => x.origin === "flat_fee")).toHaveLength(1);
      expect(
        lines
          .filter((x) => x.origin === "time_entry")
          .every((x) => x.amount_cents === 0),
      ).toBe(true);
      expect(
        (
          await call(app, "/api/invoices", "POST", {
            matter_id: 3,
            type: "final",
          })
        ).status,
      ).toBe(400);
    } finally {
      db.close();
    }
  });
});
