import { Hono } from "hono";
import type { CatalogService } from "../application/catalog.js";
import { apiError } from "./errors.js";

import { readJsonObject, positiveIntegerId } from "./request-fields.js";

export function catalogRoutes(service: CatalogService): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  routes.get("/clients", (c) => c.json(service.listClients()));
  routes.get("/cases", (c) => c.json(service.listCases(c.req.query())));
  routes.get("/settings", (c) => c.json(service.getSettings()));
  routes.get("/catalog", (c) => c.json(service.getCatalog()));
  routes.get("/cases/search", (c) => c.json(service.searchCases(c.req.query("query") ?? "")));
  routes.get("/audit-events", (c) => c.json(service.auditEvents()));
  routes.post("/catalog/clients", async (c) =>
    c.json(service.createClient(await readJsonObject(c))),
  );
  routes.patch("/catalog/clients/:id", async (c) =>
    c.json(service.updateClient(c.req.param("id"), await readJsonObject(c))),
  );
  routes.post("/catalog/cases", async (c) => c.json(service.createCase(await readJsonObject(c))));
  routes.patch("/catalog/cases/:id", async (c) =>
    c.json(service.updateCase(c.req.param("id"), await readJsonObject(c))),
  );
  routes.patch("/catalog/settings", async (c) =>
    c.json(service.updateSettings(await readJsonObject(c))),
  );
  routes.post("/catalog/task-types", async (c) =>
    c.json(service.createTaskType(await readJsonObject(c))),
  );
  routes.patch("/catalog/task-types/:id", async (c) =>
    c.json(service.updateTaskType(positiveIntegerId(c.req.param("id")), await readJsonObject(c))),
  );
  routes.post("/catalog/markers", async (c) =>
    c.json(service.createMarker(await readJsonObject(c))),
  );
  routes.delete("/catalog/markers/:id", (c) =>
    c.json(service.removeMarker(positiveIntegerId(c.req.param("id")))),
  );
  routes.post("/catalog/client-rules", async (c) =>
    c.json(service.createClientRule(await readJsonObject(c))),
  );
  routes.delete("/catalog/client-rules/:id", (c) =>
    c.json(service.removeClientRule(positiveIntegerId(c.req.param("id")))),
  );
  return routes;
}
