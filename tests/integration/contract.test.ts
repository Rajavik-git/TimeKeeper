import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { memoryDb } from "../fixtures/database.js";
import { createApp, createHttpApp } from "../../src/backend/api/app";
import { createApplicationServices } from "../../src/backend/bootstrap.js";
import type { ApplicationServices } from "../../src/backend/bootstrap.js";
import type {
  HistoryClaim,
  HistoryJob,
  HistoryProposalInput,
  HistoryState,
} from "../../src/contracts/history.js";

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
type ResponseFixture = { path?: string; body?: unknown; status?: number };
const cases: Record<string, ResponseFixture> = {
  "GET /api/history": {},
  "POST /api/history/generate": {},
  "POST /api/history/claim": { body: {} },
  "GET /api/history/jobs/{id}": {},
  "POST /api/history/jobs/{id}/complete": {},
  "POST /api/history/jobs/{id}/fail": {},
  "POST /api/history/proposals/{id}/accept": {},
  "POST /api/history/proposals/{id}/reject": {},
  "GET /api/clients": {},
  "GET /api/cases": {},
  "GET /api/settings": {},
  "GET /api/health": {},
  "GET /api/inbox/failed": {},
  "GET /api/integrations/screenpipe": {},
  "POST /api/integrations/screenpipe/test": { body: {} },
  "POST /api/integrations/screenpipe/sync": { body: {} },
  "GET /api/sessions/{id}": { path: "/api/sessions/demo-2026-10-16" },
  "GET /api/work-periods/{id}": { path: "/api/work-periods/14" },
  "GET /api/work-periods/{id}/sources": { path: "/api/work-periods/14/sources" },
  "POST /api/inbox/failed/{file}/dismiss": {
    path: "/api/inbox/failed/absent.json/dismiss",
    status: 404,
  },
  "POST /api/work-periods/validate-time": { body: [{ id: "14", expectedEffectiveRevision: 0 }] },
  "POST /api/sources": {
    body: {
      id: "batch-new",
      periodId: "14",
      instanceId: "fixture",
      contentType: "screen",
      externalId: "batch-new",
      recordedAt: "2026-10-16T09:00:00Z",
    },
  },
  "GET /api/catalog": {},
  "GET /api/workspace": {},
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
  "POST /api/day/approve": { body: { date: "2026-10-16", expected_effective_revisions: {} } },
  "POST /api/matters/{id}/approve": {
    path: "/api/matters/1/approve",
    body: { expected_effective_revisions: {} },
  },
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
      vatCents: 0,
      totalCents: 33000,
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
    body: { durationMs: 600000, expectedRevision: 0 },
  },
  "POST /api/work-periods/{id}/detected-duration": {
    path: "/api/work-periods/14/detected-duration",
    body: { durationMs: 600000 },
  },
  "POST /api/work-periods/{id}/validate-time": {
    path: "/api/work-periods/14/validate-time",
    body: { expectedEffectiveRevision: 0 },
  },
  "POST /api/work-periods/{id}/billing-status": {
    path: "/api/work-periods/14/billing-status",
    body: { status: "unbilled", expectedRevision: 0 },
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
    body: { label: "Updated demo work", expectedRevision: 0 },
  },
  "POST /api/sources/{instanceId}/{contentType}/{externalId}/availability": {
    path: "/api/sources/demo/screen/frame_id%2042001/availability",
    body: { availability: "unavailable" },
  },
  "GET /api/billing/state": {},
  "GET /api/coverage-gaps": {},
  "GET /api/reconstruction-conflicts": {},
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
      mode: "recovery",
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
  "POST /api/recognize": {
    body: { windowTitle: "2025-031 Opposition Brief v3.docx", appName: "Word" },
  },
  "POST /api/periods/switch": {
    body: {
      caseId: "1",
      windowTitle: "2025-031 Opposition Brief v3.docx",
      appName: "Word",
      at: "2026-10-16T16:43:00Z",
    },
  },
  "POST /api/pill/decision": {
    body: { kind: "assign", periodId: "13", caseId: "5", expectedAssignmentRevision: 0 },
  },
  "POST /api/pill/undo": { status: 409, body: { undoToken: "expired-token" } },
});
/** Exercise real successful workflow stages against a dedicated session and source. */
async function prepareHistoryFixture(
  app: ReturnType<typeof createHttpApp>,
  services: ApplicationServices,
  key: string,
): Promise<ResponseFixture> {
  const startAt = "2026-10-17T09:00:00.000Z";
  const endAt = "2026-10-17T09:30:00.000Z";
  services.repository.insertSession(
    { id: "history-contract", startedAt: startAt, endedAt: endAt, revision: 0 },
    services.clock.now(),
  );
  services.core.importSource({
    id: "history-source",
    periodId: null,
    instanceId: "history-fixture",
    contentType: "ocr",
    externalId: "frame-1",
    recordedAt: "2026-10-17T09:05:00.000Z",
  });
  const input = { sessionId: "history-contract", startAt, endAt };
  if (key === "POST /api/history/generate") return { body: input };
  async function post(path: string, body: unknown) {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  }
  const job = (await post("/api/history/generate", input)) as HistoryJob;
  if (key === "GET /api/history/jobs/{id}") return { path: `/api/history/jobs/${job.id}` };
  if (key === "POST /api/history/claim") return { body: {} };
  const claim = (await post("/api/history/claim", {})) as HistoryClaim;
  const proposal: HistoryProposalInput = {
    caseId: null,
    startedAt: startAt,
    endedAt: endAt,
    label: "Review recorded documents",
    confidence: null,
    sourceIds: ["history-source"],
    hasGaps: true,
  };
  if (key === "POST /api/history/jobs/{id}/complete")
    return {
      path: `/api/history/jobs/${job.id}/complete`,
      body: { claimId: claim.claimId, proposals: [proposal] },
    };
  if (key === "POST /api/history/jobs/{id}/fail")
    return {
      path: `/api/history/jobs/${job.id}/fail`,
      body: { claimId: claim.claimId, error: "history-too-large" },
    };
  await post(`/api/history/jobs/${job.id}/complete`, {
    claimId: claim.claimId,
    proposals: [proposal],
  });
  if (key === "GET /api/history") return { path: "/api/history?sessionId=history-contract" };
  const state = (await (
    await app.request("/api/history?sessionId=history-contract")
  ).json()) as HistoryState;
  const id = state.proposals[0].id;
  if (key === "POST /api/history/proposals/{id}/accept")
    return {
      path: `/api/history/proposals/${id}/accept`,
      body: {
        expectedRevision: 0,
        caseId: null,
        startedAt: startAt,
        endedAt: endAt,
        label: proposal.label,
        durationMs: 60_000,
      },
    };
  return { path: `/api/history/proposals/${id}/reject`, body: { expectedRevision: 0 } };
}

const ajv = new Ajv2020({ strict: false });

describe("OpenAPI response contract", () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const key = `${method.toUpperCase()} ${path}`;
      it(`${key} returns the documented JSON shape`, async () => {
        expect(cases[key]).toBeDefined();
        const db = memoryDb();
        try {
          const historyOperation = path.startsWith("/api/history");
          const services = historyOperation
            ? createApplicationServices(
                db,
                { now: () => "2026-10-18T12:00:00.000Z" },
                { configured: true, dispatch: async () => "started" },
              )
            : undefined;
          const app = services ? createHttpApp(services) : createApp(db);
          const fixture = services ? await prepareHistoryFixture(app, services, key) : cases[key];
          if (key === "POST /api/day/approve" || key === "POST /api/matters/{id}/approve") {
            (fixture.body as Record<string, unknown>).expected_effective_revisions =
              Object.fromEntries(
                (
                  db.prepare("SELECT id,effective_revision FROM work_periods").all() as Array<{
                    id: string;
                    effective_revision: number;
                  }>
                ).map((row) => [row.id, row.effective_revision]),
              );
          }
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
