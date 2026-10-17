import { describe, expect, it } from "vitest";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { memoryDb } from "../fixtures/database.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository";
import { TimeKeeperService } from "../../src/backend/application/service";
import { billingState, issueInvoice, addExpense } from "../../src/backend/application/invoice";
import { invoicePort } from "../../src/backend/adapters/sqlite/invoice";
import {
  configuredRate,
  dayFees,
  draftInvoice,
  summarizeWork,
} from "../../src/frontend/calculations/billing";

function fixture() {
  const db = memoryDb();
  const service = new TimeKeeperService(new SqliteRepository(db));
  const port = invoicePort(db);
  const catalog = readCatalog(db);
  const core = () => ({
    activeSession: service.activeSession(),
    sessions: service.listSessions(),
    periods: service.allPeriods(),
    sources: service.allSources(),
    questions: service.allQuestions(),
    coverageGaps: service.coverageGaps(),
    auditEvents: [],
    billing: billingState(port),
  });
  return { db, service, port, catalog, core };
}
const snapshot = (draft: ReturnType<typeof draftInvoice>, type: "deposit" | "final" = "final") => {
  const { pendingPeriods, complete, ...frozen } = draft;
  return { ...frozen, type };
};

describe("React billing calculations and frozen invoice application", () => {
  it("uses case, client, then base rates for display", () => {
    const f = fixture();
    try {
      expect(configuredRate(f.catalog, 2)).toMatchObject({ rateCents: 30000, origin: "client" });
      const changed = {
        ...f.catalog,
        cases: f.catalog.cases.map((m) => (m.id === "2" ? { ...m, hourlyRateCents: 40000 } : m)),
      };
      expect(configuredRate(changed, 2)).toMatchObject({ rateCents: 40000, origin: "matter" });
      const base = {
        ...changed,
        cases: changed.cases.map((m) => (m.id === "2" ? { ...m, hourlyRateCents: null } : m)),
        clients: changed.clients.map((c) =>
          c.id === changed.cases.find((m) => m.id === "2")?.clientId
            ? { ...c, hourlyRateCents: null }
            : c,
        ),
      };
      expect(configuredRate(base, 2)).toMatchObject({ origin: "base" });
    } finally {
      f.db.close();
    }
  });
  it("rounds a combined group once and marks unknown coverage separately", () => {
    const f = fixture();
    try {
      const base = f.core().periods[0]!;
      const periods = [
        { ...base, id: "a", detectedDurationMs: 20000, durationOverrideMs: null },
        { ...base, id: "b", detectedDurationMs: 20000, durationOverrideMs: null },
      ];
      const result = summarizeWork(periods, []);
      expect(result).toMatchObject({
        preciseDurationMs: 40000,
        roundedMinutes: 1,
        complete: false,
      });
    } finally {
      f.db.close();
    }
  });
  it("matches the corrected fictional day and Dawson invoice reference", () => {
    const f = fixture();
    try {
      const core = f.core();
      expect(
        summarizeWork(
          core.periods.filter((p) => p.startedAt.startsWith("2026-10-16")),
          core.sources,
        ).roundedMinutes,
      ).toBe(267);
      expect(
        dayFees(
          f.catalog,
          core,
          core.periods.filter((p) => p.startedAt.startsWith("2026-10-16")),
        ),
      ).toBe(91250);
      expect(core.periods.find((p) => p.id === "14")).toMatchObject({
        detectedDurationMs: 152 * 60000,
        durationOverrideMs: 108 * 60000,
      });
      const draft = draftInvoice(f.catalog, core, 1, "final");
      expect(draft).toMatchObject({ billedMinutes: 608, feesCents: 304000, pendingPeriods: 2 });
    } finally {
      f.db.close();
    }
  });
  it("keeps billed day fees at the applied rate after a catalogue rate edit", () => {
    const f = fixture();
    try {
      const period = {
        ...f.core().periods.find((p) => p.id === "19")!,
        billingStatus: "billed" as const,
        appliedHourlyRateCents: 25000,
      };
      const changed = {
        ...f.catalog,
        cases: f.catalog.cases.map((item) =>
          item.id === "5" ? { ...item, hourlyRateCents: 100000 } : item,
        ),
      };
      expect(dayFees(f.catalog, f.core(), [period])).toBe(21250);
      expect(dayFees(changed, f.core(), [period])).toBe(21250);
    } finally {
      f.db.close();
    }
  });
  it("stores the React snapshot and freezes the period rate", () => {
    const f = fixture();
    try {
      const draft = draftInvoice(f.catalog, f.core(), 2, "final");
      expect(draft).toMatchObject({ billedMinutes: 228, feesCents: 114000, vatCents: 0 });
      const issued = issueInvoice(f.port, snapshot(draft), "2026-10-16T18:00:00Z");
      expect(issued.number).toBe("F-2026-0042");
      expect(
        f
          .core()
          .periods.filter((p) => ["7", "8"].includes(p.id))
          .every((p) => p.billingStatus === "billed" && p.appliedHourlyRateCents === 30000),
      ).toBe(true);
      expect(
        (
          f.db.prepare("SELECT billing_status FROM work_periods WHERE id='7'").get() as {
            billing_status: string;
          }
        ).billing_status,
      ).toBe("billed");
      const lines = f.port.listInvoiceLines().filter((line) => line.invoiceId === issued.id);
      f.db
        .prepare(
          "UPDATE clients SET hourly_rate_cents=40000 WHERE id=(SELECT client_id FROM cases WHERE id=?)",
        )
        .run("2");
      expect(f.port.listInvoiceLines().filter((line) => line.invoiceId === issued.id)).toEqual(
        lines,
      );
      expect(f.core().periods.find((p) => p.id === "7")?.appliedHourlyRateCents).toBe(30000);
    } finally {
      f.db.close();
    }
  });
  it("rejects unvalidated and stale periods without issuing", () => {
    const f = fixture();
    try {
      const unvalidated = snapshot(draftInvoice(f.catalog, f.core(), 1, "final"));
      expect(() => issueInvoice(f.port, unvalidated, "2026-10-16T18:00:00Z")).toThrow(
        /not time validated/,
      );
      const stale = snapshot(draftInvoice(f.catalog, f.core(), 2, "final"));
      f.service.setDurationOverride("7", 25 * 60000);
      expect(() => issueInvoice(f.port, stale, "2026-10-16T18:00:00Z")).toThrow(
        /changed or is not time validated/,
      );
      expect(f.port.listInvoices()).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it("records VAT, expenses and disbursements from the frontend snapshot", () => {
    const f = fixture();
    try {
      addExpense(f.port, {
        caseId: "2",
        date: "2026-10-16",
        label: "Filing",
        type: "expense",
        amountCents: 1000,
      });
      addExpense(f.port, {
        caseId: "2",
        date: "2026-10-16",
        label: "Court charge",
        type: "disbursement",
        amountCents: 2000,
      });
      const draft = draftInvoice(f.catalog, f.core(), 2, "final");
      expect(draft).toMatchObject({
        subtotalCents: 115000,
        vatCents: 0,
        disbursementsCents: 2000,
        totalCents: 117000,
      });
      const invoice = issueInvoice(f.port, snapshot(draft), "2026-10-16T18:00:00Z");
      expect(f.port.listInvoices().find((row) => row.id === invoice.id)).toMatchObject({
        subtotalCents: 115000,
        vatCents: 0,
        disbursementsCents: 2000,
        totalCents: 117000,
      });
    } finally {
      f.db.close();
    }
  });
  it("bills a flat fee once while storing tracked time with zero work amount", () => {
    const f = fixture();
    try {
      f.service.validatePeriod("18");
      const draft = draftInvoice(f.catalog, f.core(), 3, "final");
      expect(draft).toMatchObject({ feesCents: 200000, rateCents: 0 });
      const issued = issueInvoice(f.port, snapshot(draft), "2026-10-16T18:00:00Z");
      expect(f.port.listInvoiceLines().filter((row) => row.invoiceId === issued.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ origin: "flat_fee", amountCents: 200000 }),
          expect.objectContaining({ origin: "work_period", amountCents: 0 }),
        ]),
      );
      expect(() => issueInvoice(f.port, snapshot(draft), "2026-10-16T18:01:00Z")).toThrow(
        /already exists/,
      );
    } finally {
      f.db.close();
    }
  });
  it("rejects incomplete monetary snapshots without writing an invoice", () => {
    const f = fixture();
    try {
      const draft = snapshot(draftInvoice(f.catalog, f.core(), 2, "final"));
      expect(() =>
        issueInvoice(f.port, { ...draft, totalCents: undefined as never }, "2026-10-16T18:00:00Z"),
      ).toThrow(/totalCents/);
      expect(f.port.listInvoices()).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it("enforces retained client rules when a snapshot is submitted directly", () => {
    const f = fixture();
    try {
      const draft = snapshot(draftInvoice(f.catalog, f.core(), 2, "final"));
      f.db
        .prepare(
          `INSERT INTO client_rules(client_id,type,value,label) VALUES ((SELECT client_id FROM cases WHERE id='2'),'nonbillable_travel',0,'Travel excluded')`,
        )
        .run();
      f.db
        .prepare(
          `UPDATE work_periods SET task_type_id=(SELECT id FROM task_types WHERE code='DEPL') WHERE id='7'`,
        )
        .run();
      expect(() => issueInvoice(f.port, draft, "2026-10-16T18:00:00Z")).toThrow(/travel rule/);
      expect(f.port.listInvoices()).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it("applies a client daily research cap across already billed cases", () => {
    const f = fixture();
    try {
      f.db
        .prepare(
          "UPDATE work_periods SET session_id='demo-2026-10-09',started_at='2026-10-09T10:00:00Z',ended_at='2026-10-09T10:10:00Z',detected_duration_ms=600000,task_type_id=(SELECT id FROM task_types WHERE code='RECH') WHERE id='1'",
        )
        .run();
      f.db
        .prepare(
          "UPDATE work_periods SET task_type_id=(SELECT id FROM task_types WHERE code='RECH') WHERE id='7'",
        )
        .run();
      const draft = snapshot(draftInvoice(f.catalog, f.core(), 2, "final"));
      expect(() => issueInvoice(f.port, draft, "2026-10-16T18:00:00Z")).toThrow(/research cap/);
    } finally {
      f.db.close();
    }
  });
});
