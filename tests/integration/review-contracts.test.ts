import { readCatalog } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";
import { openDb, state } from "../../src/backend/adapters/sqlite/repository.js";
import { createApp } from "../../src/backend/api/app.js";
import { configuredRate } from "../../src/frontend/calculations/billing.js";

function setup() {
  const db = openDb(":memory:");
  const app = createApp(db);
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, app, post };
}

it("accepts an explicit zero rate when creating a client and rejects negative rates", async () => {
  const { db, app, post } = setup();
  try {
    expect(
      (await post("/clients", { name: "Zero-rate client", code: "ZERO", rate_cents: 0 })).status,
    ).toBe(200);
    const state = await (await app.request("/api/state")).json();
    expect(state.client).toEqual([expect.objectContaining({ code: "ZERO", rate_cents: 0 })]);
    expect(
      (await post("/clients", { name: "Negative rate", code: "NEG", rate_cents: -1 })).status,
    ).toBe(400);
  } finally {
    db.close();
  }
});

it("clears a client rate override, restores the global rate, and preserves explicit zero", async () => {
  const { db, app, post } = setup();
  const patch = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    expect((await patch("/firm/1", { base_rate_cents: 24000 })).status).toBe(200);
    const clientResponse = await post("/clients", {
      name: "Rate override client",
      code: "RATE",
      rate_cents: 30000,
    });
    expect(clientResponse.status).toBe(200);
    const client = await clientResponse.json();
    const caseResponse = await post("/matters", {
      client_id: client.id,
      title: "Rate inheritance case",
    });
    expect(caseResponse.status).toBe(200);
    const matter = await caseResponse.json();
    expect(configuredRate(readCatalog(db), matter.id)).toEqual({
      rateCents: 30000,
      origin: "client",
    });

    expect((await patch(`/client/${client.id}`, { rate_cents: null })).status).toBe(200);
    expect(state(db).client.find((item) => item.id === client.id)?.rate_cents).toBeNull();
    expect(configuredRate(readCatalog(db), matter.id)).toEqual({
      rateCents: 24000,
      origin: "base",
    });

    expect((await patch(`/client/${client.id}`, { rate_cents: 0 })).status).toBe(200);
    expect(configuredRate(readCatalog(db), matter.id)).toEqual({ rateCents: 0, origin: "client" });

    expect((await patch(`/client/${client.id}`, { rate_cents: -1 })).status).toBe(400);
    expect(configuredRate(readCatalog(db), matter.id)).toEqual({ rateCents: 0, origin: "client" });
  } finally {
    db.close();
  }
});

it("accepts the existing case pill display and rejects unsupported display modes", async () => {
  const { db, app } = setup();
  const patchDisplay = (pill_display: string) =>
    app.request("/api/setting/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pill_display }),
    });
  try {
    expect((await patchDisplay("case")).status).toBe(200);
    expect(state(db).setting[0].pill_display).toBe("case");
    expect((await patchDisplay("unsupported")).status).toBe(400);
    expect(state(db).setting[0].pill_display).toBe("case");
  } finally {
    db.close();
  }
});

it("returns taskless canonical periods within the compatibility response contract", async () => {
  const { db, app, post } = setup();
  try {
    expect((await post("/catalog/clients", { id: "client", name: "Test client" })).status).toBe(
      200,
    );
    expect(
      (
        await post("/catalog/cases", {
          id: "case",
          clientId: "client",
          reference: "CASE",
          title: "Test case",
          hourlyRateCents: null,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/commands/start", {
          producerId: "test",
          commandId: "start",
          sessionId: "session",
          occurredAt: "2026-10-17T09:00:00Z",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/work-periods", {
          id: "period",
          sessionId: "session",
          caseId: "case",
          startedAt: "2026-10-17T09:00:00Z",
          origin: "automatic",
          mode: "current",
        })
      ).status,
    ).toBe(200);
    expect(
      (await post("/work-periods/period/detected-duration", { durationMs: 60000 })).status,
    ).toBe(200);
    const state = await (await app.request("/api/state")).json();
    expect(state.time_entry[0].task_id).toBeNull();
    const contract = JSON.parse(readFileSync("src/contracts/openapi.yaml", "utf8"));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile({
      ...contract.components.schemas.State,
      components: contract.components,
    });
    expect(validate(state), JSON.stringify(validate.errors)).toBe(true);
    expect((await post("/day/approve", { date: "2026-10-17" })).status).toBe(200);
  } finally {
    db.close();
  }
});
