import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app";
import { invoicePort } from "../../src/backend/adapters/sqlite/invoice";
import { issueInvoice, billingState } from "../../src/backend/application/invoice";
import { TimeKeeperService } from "../../src/backend/application/service";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository";
import { draftInvoice } from "../../src/frontend/calculations/billing";

it("keeps editable demo catalogue rates aligned with invoice validation", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const patch = async (path: string, body: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const clientId = db.prepare("SELECT client_id AS id FROM matter WHERE id=2").get() as {
      id: number;
    };
    expect((await patch(`/api/client/${clientId.id}`, { rate_cents: 42500 })).status).toBe(200);
    expect(invoicePort(db).getCase("2")?.clientRateCents).toBe(42500);
    expect((await patch("/api/matter/2", { own_rate_cents: 50000 })).status).toBe(200);
    expect(invoicePort(db).getCase("2")?.caseRateCents).toBe(50000);
    expect((await patch("/api/firm/1", { base_rate_cents: 28000 })).status).toBe(200);
    expect(invoicePort(db).getCase("2")?.globalRateCents).toBe(28000);
    expect(
      (await patch("/api/matter/2", { mode: "flat_fee", flat_fee_cents: 100000 })).status,
    ).toBe(200);
    expect(invoicePort(db).getCase("2")?.mode).toBe("flat_fee");
  } finally {
    db.close();
  }
});

it("keeps invoice numbering after a catalogue edit following issuance", async () => {
  const db = memoryDb();
  try {
    const app = createApp(db),
      service = new TimeKeeperService(new SqliteRepository(db)),
      port = invoicePort(db);
    const core = {
      activeSession: service.activeSession(),
      sessions: service.listSessions(),
      periods: service.allPeriods(),
      sources: service.allSources(),
      questions: service.allQuestions(),
      coverageGaps: service.coverageGaps(),
      billing: billingState(port),
    };
    const { pendingPeriods, complete, ...draft } = draftInvoice(readCatalog(db), core, 2, "final");
    issueInvoice(port, { ...draft, type: "final" }, "2026-10-16T18:00:00Z");
    const response = await app.request("/api/client/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rate_cents: 42500 }),
    });
    expect(response.status).toBe(200);
    expect(port.nextInvoice().number).toBe("F-2026-0043");
  } finally {
    db.close();
  }
});
