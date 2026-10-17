import type { InvoiceSnapshot } from "../ports/invoice.js";
import { calendarDay, isCalendarDay, isTimeZone, systemTimeZone } from "../../shared/dates.js";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { SqliteRepository } from "../adapters/sqlite/core-repository.js";
import { AppError, TimeKeeperService } from "../application/service.js";
import { addExpense, billingState, issueInvoice, removeExpense } from "../application/invoice.js";
import { apiError } from "./errors.js";
import { invoicePort } from "../adapters/sqlite/invoice.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid-request", "JSON object required");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new AppError("invalid-request", `${name} required`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new AppError("invalid-request", `${name} must be a nonnegative integer`);
  return value;
}
function duration(value: unknown): number | null {
  return value === null ? null : integer(value, "durationMs");
}
const input = async (c: { req: { json: () => Promise<unknown> } }) => object(await c.req.json());

function calendarFilters(query: Record<string, string>) {
  const { date, from, to } = query;
  const timeZone = query.timeZone ?? systemTimeZone();
  if (!isTimeZone(timeZone)) throw new AppError("invalid-request", "invalid timeZone");
  for (const [name, value] of Object.entries({ date, from, to })) {
    if (value !== undefined && !isCalendarDay(value))
      throw new AppError("invalid-request", `${name} must be a valid calendar day`);
  }
  if (from && to && from > to)
    throw new AppError("invalid-request", "from must be on or before to");
  return (startedAt: string) => {
    const day = calendarDay(startedAt, timeZone);
    return (!date || day === date) && (!from || day >= from) && (!to || day <= to);
  };
}

export function coreRoutes(db: DatabaseSync): Hono {
  const router = new Hono();
  const service = new TimeKeeperService(new SqliteRepository(db));
  const billing = invoicePort(db);
  router.onError(apiError);
  router.get("/sessions/active", (c) => c.json(service.activeSession()));
  router.get("/sessions", (c) => c.json(service.listSessions()));
  router.get("/sessions/:id", (c) => c.json(service.getSession(c.req.param("id"))));
  router.get("/work-periods", (c) => {
    const query = c.req.query();
    const matchesDay = calendarFilters(query);
    const { clientId, caseId } = query;
    const values = service
      .allPeriods()
      .filter(
        (period) =>
          matchesDay(period.startedAt) &&
          (!clientId || period.clientId === clientId) &&
          (!caseId || period.caseId === caseId),
      );
    return c.json(values);
  });
  router.get("/work-periods/:id", (c) => c.json(service.getPeriod(c.req.param("id"))));
  router.get("/work-periods/:id/sources", (c) => c.json(service.listSources(c.req.param("id"))));
  router.get("/reconstruction-conflicts", (c) => c.json(service.reconstructionConflicts()));
  router.get("/sources", (c) => c.json(service.allSources()));
  router.get("/coverage-gaps", (c) => {
    const matchesDay = calendarFilters(c.req.query());
    return c.json(service.coverageGaps().filter((gap) => matchesDay(gap.startedAt)));
  });
  router.get("/questions", (c) => {
    const matchesDay = calendarFilters(c.req.query());
    const ids = new Set(
      service
        .allPeriods()
        .filter((period) => matchesDay(period.startedAt))
        .map((period) => period.id),
    );
    return c.json(service.allQuestions().filter((question) => ids.has(question.periodId)));
  });
  router.get("/billing/state", (c) => c.json(billingState(billing)));
  router.post("/invoices", async (c) =>
    c.json(issueInvoice(billing, await c.req.json<InvoiceSnapshot>(), new Date().toISOString())),
  );
  router.post("/billing/expenses", async (c) => {
    const b = await input(c);
    if (b.type !== "expense" && b.type !== "disbursement")
      throw new AppError("invalid-request", "invalid expense type");
    return c.json(
      addExpense(billing, {
        caseId: string(b.caseId, "caseId"),
        date: string(b.date, "date"),
        label: string(b.label, "label"),
        type: b.type,
        amountCents: integer(b.amountCents, "amountCents"),
      }),
    );
  });
  router.delete("/billing/expenses/:id", (c) =>
    c.json(removeExpense(billing, integer(Number(c.req.param("id")), "id"))),
  );
  router.post("/commands/start", async (c) => {
    const b = await input(c);
    const result = service.start({
      producerId: string(b.producerId, "producerId"),
      commandId: string(b.commandId, "commandId"),
      sessionId: string(b.sessionId, "sessionId"),
      occurredAt: string(b.occurredAt, "occurredAt"),
      ...(b.prerequisiteCommandId === undefined
        ? {}
        : { prerequisiteCommandId: string(b.prerequisiteCommandId, "prerequisiteCommandId") }),
    });
    return c.json(result, result.status === "pending" ? 202 : 200);
  });
  router.post("/commands/end", async (c) => {
    const b = await input(c);
    const result = service.end({
      producerId: string(b.producerId, "producerId"),
      commandId: string(b.commandId, "commandId"),
      sessionId: string(b.sessionId, "sessionId"),
      occurredAt: string(b.occurredAt, "occurredAt"),
      ...(b.prerequisiteCommandId === undefined
        ? {}
        : { prerequisiteCommandId: string(b.prerequisiteCommandId, "prerequisiteCommandId") }),
    });
    return c.json(result, result.status === "pending" ? 202 : 200);
  });
  router.post("/work-periods", async (c) => {
    const b = await input(c);
    const result = service.openPeriod({
      id: string(b.id, "id"),
      sessionId: string(b.sessionId, "sessionId"),
      caseId: b.caseId === null ? null : string(b.caseId, "caseId"),
      startedAt: string(b.startedAt, "startedAt"),
      origin:
        b.origin === "lawyer" || b.origin === "automatic" || b.origin === "unresolved"
          ? b.origin
          : (() => {
              throw new AppError("invalid-request", "origin required");
            })(),
      mode:
        b.mode === "current" || b.mode === "recovery"
          ? b.mode
          : (() => {
              throw new AppError("invalid-request", "mode required");
            })(),
    });
    return c.json(result, "status" in result && result.status === "pending" ? 202 : 200);
  });
  router.post("/work-periods/manual", async (c) => {
    const b = await input(c);
    return c.json(
      service.createManualPeriod({
        sessionId: string(b.sessionId, "sessionId"),
        caseId: string(b.caseId, "caseId"),
        startedAt: string(b.startedAt, "startedAt"),
        durationMs: integer(b.durationMs, "durationMs"),
        taskTypeId: integer(b.taskTypeId, "taskTypeId"),
        label: string(b.label, "label"),
      }),
    );
  });
  router.patch("/work-periods/:id/details", async (c) => {
    const b = await input(c);
    return c.json(
      service.updatePeriodDetails(
        c.req.param("id"),
        {
          ...(b.label === undefined ? {} : { label: string(b.label, "label") }),
          ...(b.billable === undefined ? {} : { billable: b.billable as boolean }),
          ...(b.nonbillableReason === undefined
            ? {}
            : { nonbillableReason: b.nonbillableReason as string | null }),
          ...(b.excluded === undefined ? {} : { excluded: b.excluded as boolean }),
        },
        integer(b.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/work-periods/:id/assignment", async (c) => {
    const b = await input(c);
    return c.json(
      service.assignPeriod(
        c.req.param("id"),
        string(b.caseId, "caseId"),
        integer(b.expectedAssignmentRevision, "expectedAssignmentRevision"),
        b.origin === "automatic"
          ? "automatic"
          : b.origin === "lawyer"
            ? "lawyer"
            : (() => {
                throw new AppError("invalid-request", "origin required");
              })(),
      ),
    );
  });
  router.post("/work-periods/:id/detected-duration", async (c) =>
    c.json(service.setDetectedDuration(c.req.param("id"), duration((await input(c)).durationMs))),
  );
  router.post("/work-periods/:id/duration-override", async (c) => {
    const b = await input(c);
    return c.json(
      service.setDurationOverride(
        c.req.param("id"),
        duration(b.durationMs),
        integer(b.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/work-periods/:id/validate-time", async (c) => {
    const b = await input(c);
    return c.json(
      service.validatePeriod(
        c.req.param("id"),
        integer(b.expectedEffectiveRevision, "expectedEffectiveRevision"),
      ),
    );
  });
  router.post("/work-periods/:id/billing-status", async (c) => {
    const b = await input(c);
    if (b.status !== "billed" && b.status !== "unbilled")
      throw new AppError("invalid-request", "status required");
    return c.json(
      service.setBillingStatus(
        c.req.param("id"),
        b.status,
        integer(b.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/questions", async (c) => {
    const b = await input(c);
    const questionId = service.askQuestion({
      questionId: string(b.questionId, "questionId"),
      sessionId: string(b.sessionId, "sessionId"),
      periodId: string(b.periodId, "periodId"),
      expectedAssignmentRevision: integer(
        b.expectedAssignmentRevision,
        "expectedAssignmentRevision",
      ),
    });
    return c.json({ status: "pending", questionId }, 202);
  });
  router.post("/questions/answer", async (c) => {
    const b = await input(c);
    return c.json(
      service.answerQuestion({
        questionId: string(b.questionId, "questionId"),
        sessionId: string(b.sessionId, "sessionId"),
        periodId: string(b.periodId, "periodId"),
        expectedAssignmentRevision: integer(
          b.expectedAssignmentRevision,
          "expectedAssignmentRevision",
        ),
        caseId: string(b.caseId, "caseId"),
        responseCommandId: string(b.responseCommandId, "responseCommandId"),
      }),
    );
  });
  router.post("/sources/:instanceId/:contentType/:externalId/validate", (c) => {
    service.validateSource(
      c.req.param("instanceId"),
      c.req.param("contentType"),
      c.req.param("externalId"),
    );
    return c.json({ status: "applied" });
  });
  router.post("/sources/:instanceId/:contentType/:externalId/availability", async (c) => {
    const b = await input(c);
    if (b.availability !== "available" && b.availability !== "unavailable")
      throw new AppError("invalid-request", "availability required");
    service.setSourceAvailability(
      c.req.param("instanceId"),
      c.req.param("contentType"),
      c.req.param("externalId"),
      b.availability,
    );
    return c.json({ status: "applied" });
  });
  router.get("/cases/:id/rate", (c) =>
    c.json({ hourlyRateCents: service.currentRateForCase(c.req.param("id")) }),
  );
  router.post("/settings/rate", async (c) => {
    const b = await input(c);
    service.setGlobalRate(
      integer(b.globalHourlyRateCents, "globalHourlyRateCents"),
      string(b.currency, "currency"),
      string(b.workspaceId, "workspaceId"),
    );
    return c.json({ status: "applied" });
  });
  router.post("/sources/import", async (c) => {
    const b = await input(c);
    service.importSource({
      id: string(b.id, "id"),
      periodId: b.periodId === null ? null : string(b.periodId, "periodId"),
      instanceId: string(b.instanceId, "instanceId"),
      contentType: string(b.contentType, "contentType"),
      externalId: string(b.externalId, "externalId"),
      recordedAt: string(b.recordedAt, "recordedAt"),
    });
    return c.json({ status: "applied" });
  });
  router.post("/reconstruction/propose", async (c) => {
    const b = await input(c);
    service.proposeReconstruction({
      id: string(b.id, "id"),
      periodId: string(b.periodId, "periodId"),
      expectedRevision: integer(b.expectedRevision, "expectedRevision"),
      startedAt: string(b.startedAt, "startedAt"),
      endedAt: b.endedAt === null ? null : string(b.endedAt, "endedAt"),
      sourceReferences: b.sourceReferences as string[],
    });
    return c.json({ status: "pending" }, 202);
  });
  return router;
}
