import { Hono } from "hono";
import type { CatalogService } from "../application/catalog.js";
import { AppError } from "../application/errors.js";
import type { PillService } from "../application/pill.js";
import { recognizeWindow } from "../application/window-recognition.js";
import { apiError } from "./errors.js";

import { readJsonObject, requiredString, nonnegativeInteger } from "./request-fields.js";

type Body = Record<string, unknown>;
const caseOrNull = (value: unknown) => (value === null ? null : requiredString(value, "caseId"));

/** Desk pill endpoints: window recognition, confirmed document switches, and undoable choices. */
export function pillRoutes(pill: PillService, catalog: Pick<CatalogService, "getCatalog">): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  routes.post("/recognize", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      recognizeWindow(
        requiredString(body.windowTitle, "windowTitle"),
        requiredString(body.appName, "appName"),
        catalog.getCatalog(),
      ),
    );
  });
  routes.post("/periods/switch", async (c) => {
    const body = await readJsonObject(c);
    const result = pill.switchPeriod({
      caseId: caseOrNull(body.caseId),
      windowTitle: requiredString(body.windowTitle, "windowTitle"),
      appName: requiredString(body.appName, "appName"),
      at: requiredString(body.at, "at"),
      notClientWork: body.notClientWork === true,
    });
    return c.json(result, "status" in result && result.status === "pending" ? 202 : 200);
  });
  routes.post("/pill/decision", async (c) => {
    const body = await readJsonObject(c);
    if (body.kind === "switch")
      return c.json(
        pill.decision({
          kind: "switch",
          caseId: caseOrNull(body.caseId),
          windowTitle: requiredString(body.windowTitle, "windowTitle"),
          appName: requiredString(body.appName, "appName"),
          at: requiredString(body.at, "at"),
        }),
      );
    if (body.kind === "assign")
      return c.json(
        pill.decision({
          kind: "assign",
          periodId: requiredString(body.periodId, "periodId"),
          caseId: requiredString(body.caseId, "caseId"),
          expectedAssignmentRevision: nonnegativeInteger(
            body.expectedAssignmentRevision,
            "expectedAssignmentRevision",
          ),
        }),
      );
    if (body.kind === "exclude")
      return c.json(
        pill.decision({
          kind: "exclude",
          periodId: requiredString(body.periodId, "periodId"),
          expectedAssignmentRevision: nonnegativeInteger(
            body.expectedAssignmentRevision,
            "expectedAssignmentRevision",
          ),
          expectedEffectiveRevision: nonnegativeInteger(
            body.expectedEffectiveRevision,
            "expectedEffectiveRevision",
          ),
        }),
      );
    if (body.kind === "validate") {
      const periodIds = Array.isArray(body.periodIds)
        ? body.periodIds.map((id) => requiredString(id, "periodId"))
        : [];
      const revisions = (body.expectedEffectiveRevisions ?? {}) as Body;
      return c.json(
        pill.decision({
          kind: "validate",
          periodIds,
          expectedEffectiveRevisions: Object.fromEntries(
            periodIds.map((id) => [
              id,
              nonnegativeInteger(revisions[id], `effective revision for ${id}`),
            ]),
          ),
        }),
      );
    }
    throw new AppError("invalid-request", "pill decision kind required");
  });
  routes.post("/pill/undo", async (c) =>
    c.json(pill.undo(requiredString((await readJsonObject(c)).undoToken, "undoToken"))),
  );
  return routes;
}
