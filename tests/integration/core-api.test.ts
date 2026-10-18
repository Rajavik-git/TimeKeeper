import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = memoryDb();
  databases.push(db);
  const app = createApp(db);
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  return { db, app, post };
}
it("uses production routes for reordered commands, duplicate conflicts and missing resources", async () => {
  const { app, post } = setup();
  await post("/commands/end", {
    producerId: "setup",
    commandId: "close-demo",
    sessionId: "demo-2026-10-16",
    occurredAt: "2026-10-16T18:00:00Z",
  });
  const pending = await post("/commands/end", {
    producerId: "p",
    commandId: "e",
    sessionId: "s",
    occurredAt: "2026-10-17T12:00:00Z",
    prerequisiteCommandId: "a",
  });
  expect(pending.status).toBe(202);
  expect(await pending.json()).toMatchObject({ status: "pending" });
  const start = await post("/commands/start", {
    producerId: "p",
    commandId: "a",
    sessionId: "s",
    occurredAt: "2026-10-17T09:00:00Z",
  });
  expect(start.status).toBe(200);
  expect(await (await app.request("/api/sessions/s")).json()).toMatchObject({
    endedAt: "2026-10-17T12:00:00Z",
  });
  expect(
    (
      await post("/commands/end", {
        producerId: "p",
        commandId: "x",
        sessionId: "unknown",
        occurredAt: "2026-10-17T12:00:00Z",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await post("/commands/start", {
        producerId: "p",
        commandId: "a",
        sessionId: "other",
        occurredAt: "2026-10-17T09:00:00Z",
      })
    ).status,
  ).toBe(409);
});
it("serves catalog configuration, source imports and reconstruction on the production application", async () => {
  const { app, post } = setup();
  expect((await post("/catalog/clients", { id: "client", name: "Fictional Client" })).status).toBe(
    200,
  );
  expect(
    (
      await post("/catalog/cases", {
        id: "case",
        clientId: "client",
        reference: "REF",
        title: "Fictional Case",
        hourlyRateCents: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post("/settings/rate", {
        globalHourlyRateCents: 25000,
        currency: "EUR",
        workspaceId: "workspace",
      })
    ).status,
  ).toBe(200);
  expect(await (await app.request("/api/cases/case/rate")).json()).toEqual({
    hourlyRateCents: 25000,
  });
  expect(
    (
      await post("/sources/import", {
        id: "new-source",
        periodId: "14",
        instanceId: "test",
        contentType: "screen",
        externalId: "new-frame",
        recordedAt: "2026-10-16T09:00:00Z",
      })
    ).status,
  ).toBe(200);
  expect((await app.request("/api/work-periods/14/sources")).status).toBe(200);
  expect(
    (
      await post("/reconstruction/propose", {
        id: "conflict",
        periodId: "14",
        expectedRevision: 0,
        startedAt: "2026-10-16T08:55:00Z",
        endedAt: "2026-10-16T09:15:00Z",
        sourceReferences: ["new-source"],
      })
    ).status,
  ).toBe(202);
});
it("sanitizes storage failures and applies configured browser origin policy", async () => {
  const { post, app, db } = setup();
  const preflight = await app.request("/api/catalog/clients", {
    method: "OPTIONS",
    headers: { Origin: "http://tauri.localhost", "access-control-request-method": "POST" },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  expect(
    (
      await post(
        "/catalog/clients",
        { id: "client", name: "Fictional Client" },
        { Origin: "http://tauri.localhost" },
      )
    ).status,
  ).toBe(200);
  const duplicate = await post("/catalog/clients", { id: "client", name: "Again" });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({
    error: "conflict",
    message: "storage constraint conflict",
  });
  expect(
    (
      await post(
        "/catalog/clients",
        { id: "other", name: "Blocked" },
        { Origin: "https://untrusted.example" },
      )
    ).status,
  ).toBe(403);
  db.exec("DROP TABLE sources");
  const broken = await app.request("/api/sources");
  expect(broken.status).toBe(500);
  expect(await broken.json()).toEqual({ error: "internal", message: "internal error" });
});
it.each([
  [
    "/commands/start",
    { producerId: "p", commandId: "s", sessionId: "s", occurredAt: "2026-02-30T09:00:00Z" },
  ],
  [
    "/commands/start",
    { producerId: "p", commandId: "s", sessionId: "s", occurredAt: "2026-10-17T09:00:00+02:00" },
  ],
  [
    "/commands/start",
    { producerId: "", commandId: "s", sessionId: "s", occurredAt: "2026-10-17T09:00:00Z" },
  ],
  ["/work-periods/14/detected-duration", { durationMs: -1 }],
  ["/work-periods/14/duration-override", { durationMs: 9007199254740992 }],
  ["/work-periods/14/details", { billable: "false" }],
  ["/work-periods/14/details", { unknown: true }],
  ["/day/approve", { date: "2026-02-30" }],
  ["/setting/1", { notifications: "false" }],
])("rejects invalid contract payload at %s", async (path, payload) => {
  const { post, app } = setup();
  const response =
    path === "/setting/1" || path.endsWith("/details")
      ? await app.request("/api" + path, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await post(path, payload);
  expect(response.status, await response.clone().text()).toBe(400);
});
it("rejects malformed JSON and excessive bodies before handlers run", async () => {
  const { app } = setup();
  for (const body of ["{", JSON.stringify({ label: "x".repeat(1_000_000) })]) {
    const response = await app.request("/api/work-periods/14/details", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(response.status).toBe(body === "{" ? 400 : 413);
  }
});
