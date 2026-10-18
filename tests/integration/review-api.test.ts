import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
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
  const write = (path: string, body: unknown, method = "POST") =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { db, app, write };
}

it("keeps opaque canonical IDs usable through state, catalog edits and source packs", async () => {
  const { app, write } = setup();
  expect(
    (await write("/catalog/clients", { id: "client-new", name: "Fictional New Client" })).status,
  ).toBe(200);
  expect(
    (
      await write("/catalog/cases", {
        id: "case-new",
        clientId: "client-new",
        reference: "NEW-REF",
        title: "Fictional New Case",
        hourlyRateCents: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (await write("/client/client-new", { name: "Fictional Edited Client" }, "PATCH")).status,
  ).toBe(200);
  expect(
    (
      await write("/work-periods/manual", {
        sessionId: "demo-2026-10-16",
        caseId: "case-new",
        startedAt: "2026-10-16T09:00:00Z",
        durationMs: 20_000,
        taskTypeId: 1,
        label: "Fictional new work",
      })
    ).status,
  ).toBe(200);
  const periods = await (await app.request("/api/work-periods?caseId=case-new")).json();
  const pack = await write("/cases/case-new/source-pack", {
    scope: "chosen",
    options: ["pdf"],
    periodIds: [periods[0].id],
  });
  expect(pack.status, await pack.text()).toBe(200);

  const state = await (await app.request("/api/state")).json();
  expect(state.client.find((item: { id: string | number }) => item.id === "client-new").name).toBe(
    "Fictional Edited Client",
  );
  const contract = JSON.parse(readFileSync("src/contracts/openapi.yaml", "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile({
    ...contract.components.schemas.State,
    components: contract.components,
  });
  expect(validate(state), JSON.stringify(validate.errors)).toBe(true);
});

it("exposes the current record revision for reconstruction after an ordinary detail edit", async () => {
  const { app, write, db } = setup();
  const before = await (await app.request("/api/work-periods/14")).json();
  expect(
    (
      await write(
        "/work-periods/14/details",
        { label: "Fictional revised label", expectedRevision: before.revision },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const after = await (await app.request("/api/work-periods/14")).json();
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.effectiveRevision).toBe(before.effectiveRevision);
  const proposal = {
    id: "review-proposal",
    periodId: "14",
    expectedRevision: after.revision,
    startedAt: after.startedAt,
    endedAt: after.endedAt,
    sourceReferences: [],
  };
  expect(
    (await write("/reconstruction/propose", { ...proposal, expectedRevision: before.revision }))
      .status,
  ).toBe(409);
  expect((await write("/reconstruction/propose", proposal)).status).toBe(202);
  expect(
    db
      .prepare("SELECT expected_revision FROM reconstruction_conflicts WHERE id=?")
      .get(proposal.id),
  ).toMatchObject({ expected_revision: after.revision });
});
