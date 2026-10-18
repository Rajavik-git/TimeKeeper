import { Hono } from "hono";
import type { ScreenpipeIntegration } from "../ports/screenpipe-integration.js";

export function screenpipeRoutes(integration: ScreenpipeIntegration): Hono {
  const routes = new Hono();
  routes.get("/integrations/screenpipe", (c) => c.json(integration.status()));
  routes.post("/integrations/screenpipe/test", async (c) => c.json(await integration.test()));
  routes.post("/integrations/screenpipe/sync", async (c) => c.json(await integration.sync()));
  return routes;
}
