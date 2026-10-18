import { afterEach, expect, it } from "vitest";
import { createApp } from "../../src/backend/api/app.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";

const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = openDb(":memory:");
  databases.push(db);
  const app = createApp(db);
  const write = (path: string, body: unknown, method = "POST") =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, app, write };
}

it("reads an empty typed canonical catalog without the historical projection tables", async () => {
  const { db, app } = setup();
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('marker','client_rule','matter','client','firm','setting')",
      )
      .all(),
  ).toEqual([]);
  const response = await app.request("/api/catalog");
  expect(response.status).toBe(200);
  const catalog = await response.json();
  expect(catalog).toMatchObject({
    clients: [],
    cases: [],
    markers: [],
    clientRules: [],
    settings: { id: 1, globalHourlyRateCents: 0, currency: "USD" },
  });
  expect(catalog.taskTypes.length).toBeGreaterThan(0);
  expect(catalog.settings).not.toHaveProperty("global_hourly_rate_cents");
});

it("creates and edits opaque-ID canonical clients and cases without numeric aliases", async () => {
  const { db, app, write } = setup();
  const clientResponse = await write("/catalog/clients", {
    id: "001",
    name: "Synthetic Client",
    code: "SYN",
    hourlyRateCents: null,
  });
  expect(clientResponse.status).toBe(200);
  expect(await clientResponse.json()).toMatchObject({ id: "001", hourlyRateCents: null });
  const caseResponse = await write("/catalog/cases", {
    id: "case-a",
    clientId: "001",
    reference: "SYN-001",
    title: "Synthetic case",
    hourlyRateCents: null,
  });
  expect(caseResponse.status).toBe(200);
  expect(await caseResponse.json()).toMatchObject({
    id: "case-a",
    clientId: "001",
    status: "active",
  });
  expect((await write("/catalog/clients/001", { hourlyRateCents: 0 }, "PATCH")).status).toBe(200);
  expect(
    (
      await write(
        "/catalog/cases/case-a",
        { hourlyRateCents: 25000, title: "Updated synthetic case" },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect(readCatalog(db)).toMatchObject({
    clients: [{ id: "001", hourlyRateCents: 0 }],
    cases: [{ id: "case-a", clientId: "001", hourlyRateCents: 25000 }],
  });
  expect(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='client'").get(),
  ).toBeUndefined();
  const search = await (await app.request("/api/cases/search?query=updated")).json();
  expect(search.cases).toMatchObject([{ id: "case-a", clientId: "001" }]);
  expect(search.cases[0]).not.toHaveProperty("client_id");
  const audit = await (await app.request("/api/audit-events")).json();
  expect(audit).toHaveLength(4);
  expect(audit.every((event: { periodId: unknown }) => event.periodId === null)).toBe(true);
});

it("allocates UUIDs and consecutive immutable references and only creates explicitly supplied markers", async () => {
  const { db, write } = setup();
  const client = await (
    await write("/catalog/clients", { name: "Synthetic client", code: "SYN" })
  ).json();
  expect(client.id).toMatch(/^[\da-f-]{36}$/);
  const firstResponse = await write("/catalog/cases", {
    clientId: client.id,
    title: "First synthetic case",
    opposingParty: "Explicit synthetic party",
  });
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  const second = await (
    await write("/catalog/cases", { clientId: client.id, title: "Second synthetic case" })
  ).json();
  expect(first.reference).toMatch(/^\d{4}-001-SYN$/);
  expect(second.reference).toMatch(/^\d{4}-002-SYN$/);
  expect(
    (await write(`/catalog/cases/${first.id}`, { reference: "changed" }, "PATCH")).status,
  ).toBe(400);
  expect(readCatalog(db).markers).toMatchObject([
    { caseId: first.id, type: "opposing_party", learned: false, hits: 0 },
  ]);
});

it("validates catalog input and rejects missing resources without partial writes or audit events", async () => {
  const { db, write } = setup();
  for (const body of [
    { name: "" },
    { name: "Synthetic", code: "lowercase" },
    { name: "Synthetic", hourlyRateCents: -1 },
    { name: "Synthetic", hourlyRateCents: 0.5 },
  ])
    expect((await write("/catalog/clients", body)).status).toBe(400);
  expect((await write("/catalog/clients/missing", { name: "Synthetic" }, "PATCH")).status).toBe(
    404,
  );
  expect(
    (await write("/catalog/cases", { clientId: "missing", title: "Synthetic", reference: "SYN" }))
      .status,
  ).toBe(404);
  expect((await write("/catalog/settings", { vatRate: 101 }, "PATCH")).status).toBe(400);
  expect((await write("/catalog/settings", { nextNumber: 0 }, "PATCH")).status).toBe(400);
  expect((await write("/catalog/task-types", { code: "SYN", label: "" })).status).toBe(400);
  expect(db.prepare("SELECT COUNT(*) AS count FROM clients").get()?.count).toBe(0);
  expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get()?.count).toBe(0);
});

it("handles settings, task types, manual markers and client rules through typed canonical routes", async () => {
  const { db, app, write } = setup();
  expect(
    (await write("/catalog/clients", { id: "client", name: "Synthetic", code: "SYN" })).status,
  ).toBe(200);
  expect(
    (
      await write("/catalog/cases", {
        id: "case",
        clientId: "client",
        reference: "SYN",
        title: "Synthetic",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await write(
        "/catalog/settings",
        {
          globalHourlyRateCents: 12500,
          currency: "EUR",
          lawyerName: "Synthetic name",
          notifications: false,
        },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const taskResponse = await write("/catalog/task-types", { code: "SYN", label: "Synthetic task" });
  expect(taskResponse.status).toBe(200);
  const task = await taskResponse.json();
  expect(
    (await write(`/catalog/task-types/${task.id}`, { billableByDefault: false }, "PATCH")).status,
  ).toBe(200);
  const markerResponse = await write("/catalog/markers", {
    caseId: "case",
    type: "keyword",
    value: "Synthetic marker",
  });
  expect(markerResponse.status).toBe(200);
  const marker = await markerResponse.json();
  expect(marker).toMatchObject({ caseId: "case", learned: false, weight: 0.15 });
  const ruleResponse = await write("/catalog/client-rules", {
    clientId: "client",
    type: "daily_research_cap",
  });
  expect(ruleResponse.status).toBe(200);
  const rule = await ruleResponse.json();
  expect(rule).toMatchObject({ clientId: "client", value: 5 });
  expect(
    (await app.request(`/api/catalog/markers/${marker.id}`, { method: "DELETE" })).status,
  ).toBe(200);
  expect(
    (await app.request(`/api/catalog/client-rules/${rule.id}`, { method: "DELETE" })).status,
  ).toBe(200);
  expect(readCatalog(db)).toMatchObject({
    markers: [],
    clientRules: [],
    settings: { currency: "EUR", globalHourlyRateCents: 12500, notifications: false },
  });
});

it("reports an exhausted annual case sequence without creating a case or audit event", async () => {
  const { db, write } = setup();
  await write("/catalog/clients", { id: "client", name: "Synthetic", code: "SYN" });
  const year = new Intl.DateTimeFormat("en", { year: "numeric" }).format(new Date());
  expect(
    (
      await write("/catalog/cases", {
        clientId: "client",
        title: "Last synthetic case",
        reference: `${year}-999-SYN`,
      })
    ).status,
  ).toBe(200);
  expect(
    (await write("/catalog/cases", { clientId: "client", title: "Exhausted synthetic case" }))
      .status,
  ).toBe(409);
  expect(readCatalog(db).cases).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events").get()?.count).toBe(2);
});

it("preserves an unknown opening date on cases created by the core repository", async () => {
  const { db, app } = setup();
  const repository = new SqliteRepository(db);
  const at = "2026-10-17T08:00:00Z";
  repository.createClient("imported-client", "Synthetic imported client", at);
  repository.createCase(
    "imported-case",
    "imported-client",
    "SYN-IMPORTED",
    "Synthetic imported case",
    null,
    at,
  );
  const response = await app.request("/api/catalog");
  expect(response.status).toBe(200);
  expect((await response.json()).cases).toMatchObject([{ id: "imported-case", openedOn: null }]);
  expect(readCatalog(db).cases[0].openedOn).toBeNull();
});
