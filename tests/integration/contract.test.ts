import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app";

const spec = JSON.parse(readFileSync("src/contracts/openapi.yaml", "utf8")) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<string, { content: { "application/json": { schema: object } } }>;
      }
    >
  >;
  components: object;
};
const cases: Record<string, { path?: string; body?: unknown; status?: number }> = {
  "GET /api/catalog": {},
  "GET /api/audit-events": {},
  "PATCH /api/catalog/clients/{id}": {
    path: "/api/catalog/clients/1",
    body: { hourlyRateCents: 31000 },
  },
  "PATCH /api/catalog/cases/{id}": {
    path: "/api/catalog/cases/1",
    body: { title: "Updated case" },
  },
  "PATCH /api/catalog/settings": { body: { globalHourlyRateCents: 18000 } },
  "POST /api/catalog/task-types": { body: { code: "NEW", label: "New task" } },
  "PATCH /api/catalog/task-types/{id}": {
    path: "/api/catalog/task-types/1",
    body: { label: "Updated task" },
  },
  "POST /api/catalog/markers": {
    body: { caseId: "1", type: "keyword", value: "Explicit keyword" },
  },
  "DELETE /api/catalog/markers/{id}": { path: "/api/catalog/markers/1" },
  "POST /api/catalog/client-rules": { body: { clientId: "1", type: "nonbillable_travel" } },
  "DELETE /api/catalog/client-rules/{id}": { path: "/api/catalog/client-rules/1" },
  "POST /api/catalog/cases/{id}/source-pack": {
    path: "/api/catalog/cases/1/source-pack",
    body: { scope: "case", options: ["audit"] },
  },
  "GET /api/state": {},
  "GET /api/cases/search": { path: "/api/cases/search?query=Dawson" },
  "POST /api/cases/{id}/source-pack": {
    path: "/api/cases/1/source-pack",
    body: { scope: "case", options: ["blur", "audit"] },
  },
  "PATCH /api/time-entries/{id}": {
    path: "/api/time-entries/13",
    body: { matter_id: 5, expected_assignment_revision: 0 },
  },
  "POST /api/day/approve": { body: { date: "2026-10-16" } },
  "POST /api/matters/{id}/approve": { path: "/api/matters/1/approve" },
  "POST /api/time-entries/{id}/discard": {
    path: "/api/time-entries/13/discard",
  },
  "POST /api/blocks/{id}/recover": { path: "/api/blocks/16/recover" },
  "POST /api/time-entries/manual": {
    status: 501,
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
  "POST /api/invoices": {
    body: {
      caseId: 2,
      type: "final",
      periodIds: ["7", "8"],
      revisions: { "7": 0, "8": 0 },
      billedMinutes: 66,
      rateCents: 30000,
      rateOrigin: "client",
      feesCents: 33000,
      subtotalCents: 33000,
      expensesCents: 0,
      disbursementsCents: 0,
      vatCents: 6600,
      totalCents: 39600,
      lines: [
        {
          origin: "work_period",
          originId: "2",
          label: "Work on case",
          billedMinutes: 66,
          rateCents: 30000,
          amountCents: 33000,
          vat: true,
        },
      ],
    },
  },
  "GET /api/sessions/active": {},
  "GET /api/sessions": {},
  "GET /api/work-periods": {},
  "GET /api/sources": {},
  "GET /api/questions": {},
  "POST /api/questions": {
    body: {
      questionId: "retry-13",
      sessionId: "demo-2026-10-16",
      periodId: "13",
      expectedAssignmentRevision: 0,
    },
  },
  "POST /api/commands/start": {
    body: {
      producerId: "test",
      commandId: "start",
      sessionId: "new",
      occurredAt: "2026-10-16T16:43:00Z",
    },
  },
  "POST /api/commands/end": {
    body: {
      producerId: "test",
      commandId: "end",
      sessionId: "demo-2026-10-16",
      occurredAt: "2026-10-16T17:00:00Z",
    },
  },
  "POST /api/work-periods/{id}/assignment": {
    path: "/api/work-periods/13/assignment",
    body: { caseId: "5", expectedAssignmentRevision: 0, origin: "lawyer" },
  },
  "POST /api/work-periods/{id}/duration-override": {
    path: "/api/work-periods/14/duration-override",
    body: { durationMs: 600000 },
  },
  "POST /api/work-periods/{id}/detected-duration": {
    path: "/api/work-periods/14/detected-duration",
    body: { durationMs: 600000 },
  },
  "POST /api/work-periods/{id}/validate-time": {
    path: "/api/work-periods/14/validate-time",
    body: {},
  },
  "POST /api/work-periods/{id}/billing-status": {
    path: "/api/work-periods/14/billing-status",
    body: { status: "unbilled" },
  },
  "POST /api/questions/answer": {
    body: {
      questionId: "demo-question-13",
      sessionId: "demo-2026-10-16",
      periodId: "13",
      expectedAssignmentRevision: 0,
      caseId: "5",
      responseCommandId: "answer-13",
    },
  },
  "POST /api/sources/{instanceId}/{contentType}/{externalId}/validate": {
    path: "/api/sources/demo/screen/frame_id%2042001/validate",
    body: {},
  },
  "POST /api/work-periods/manual": {
    body: {
      sessionId: "demo-2026-10-16",
      caseId: "1",
      startedAt: "2026-10-16T17:00:00Z",
      durationMs: 600000,
      taskTypeId: 5,
      label: "Demo hearing",
    },
  },
  "PATCH /api/work-periods/{id}/details": {
    path: "/api/work-periods/14/details",
    body: { label: "Updated demo work" },
  },
  "POST /api/sources/{instanceId}/{contentType}/{externalId}/availability": {
    path: "/api/sources/demo/screen/frame_id%2042001/availability",
    body: { availability: "unavailable" },
  },
  "GET /api/billing/state": {},
  "GET /api/coverage-gaps": {},
  "POST /api/billing/expenses": {
    body: { caseId: "2", date: "2026-10-16", label: "Filing", type: "expense", amountCents: 1000 },
  },
  "DELETE /api/billing/expenses/{id}": { path: "/api/billing/expenses/1" },
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
Object.assign(cases, {
  "POST /api/work-periods": {
    body: {
      id: "new-recovery",
      sessionId: "demo-2026-10-16",
      caseId: "1",
      startedAt: "2026-10-16T17:30:00Z",
      origin: "automatic",
      mode: "current",
    },
  },
  "POST /api/sources/import": {
    body: {
      id: "new-import",
      periodId: "14",
      instanceId: "test",
      contentType: "screen",
      externalId: "new-frame",
      recordedAt: "2026-10-16T09:00:00Z",
    },
  },
  "POST /api/reconstruction/propose": {
    body: {
      id: "new-conflict",
      periodId: "14",
      expectedRevision: 0,
      startedAt: "2026-10-16T09:00:00Z",
      endedAt: "2026-10-16T10:00:00Z",
      sourceReferences: [],
    },
  },
  "POST /api/settings/rate": {
    body: { globalHourlyRateCents: 25000, currency: "EUR", workspaceId: "demo-workspace" },
  },
  "POST /api/catalog/clients": { body: { id: "new-client", name: "Fictional" } },
  "POST /api/catalog/cases": {
    body: {
      id: "new-case",
      clientId: "1",
      reference: "NEW",
      title: "Fictional",
      hourlyRateCents: null,
    },
  },
  "GET /api/cases/{id}/rate": { path: "/api/cases/1/rate" },
});
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
            body: fixture.body === undefined ? undefined : JSON.stringify(fixture.body),
          });
          const documentedStatus = fixture.status ?? (operation.responses["200"] ? 200 : 202);
          expect(response.status, await response.clone().text()).toBe(documentedStatus);
          const data = await response.json();
          const schema =
            operation.responses[String(documentedStatus)].content["application/json"].schema;
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
