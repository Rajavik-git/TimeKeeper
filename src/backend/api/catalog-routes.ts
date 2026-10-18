import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { CatalogService } from "../application/catalog.js";
import { catalogRepository } from "../adapters/sqlite/catalog-repository.js";
import { AppError } from "../application/errors.js";
import { apiError } from "./errors.js";

async function input(context: {
  req: { json(): Promise<unknown> };
}): Promise<Record<string, unknown>> {
  const value = await context.req.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid-request", "JSON object required");
  return value as Record<string, unknown>;
}
function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError("invalid-request", "invalid ID");
  return id;
}
export function catalogRoutes(db: DatabaseSync): Hono {
  const routes = new Hono();
  const service = new CatalogService(catalogRepository(db));
  routes.onError(apiError);
  routes.get("/catalog", (c) => c.json(service.getCatalog()));
  routes.get("/cases/search", (c) => c.json(service.searchCases(c.req.query("query") ?? "")));
  routes.get("/audit-events", (c) => c.json(service.auditEvents()));
  routes.post("/catalog/clients", async (c) => c.json(service.createClient(await input(c))));
  routes.patch("/catalog/clients/:id", async (c) =>
    c.json(service.updateClient(c.req.param("id"), await input(c))),
  );
  routes.post("/catalog/cases", async (c) => c.json(service.createCase(await input(c))));
  routes.patch("/catalog/cases/:id", async (c) =>
    c.json(service.updateCase(c.req.param("id"), await input(c))),
  );
  routes.patch("/catalog/settings", async (c) => c.json(service.updateSettings(await input(c))));
  routes.post("/catalog/task-types", async (c) => c.json(service.createTaskType(await input(c))));
  routes.patch("/catalog/task-types/:id", async (c) =>
    c.json(service.updateTaskType(numericId(c.req.param("id")), await input(c))),
  );
  routes.post("/catalog/markers", async (c) => c.json(service.createMarker(await input(c))));
  routes.delete("/catalog/markers/:id", (c) =>
    c.json(service.removeMarker(numericId(c.req.param("id")))),
  );
  routes.post("/catalog/client-rules", async (c) =>
    c.json(service.createClientRule(await input(c))),
  );
  routes.delete("/catalog/client-rules/:id", (c) =>
    c.json(service.removeClientRule(numericId(c.req.param("id")))),
  );
  return routes;
}
