import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { SourceExportService } from "../application/source-export.js";
import { sourceExportPort } from "../adapters/sqlite/source-export.js";
import { AppError } from "../application/service.js";
import type { SourceExportRequest } from "../ports/source-export.js";
import { apiError } from "./errors.js";

export function sourceExportRoutes(db: DatabaseSync): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  const service = new SourceExportService(sourceExportPort(db));
  routes.post("/catalog/cases/:id/source-pack", async (c) =>
    c.json(service.exportCase(c.req.param("id"), await c.req.json<SourceExportRequest>())),
  );
  routes.get("/invoices/:id/csv", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1)
      throw new AppError("invalid-request", "invalid invoice ID");
    return c.json(service.invoiceCsv(id));
  });
  return routes;
}
