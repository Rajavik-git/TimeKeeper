import { afterEach, expect, it } from "vitest";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { createApp } from "../../src/backend/api/app.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { invoicePort } from "../../src/backend/adapters/sqlite/invoice.js";
import { billingState, issueInvoice } from "../../src/backend/application/invoice.js";
import { draftInvoice } from "../../src/frontend/calculations/billing.js";
import { memoryDb } from "../fixtures/database.js";

const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("rejects impossible dates in direct application commands before saving a session", () => {
  const db = openDb(":memory:");
  databases.push(db);
  const service = new TimeKeeperService(new SqliteRepository(db));
  expect(() =>
    service.start({
      producerId: "calendar",
      commandId: "invalid-day",
      sessionId: "invalid-session",
      occurredAt: "2026-02-30T08:00:00Z",
    }),
  ).toThrow("UTC timestamp required");
  expect(service.listSessions()).toEqual([]);
});

async function setupCalendarPeriod() {
  const db = openDb(":memory:");
  databases.push(db);
  const app = createApp(db);
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const [path, body] of [
    ["/catalog/clients", { id: "client", name: "Synthetic client" }],
    [
      "/catalog/cases",
      {
        id: "case",
        clientId: "client",
        reference: "SYNTHETIC",
        title: "Synthetic case",
        hourlyRateCents: null,
      },
    ],
    [
      "/commands/start",
      {
        producerId: "calendar",
        commandId: "start",
        sessionId: "session",
        occurredAt: "2026-03-30T22:30:00Z",
      },
    ],
    [
      "/work-periods",
      {
        id: "period",
        sessionId: "session",
        caseId: "case",
        startedAt: "2026-03-30T22:30:00Z",
        origin: "automatic",
        mode: "current",
      },
    ],
    [
      "/work-periods",
      {
        id: "unresolved",
        sessionId: "session",
        caseId: null,
        startedAt: "2026-03-30T22:40:00Z",
        origin: "unresolved",
        mode: "current",
      },
    ],
    [
      "/questions",
      {
        questionId: "question",
        sessionId: "session",
        periodId: "unresolved",
        expectedAssignmentRevision: 0,
      },
    ],
  ] as const) {
    const response = await post(path, body);
    expect([200, 202]).toContain(response.status);
  }
  db.prepare(
    "INSERT INTO retrieval_progress(id,session_id,screenpipe_instance_id,requested_start_at,requested_end_at,status) VALUES (?,?,?,?,?,?)",
  ).run("gap", "session", "synthetic", "2026-03-30T22:30:00Z", "2026-03-30T22:40:00Z", "pending");
  return { db, app, post };
}

it("filters periods, pending questions and coverage by the requested local calendar day", async () => {
  const { app } = await setupCalendarPeriod();
  for (const resource of ["work-periods", "questions", "coverage-gaps"]) {
    const local = await app.request(`/api/${resource}?date=2026-03-31&timeZone=Europe%2FParis`);
    expect(local.status).toBe(200);
    expect((await local.json()).length).toBe(resource === "work-periods" ? 2 : 1);
    const utc = await app.request(`/api/${resource}?date=2026-03-31&timeZone=UTC`);
    expect(await utc.json()).toEqual([]);
  }
  const range = await app.request(
    "/api/work-periods?from=2026-03-31&to=2026-03-31&timeZone=Europe%2FParis",
  );
  expect((await range.json()).map((period: { id: string }) => period.id)).toEqual([
    "period",
    "unresolved",
  ]);
});

it("rejects impossible days, reversed ranges and unknown timezones", async () => {
  const { app } = await setupCalendarPeriod();
  for (const resource of ["work-periods", "questions", "coverage-gaps"]) {
    for (const query of [
      "date=2026-02-30",
      "date=2026-3-1",
      "from=2026-04-01&to=2026-03-31",
      "timeZone=Invalid%2FZone",
    ]) {
      expect((await app.request(`/api/${resource}?${query}`)).status).toBe(400);
    }
  }
});

it("exports the complete period on its local start day and rejects invalid source-pack dates", async () => {
  const { post } = await setupCalendarPeriod();
  const response = await post("/cases/case/source-pack", {
    scope: "period",
    from: "2026-03-31",
    to: "2026-03-31",
    timeZone: "Europe/Paris",
    options: [],
  });
  expect(response.status).toBe(200);
  const pack = JSON.parse((await response.json()).payload);
  expect(pack.entries).toMatchObject([
    { id: "period", date: "2026-03-31", started_at: "2026-03-30T22:30:00Z" },
  ]);
  for (const input of [{ from: "2026-02-30" }, { timeZone: "Invalid/Zone" }]) {
    expect(
      (
        await post("/cases/case/source-pack", {
          scope: "period",
          from: "2026-03-31",
          to: "2026-03-31",
          options: [],
          ...input,
        })
      ).status,
    ).toBe(400);
  }
});

function invoiceFixture() {
  const db = memoryDb();
  databases.push(db);
  const core = new TimeKeeperService(new SqliteRepository(db));
  const port = invoicePort(db);
  const coreState = {
    activeSession: core.activeSession(),
    sessions: core.listSessions(),
    periods: core.allPeriods(),
    sources: core.allSources(),
    questions: core.allQuestions(),
    coverageGaps: core.coverageGaps(),
    billing: billingState(port),
    auditEvents: [],
  };
  const {
    pendingPeriods: _pending,
    complete: _complete,
    ...draft
  } = draftInvoice(readCatalog(db), coreState, "2", "final");
  return { db, port, snapshot: { ...draft, type: "final" as const, timeZone: "Europe/Paris" } };
}

it("freezes the invoice issue calendar day and timezone without rewriting older snapshots", () => {
  const { db, port, snapshot } = invoiceFixture();
  const previous = db.prepare("SELECT id,date,snapshot_json FROM invoices ORDER BY id").all();
  expect(previous.length).toBeGreaterThan(0);
  const issued = issueInvoice(port, snapshot, "2026-03-30T22:30:00Z");
  const saved = db.prepare("SELECT date,snapshot_json FROM invoices WHERE id=?").get(issued.id)!;
  expect(saved.date).toBe("2026-03-31");
  expect(JSON.parse(String(saved.snapshot_json)).timeZone).toBe("Europe/Paris");
  for (const row of previous)
    expect(
      db.prepare("SELECT id,date,snapshot_json FROM invoices WHERE id=?").get(row.id as number),
    ).toEqual(row);
});

it("enforces the research cap across UTC midnight within one local day", () => {
  const { port, snapshot } = invoiceFixture();
  port.getRuleContext = () => ({
    rules: [{ type: "daily_research_cap", value: 10 }],
    periods: [
      {
        id: "first",
        startedAt: "2026-03-30T22:30:00Z",
        taskCode: "RECH",
        effectiveDurationMs: 2400000,
      },
      {
        id: "second",
        startedAt: "2026-03-31T06:00:00Z",
        taskCode: "RECH",
        effectiveDurationMs: 2400000,
      },
    ],
  });
  expect(() => issueInvoice(port, snapshot, "2026-03-31T12:00:00Z")).toThrow(
    "client daily research cap exceeded",
  );
  expect(() =>
    issueInvoice(port, { ...snapshot, timeZone: "UTC" }, "2026-03-31T12:00:00Z"),
  ).not.toThrow();
});

it("rejects impossible expense dates and invalid invoice timezones", async () => {
  const { post } = await setupCalendarPeriod();
  expect(
    (
      await post("/billing/expenses", {
        caseId: "case",
        date: "2026-02-30",
        label: "Synthetic",
        type: "expense",
        amountCents: 1,
      })
    ).status,
  ).toBe(400);
  const { port, snapshot } = invoiceFixture();
  expect(() =>
    issueInvoice(port, { ...snapshot, timeZone: "Invalid/Zone" }, "2026-03-31T12:00:00Z"),
  ).toThrow("invalid timeZone");
});
