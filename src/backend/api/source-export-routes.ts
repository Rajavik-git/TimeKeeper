import { Hono } from "hono";
import type { SourceExportService } from "../application/source-export.js";
import { positiveIntegerId } from "./request-fields.js";
import type { SourceExportRequest } from "../ports/source-export.js";
import { apiError } from "./errors.js";

export function sourceExportRoutes(service: SourceExportService): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  routes.post("/catalog/cases/:id/source-pack", async (c) =>
    c.json(service.exportCase(c.req.param("id"), await c.req.json<SourceExportRequest>())),
  );
  routes.get("/invoices/:id/csv", (c) => {
    const id = positiveIntegerId(c.req.param("id"));
    return c.json(service.invoiceCsv(id));
  });
  return routes;
}
