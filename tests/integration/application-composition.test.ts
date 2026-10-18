import { afterEach, expect, it } from "vitest";
import { createApplicationServices } from "../../src/backend/bootstrap.js";
import { createHttpApp } from "../../src/backend/api/app.js";
import { draftInvoice } from "../../src/frontend/calculations/billing.js";
import { memoryDb } from "../fixtures/database.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = memoryDb();
  databases.push(db);
  let at = "2026-10-18T12:00:00.000Z";
  const services = createApplicationServices(db, { now: () => at });
  const app = createHttpApp(services);
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    db,
    services,
    app,
    post,
    setTime: (value: string) => {
      at = value;
    },
  };
}

it("uses the injected clock for catalogue audit, source receipts and pill deadlines", async () => {
  const { db, post, setTime } = setup();
  const client = await post("/catalog/clients", {
    id: "clock-client",
    name: "Synthetic clock client",
  });
  expect(client.status).toBe(200);
  expect(
    db.prepare("SELECT created_at FROM clients WHERE id='clock-client'").get()?.created_at,
  ).toBe("2026-10-18T12:00:00.000Z");
  const exported = await post("/catalog/cases/1/source-pack", { scope: "case", options: [] });
  expect(exported.status).toBe(200);
  expect((await exported.json()).export.createdAt).toBe("2026-10-18T12:00:00.000Z");
  const decision = await post("/pill/decision", {
    kind: "assign",
    periodId: "13",
    caseId: "5",
    expectedAssignmentRevision: 0,
  });
  expect(decision.status).toBe(200);
  const result = await decision.json();
  expect(result.undoExpiresAt).toBe("2026-10-18T12:00:05.000Z");
  setTime("2026-10-18T12:00:05.001Z");
  expect((await post("/pill/undo", { undoToken: result.undoToken })).status).toBe(409);
});

it("timestamps issued invoices with the same application clock", async () => {
  const { db, services, post } = setup();
  const snapshot = services.workspace.snapshot();
  const {
    pendingPeriods: _pending,
    complete: _complete,
    ...draft
  } = draftInvoice(
    snapshot.catalogState,
    { ...snapshot.workspaceState, auditEvents: [] },
    "2",
    "final",
  );
  const issued = await post("/invoices", { ...draft, type: "final" });
  expect(issued.status).toBe(200);
  const result = await issued.json();
  const saved = db.prepare("SELECT date,snapshot_json FROM invoices WHERE id=?").get(result.id)!;
  expect(saved.date).toBe("2026-10-18");
  expect(JSON.parse(String(saved.snapshot_json)).issuedAt).toBe("2026-10-18T12:00:00.000Z");
});
