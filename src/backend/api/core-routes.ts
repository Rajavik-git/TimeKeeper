import {
  isState,
  nonbillableReasons,
  expenseTypes,
  assignmentOrigins,
  AssignmentOrigin,
  AvailabilityStatus,
  BillingStatus,
  CommandStatus,
  QuestionStatus,
  ReconstructionStatus,
  PeriodOpenMode,
} from "../domain/states.js";
import type { InvoiceSnapshot } from "../ports/invoice.js";
import { Hono } from "hono";
import { AppError } from "../application/errors.js";
import { TimeKeeperService } from "../application/service.js";
import { calendarFilter, periodQuery } from "../application/workspace.js";
import type { ApplicationServices } from "../bootstrap.js";
import { apiError } from "./errors.js";

import {
  jsonObject,
  readJsonObject,
  requiredString,
  nonnegativeInteger,
} from "./request-fields.js";

function nullableDuration(value: unknown): number | null {
  return value === null ? null : nonnegativeInteger(value, "durationMs");
}

export function coreRoutes({
  core: service,
  billing,
  workspace,
}: Pick<ApplicationServices, "core" | "billing" | "workspace">): Hono {
  const router = new Hono();
  router.onError(apiError);
  router.get("/sessions/active", (c) => c.json(service.activeSession()));
  router.get("/sessions", (c) => c.json(service.listSessions()));
  router.get("/sessions/:id", (c) => c.json(service.getSession(c.req.param("id"))));
  router.get("/work-periods", (c) => {
    const values = service.queryPeriods(periodQuery(c.req.query()));
    return c.json(values);
  });
  router.get("/workspace", (c) => c.json(workspace.snapshot(c.req.query())));
  router.get("/work-periods/:id", (c) => c.json(service.getPeriod(c.req.param("id"))));
  router.get("/work-periods/:id/sources", (c) => c.json(service.listSources(c.req.param("id"))));
  router.get("/reconstruction-conflicts", (c) => c.json(service.reconstructionConflicts()));
  router.get("/sources", (c) => c.json(service.allSources()));
  router.get("/coverage-gaps", (c) => {
    const matchesDay = calendarFilter(c.req.query());
    return c.json(service.coverageGaps().filter((gap) => matchesDay(gap.startedAt)));
  });
  router.get("/questions", (c) => {
    const ids = new Set(
      service.queryPeriods(periodQuery(c.req.query())).map((period) => period.id),
    );
    const status = c.req.query("status");
    if (status !== undefined && !Object.values(QuestionStatus).includes(status as QuestionStatus))
      throw new AppError("invalid-request", "invalid question status");
    return c.json(
      service
        .allQuestions()
        .filter(
          (question) => ids.has(question.periodId) && (!status || question.status === status),
        ),
    );
  });
  router.get("/billing/state", (c) => c.json(billing.state()));
  router.post("/invoices", async (c) => c.json(billing.issue(await c.req.json<InvoiceSnapshot>())));
  router.post("/billing/expenses", async (c) => {
    const body = await readJsonObject(c);
    if (!isState(body.type, expenseTypes))
      throw new AppError("invalid-request", "invalid expense type");
    return c.json(
      billing.addExpense({
        caseId: requiredString(body.caseId, "caseId"),
        date: requiredString(body.date, "date"),
        label: requiredString(body.label, "label"),
        type: body.type,
        amountCents: nonnegativeInteger(body.amountCents, "amountCents"),
      }),
    );
  });
  router.delete("/billing/expenses/:id", (c) =>
    c.json(billing.removeExpense(nonnegativeInteger(Number(c.req.param("id")), "id"))),
  );
  router.post("/commands/start", async (c) => {
    const body = await readJsonObject(c);
    const result = service.start({
      producerId: requiredString(body.producerId, "producerId"),
      commandId: requiredString(body.commandId, "commandId"),
      sessionId: requiredString(body.sessionId, "sessionId"),
      occurredAt: requiredString(body.occurredAt, "occurredAt"),
      ...(body.prerequisiteCommandId === undefined
        ? {}
        : {
            prerequisiteCommandId: requiredString(
              body.prerequisiteCommandId,
              "prerequisiteCommandId",
            ),
          }),
    });
    return c.json(result, result.status === CommandStatus.Pending ? 202 : 200);
  });
  router.post("/commands/end", async (c) => {
    const body = await readJsonObject(c);
    const result = service.end({
      producerId: requiredString(body.producerId, "producerId"),
      commandId: requiredString(body.commandId, "commandId"),
      sessionId: requiredString(body.sessionId, "sessionId"),
      occurredAt: requiredString(body.occurredAt, "occurredAt"),
      ...(body.prerequisiteCommandId === undefined
        ? {}
        : {
            prerequisiteCommandId: requiredString(
              body.prerequisiteCommandId,
              "prerequisiteCommandId",
            ),
          }),
    });
    return c.json(result, result.status === CommandStatus.Pending ? 202 : 200);
  });
  router.post("/work-periods", async (c) => {
    const body = await readJsonObject(c);
    const transition = {
      ...(body.window ? { window: body.window as { appName: string; title: string } } : {}),
      id: requiredString(body.id, "id"),
      sessionId: requiredString(body.sessionId, "sessionId"),
      caseId: body.caseId === null ? null : requiredString(body.caseId, "caseId"),
      startedAt: requiredString(body.startedAt, "startedAt"),
      origin: isState(body.origin, assignmentOrigins)
        ? body.origin
        : (() => {
            throw new AppError("invalid-request", "origin required");
          })(),
      mode:
        body.mode === PeriodOpenMode.Current || body.mode === PeriodOpenMode.Recovery
          ? body.mode
          : (() => {
              throw new AppError("invalid-request", "mode required");
            })(),
    };
    const guarded =
      body.expectedActivePeriodId !== undefined || body.expectedAssignmentRevision !== undefined;
    if (
      !guarded &&
      transition.mode === PeriodOpenMode.Current &&
      transition.origin !== AssignmentOrigin.Lawyer
    )
      throw new AppError(
        "invalid-request",
        "current inferred transitions require an active-period snapshot",
      );
    const result = guarded
      ? service.recordCaseTransition({
          ...transition,
          expectedActivePeriodId:
            body.expectedActivePeriodId === null
              ? null
              : requiredString(body.expectedActivePeriodId, "expectedActivePeriodId"),
          expectedAssignmentRevision:
            body.expectedAssignmentRevision === null
              ? null
              : nonnegativeInteger(body.expectedAssignmentRevision, "expectedAssignmentRevision"),
        })
      : service.openPeriod(transition);
    return c.json(
      result,
      "status" in result && result.status === CommandStatus.Pending ? 202 : 200,
    );
  });
  router.post("/work-periods/manual", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      service.createManualPeriod({
        sessionId: requiredString(body.sessionId, "sessionId"),
        caseId: requiredString(body.caseId, "caseId"),
        startedAt: requiredString(body.startedAt, "startedAt"),
        durationMs: nonnegativeInteger(body.durationMs, "durationMs"),
        taskTypeId: nonnegativeInteger(body.taskTypeId, "taskTypeId"),
        label: requiredString(body.label, "label"),
      }),
    );
  });
  router.patch("/work-periods/:id/details", async (c) => {
    const body = await readJsonObject(c);
    const reason = body.nonbillableReason;
    if (reason !== undefined && reason !== null && !isState(reason, nonbillableReasons))
      throw new AppError("invalid-request", "invalid nonbillable reason");
    return c.json(
      service.updatePeriodDetails(
        c.req.param("id"),
        {
          ...(body.label === undefined ? {} : { label: requiredString(body.label, "label") }),
          ...(body.billable === undefined ? {} : { billable: body.billable as boolean }),
          ...(reason === undefined ? {} : { nonbillableReason: reason }),
          ...(body.excluded === undefined ? {} : { excluded: body.excluded as boolean }),
        },
        nonnegativeInteger(body.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/work-periods/:id/assignment", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      service.assignPeriod(
        c.req.param("id"),
        requiredString(body.caseId, "caseId"),
        nonnegativeInteger(body.expectedAssignmentRevision, "expectedAssignmentRevision"),
        body.origin === AssignmentOrigin.Automatic
          ? AssignmentOrigin.Automatic
          : body.origin === AssignmentOrigin.Lawyer
            ? AssignmentOrigin.Lawyer
            : (() => {
                throw new AppError("invalid-request", "origin required");
              })(),
      ),
    );
  });
  router.post("/work-periods/:id/detected-duration", async (c) =>
    c.json(
      service.setDetectedDuration(
        c.req.param("id"),
        nullableDuration((await readJsonObject(c)).durationMs),
      ),
    ),
  );
  router.post("/work-periods/:id/duration-override", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      service.setDurationOverride(
        c.req.param("id"),
        nullableDuration(body.durationMs),
        nonnegativeInteger(body.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/work-periods/validate-time", async (c) => {
    const body = await c.req.json<{ id: string; expectedEffectiveRevision: number }[]>();
    return c.json(service.validatePeriods(body));
  });
  router.post("/work-periods/:id/validate-time", async (c) => {
    const body = await readJsonObject(c);
    const revision = nonnegativeInteger(
      body.expectedEffectiveRevision,
      "expectedEffectiveRevision",
    );
    return c.json(
      body.validated === false
        ? service.clearTimeValidation(c.req.param("id"), revision)
        : service.validatePeriod(c.req.param("id"), revision),
    );
  });
  router.post("/work-periods/:id/billing-status", async (c) => {
    const body = await readJsonObject(c);
    if (body.status !== BillingStatus.Billed && body.status !== BillingStatus.Unbilled)
      throw new AppError("invalid-request", "status required");
    return c.json(
      service.setBillingStatus(
        c.req.param("id"),
        body.status,
        nonnegativeInteger(body.expectedRevision, "expectedRevision"),
      ),
    );
  });
  router.post("/questions", async (c) => {
    const body = await readJsonObject(c);
    const questionId = service.askQuestion({
      questionId: requiredString(body.questionId, "questionId"),
      sessionId: requiredString(body.sessionId, "sessionId"),
      periodId: requiredString(body.periodId, "periodId"),
      expectedAssignmentRevision: nonnegativeInteger(
        body.expectedAssignmentRevision,
        "expectedAssignmentRevision",
      ),
    });
    return c.json({ status: QuestionStatus.Pending, questionId }, 202);
  });
  router.post("/questions/answer", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      service.answerQuestion({
        questionId: requiredString(body.questionId, "questionId"),
        sessionId: requiredString(body.sessionId, "sessionId"),
        periodId: requiredString(body.periodId, "periodId"),
        expectedAssignmentRevision: nonnegativeInteger(
          body.expectedAssignmentRevision,
          "expectedAssignmentRevision",
        ),
        caseId: requiredString(body.caseId, "caseId"),
        responseCommandId: requiredString(body.responseCommandId, "responseCommandId"),
      }),
    );
  });
  router.post("/sources/:instanceId/:contentType/:externalId/validate", async (c) => {
    const raw = await c.req.text();
    const body = raw ? jsonObject(await c.req.json()) : {};
    service.validateSource(
      c.req.param("instanceId"),
      c.req.param("contentType"),
      c.req.param("externalId"),
      body.validated !== false,
    );
    return c.json({ status: CommandStatus.Applied });
  });
  router.post("/sources/:instanceId/:contentType/:externalId/availability", async (c) => {
    const body = await readJsonObject(c);
    if (
      body.availability !== AvailabilityStatus.Available &&
      body.availability !== AvailabilityStatus.Unavailable
    )
      throw new AppError("invalid-request", "availability required");
    service.setSourceAvailability(
      c.req.param("instanceId"),
      c.req.param("contentType"),
      c.req.param("externalId"),
      body.availability,
    );
    return c.json({ status: CommandStatus.Applied });
  });
  router.get("/cases/:id/rate", (c) =>
    c.json({ hourlyRateCents: service.currentRateForCase(c.req.param("id")) }),
  );
  router.post("/settings/rate", async (c) => {
    const body = await readJsonObject(c);
    service.setGlobalRate(
      nonnegativeInteger(body.globalHourlyRateCents, "globalHourlyRateCents"),
      requiredString(body.currency, "currency"),
      requiredString(body.workspaceId, "workspaceId"),
    );
    return c.json({ status: CommandStatus.Applied });
  });
  router.post("/sources", async (c) => {
    const body = await c.req.json<
      | Parameters<TimeKeeperService["importSource"]>[0]
      | Parameters<TimeKeeperService["importSource"]>[0][]
    >();
    return c.json(Array.isArray(body) ? service.importSources(body) : service.importSource(body));
  });
  router.post("/sources/import", async (c) => {
    const body = await readJsonObject(c);
    service.importSource({
      id: requiredString(body.id, "id"),
      periodId: body.periodId === null ? null : requiredString(body.periodId, "periodId"),
      instanceId: requiredString(body.instanceId, "instanceId"),
      contentType: requiredString(body.contentType, "contentType"),
      externalId: requiredString(body.externalId, "externalId"),
      recordedAt: requiredString(body.recordedAt, "recordedAt"),
    });
    return c.json({ status: CommandStatus.Applied });
  });
  router.post("/reconstruction/propose", async (c) => {
    const body = await readJsonObject(c);
    service.proposeReconstruction({
      id: requiredString(body.id, "id"),
      periodId: requiredString(body.periodId, "periodId"),
      expectedRevision: nonnegativeInteger(body.expectedRevision, "expectedRevision"),
      startedAt: requiredString(body.startedAt, "startedAt"),
      endedAt: body.endedAt === null ? null : requiredString(body.endedAt, "endedAt"),
      sourceReferences: body.sourceReferences as string[],
    });
    return c.json({ status: ReconstructionStatus.Pending }, 202);
  });
  return router;
}
