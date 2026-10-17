import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { memoryDb } from "../../src/backend/adapters/sqlite/repository";
import { createApp } from "../../src/backend/api/app";

const spec = JSON.parse(readFileSync("src/contracts/openapi.yaml", "utf8")) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content: { "application/json": { schema: object } } }
        >;
      }
    >
  >;
  components: object;
};
const cases: Record<string, { path?: string; body?: unknown }> = {
  "GET /api/state": {},
  "POST /api/demo/reset": {},
  "PATCH /api/time-entries/{id}": {
    path: "/api/time-entries/13",
    body: { matter_id: 5 },
  },
  "POST /api/day/approve": { body: { date: "2026-10-16" } },
  "POST /api/matters/{id}/approve": { path: "/api/matters/1/approve" },
  "POST /api/time-entries/{id}/discard": {
    path: "/api/time-entries/13/discard",
  },
  "POST /api/blocks/{id}/recover": { path: "/api/blocks/16/recover" },
  "POST /api/time-entries/manual": {
    body: {
      matter_id: 1,
      task_id: 5,
      date: "2026-10-16",
      tenths_of_hour: 10,
      label: "Client meeting",
    },
  },
  "POST /api/matters": {
    body: { client_id: 1, title: "New matter", opposing_party: "Other party" },
  },
  "POST /api/markers": {
    body: { matter_id: 1, type: "keyword", value: "new term" },
  },
  "DELETE /api/markers/{id}": { path: "/api/markers/1" },
  "POST /api/expenses": {
    body: {
      matter_id: 1,
      date: "2026-10-16",
      label: "Filing",
      type: "expense",
      amount_cents: 1000,
    },
  },
  "DELETE /api/expenses/{id}": { path: "/api/expenses/1" },
  "POST /api/invoices": { body: { matter_id: 2, type: "final" } },
  "GET /api/invoices/{id}/csv": { path: "/api/invoices/1/csv" },
  "GET /api/sources/{id}": { path: "/api/sources/1" },
  "GET /api/blocks/{id}/recognition": { path: "/api/blocks/14/recognition" },
  "POST /api/sources/{id}/export": {
    path: "/api/sources/1/export",
    body: { options: ["blur_other_clients", "include_audit"] },
  },
  "POST /api/pauses": {
    body: { date: "2026-10-16", start_time: "11:30", reason: "" },
  },
  "PATCH /api/pauses/{id}": {
    path: "/api/pauses/1",
    body: { end_time: "13:45" },
  },
  "POST /api/blocks/{id}/close": {
    path: "/api/blocks/14/close",
    body: { minutes: 6 },
  },
  "PATCH /api/firm/{id}": {
    path: "/api/firm/1",
    body: { base_rate_cents: 16000 },
  },
  "PATCH /api/setting/{id}": {
    path: "/api/setting/1",
    body: { confidence_threshold: 0.85 },
  },
  "PATCH /api/client/{id}": {
    path: "/api/client/1",
    body: { rate_cents: 31000 },
  },
  "PATCH /api/matter/{id}": {
    path: "/api/matter/1",
    body: { own_rate_cents: 32000 },
  },
  "PATCH /api/task/{id}": { path: "/api/task/1", body: { off_screen: true } },
  "POST /api/clients": { body: { name: "New client", code: "NEW", rate_cents: 20000 } },
  "POST /api/tasks": { body: { code: "NEW", label: "New task" } },
  "POST /api/client-rules": {
    body: { client_id: 3, type: "daily_research_cap" },
  },
  "DELETE /api/client-rules/{id}": { path: "/api/client-rules/1" },
};
const ajv = new Ajv2020({ strict: false });

describe("OpenAPI response contract", () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const key = `${method.toUpperCase()} ${path}`;
      it(`${key} returns the documented JSON shape`, async () => {
        expect(cases[key]).toBeDefined();
        const db = memoryDb();
        try {
          const app = createApp(db),
            fixture = cases[key];
          const response = await app.request(fixture.path ?? path, {
            method: method.toUpperCase(),
            headers: { "content-type": "application/json" },
            body:
              fixture.body === undefined
                ? undefined
                : JSON.stringify(fixture.body),
          });
          expect(response.status, await response.clone().text()).toBe(200);
          const data = await response.json();
          const schema =
            operation.responses["200"].content["application/json"].schema;
          const validate = ajv.compile({
            ...schema,
            components: spec.components,
          });
          expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
        } finally {
          db.close();
        }
      });
    }
  }
  it("has a fixture for every documented operation", () => {
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(Object.keys(cases).sort()).toEqual(operations.sort());
  });
});
