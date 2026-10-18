import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { SqliteRepository } from "../adapters/sqlite/core-repository.js";
import { catalogRepository } from "../adapters/sqlite/catalog-repository.js";
import { AppError, TimeKeeperService } from "../application/service.js";
import { PillService } from "../application/pill.js";
import { recognizeWindow } from "../application/window-recognition.js";
import { apiError } from "./errors.js";

type Body = Record<string, unknown>;
const input = async (c: { req: { json: () => Promise<unknown> } }): Promise<Body> => {
  const value = await c.req.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid-request", "JSON object required");
  return value as Body;
};
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
const caseOrNull = (value: unknown) => (value === null ? null : string(value, "caseId"));

/** Desk pill endpoints: window recognition, confirmed document switches, and undoable choices. */
export function pillRoutes(db: DatabaseSync): Hono {
  const routes = new Hono();
  const repository = new SqliteRepository(db);
  const catalog = catalogRepository(db);
  const pill = new PillService(repository, new TimeKeeperService(repository));
  routes.onError(apiError);
  routes.post("/recognize", async (c) => {
    const b = await input(c);
    return c.json(
      recognizeWindow(
        string(b.windowTitle, "windowTitle"),
        string(b.appName, "appName"),
        catalog.state(),
      ),
    );
  });
  routes.post("/periods/switch", async (c) => {
    const b = await input(c);
    const result = pill.switchPeriod({
      caseId: caseOrNull(b.caseId),
      windowTitle: string(b.windowTitle, "windowTitle"),
      appName: string(b.appName, "appName"),
      at: string(b.at, "at"),
      notClientWork: b.notClientWork === true,
    });
    return c.json(result, "status" in result && result.status === "pending" ? 202 : 200);
  });
  routes.post("/pill/decision", async (c) => {
    const b = await input(c);
    if (b.kind === "switch")
      return c.json(
        pill.decision({
          kind: "switch",
          caseId: caseOrNull(b.caseId),
          windowTitle: string(b.windowTitle, "windowTitle"),
          appName: string(b.appName, "appName"),
          at: string(b.at, "at"),
        }),
      );
    if (b.kind === "assign")
      return c.json(
        pill.decision({
          kind: "assign",
          periodId: string(b.periodId, "periodId"),
          caseId: string(b.caseId, "caseId"),
          expectedAssignmentRevision: integer(
            b.expectedAssignmentRevision,
            "expectedAssignmentRevision",
          ),
        }),
      );
    if (b.kind === "exclude")
      return c.json(
        pill.decision({
          kind: "exclude",
          periodId: string(b.periodId, "periodId"),
          expectedAssignmentRevision: integer(
            b.expectedAssignmentRevision,
            "expectedAssignmentRevision",
          ),
          expectedEffectiveRevision: integer(
            b.expectedEffectiveRevision,
            "expectedEffectiveRevision",
          ),
        }),
      );
    if (b.kind === "validate") {
      const periodIds = Array.isArray(b.periodIds)
        ? b.periodIds.map((id) => string(id, "periodId"))
        : [];
      const revisions = (b.expectedEffectiveRevisions ?? {}) as Body;
      return c.json(
        pill.decision({
          kind: "validate",
          periodIds,
          expectedEffectiveRevisions: Object.fromEntries(
            periodIds.map((id) => [id, integer(revisions[id], `effective revision for ${id}`)]),
          ),
        }),
      );
    }
    throw new AppError("invalid-request", "pill decision kind required");
  });
  routes.post("/pill/undo", async (c) =>
    c.json(pill.undo(string((await input(c)).undoToken, "undoToken"))),
  );
  return routes;
}
