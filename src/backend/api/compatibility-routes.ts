import { Hono } from "hono";
import { AppError } from "../application/errors.js";
import type { CompatibilityApiService } from "../application/compatibility.js";
import { apiError } from "./errors.js";

import { positiveIntegerId } from "./request-fields.js";

const catalogId = (value: string): number | string => {
  if (!value.trim() || value.length > 200)
    throw new AppError("invalid-request", "Invalid catalog ID");
  const numeric = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(numeric) ? numeric : value;
};

/** Retained older API contracts. Current screens use the catalogue and period routers. */
export function compatibilityRoutes(compatibility: CompatibilityApiService): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  routes.get("/state", (c) =>
    c.json(
      compatibility.state(c.req.query("date"), c.req.query("clientId"), c.req.query("caseId")),
    ),
  );
  routes.post("/cases/:id/source-pack", async (c) => {
    const body = await c.req.json<{
      scope: "invoice" | "case" | "period" | "chosen";
      options: string[];
      invoiceId?: number;
      from?: string;
      to?: string;
      periodIds?: Array<number | string>;
      timeZone?: string;
    }>();
    if (
      !["invoice", "case", "period", "chosen"].includes(body.scope) ||
      !Array.isArray(body.options)
    )
      throw new AppError("invalid-request", "Source pack scope and options required");
    if (body.scope === "invoice" && !Number.isInteger(body.invoiceId))
      throw new AppError("invalid-request", "Invoice required");
    if (body.scope === "period" && (!body.from || !body.to))
      throw new AppError("invalid-request", "Date range required");
    if (body.scope === "chosen" && !Array.isArray(body.periodIds))
      throw new AppError("invalid-request", "Period selection required");
    return c.json(
      compatibility.exportCaseSources(catalogId(c.req.param("id")), body.scope, body.options, body),
    );
  });
  routes.patch("/time-entries/:id", async (c) =>
    c.json(
      compatibility.updateEntry(
        positiveIntegerId(c.req.param("id")),
        await c.req.json<Record<string, unknown>>(),
      ),
    ),
  );
  routes.post("/day/approve", async (c) => {
    const body = await c.req.json<{
      date: string;
      expected_effective_revisions: Record<string, number>;
    }>();
    return c.json(compatibility.approveDay(body.date, body.expected_effective_revisions));
  });
  routes.post("/matters/:id/approve", async (c) => {
    const body = await c.req.json<{ expected_effective_revisions: Record<string, number> }>();
    return c.json(
      compatibility.approveCase(catalogId(c.req.param("id")), body.expected_effective_revisions),
    );
  });
  routes.post("/time-entries/:id/discard", (c) =>
    c.json(compatibility.discardEntry(positiveIntegerId(c.req.param("id")))),
  );
  routes.post("/blocks/:id/recover", (c) =>
    c.json(compatibility.recoverBlock(positiveIntegerId(c.req.param("id")))),
  );
  routes.post("/time-entries/manual", (c) =>
    c.json(
      {
        error: "unavailable",
        message:
          "Legacy manual entries are unavailable. Use explicit session and work-period boundaries.",
      },
      501,
    ),
  );
  routes.post("/matters", async (c) =>
    c.json(compatibility.createCase(await c.req.json<Record<string, unknown>>())),
  );
  routes.post("/markers", async (c) =>
    c.json(compatibility.addMarker(await c.req.json<Record<string, unknown>>())),
  );
  routes.delete("/markers/:id", (c) =>
    c.json(compatibility.removeMarker(positiveIntegerId(c.req.param("id")))),
  );
  routes.post("/expenses", async (c) =>
    c.json(compatibility.addExpense(await c.req.json<Record<string, unknown>>())),
  );
  routes.delete("/expenses/:id", (c) =>
    c.json(compatibility.removeExpense(positiveIntegerId(c.req.param("id")))),
  );
  routes.get("/blocks/:id/recognition", (c) =>
    c.json(compatibility.recognition(positiveIntegerId(c.req.param("id")))),
  );
  routes.get("/sources/:id", (c) =>
    c.json(compatibility.timeEntrySourceDetails(positiveIntegerId(c.req.param("id")))),
  );
  routes.post("/sources/:id/export", async (c) =>
    c.json(
      compatibility.exportSources(
        positiveIntegerId(c.req.param("id")),
        (await c.req.json<{ options: string[] }>()).options,
      ),
    ),
  );
  routes.post("/pauses", async (c) =>
    c.json(compatibility.addPause(await c.req.json<Record<string, unknown>>())),
  );
  routes.patch("/pauses/:id", async (c) =>
    c.json(
      compatibility.closePause(
        positiveIntegerId(c.req.param("id")),
        (await c.req.json<{ end_time: string }>()).end_time,
      ),
    ),
  );
  routes.post("/blocks/:id/close", async (c) =>
    c.json(
      compatibility.closeBlock(
        positiveIntegerId(c.req.param("id")),
        (await c.req.json<{ minutes: number }>()).minutes,
      ),
    ),
  );
  for (const table of ["firm", "setting", "client", "matter", "task"] as const)
    routes.patch(`/${table}/:id`, async (c) =>
      c.json(
        compatibility.updateCatalog(
          table,
          table === "client" || table === "matter"
            ? catalogId(c.req.param("id"))
            : positiveIntegerId(c.req.param("id")),
          await c.req.json<Record<string, unknown>>(),
        ),
      ),
    );
  routes.post("/clients", async (c) =>
    c.json(compatibility.createClient(await c.req.json<Record<string, unknown>>())),
  );
  routes.post("/tasks", async (c) =>
    c.json(compatibility.createTask(await c.req.json<Record<string, unknown>>())),
  );
  routes.post("/client-rules", async (c) =>
    c.json(compatibility.createClientRule(await c.req.json<Record<string, unknown>>())),
  );
  routes.delete("/client-rules/:id", (c) =>
    c.json(compatibility.removeClientRule(positiveIntegerId(c.req.param("id")))),
  );
  return routes;
}
