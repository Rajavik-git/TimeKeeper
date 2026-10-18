import { historyRoutes } from "./history-routes.js";
import type { HistoryRunner } from "../ports/history.js";
import { ScreenpipeIntegrationCoordinator } from "../application/screenpipe-integration.js";
import type { ScreenpipeIntegration } from "../ports/screenpipe-integration.js";
import { screenpipeRoutes } from "./screenpipe-routes.js";
import { createApplicationServices, type ApplicationServices } from "../bootstrap.js";
import { emptyCommandInbox, type CommandInbox } from "../ports/command-inbox.js";
import { listFailedCommands, dismissFailedCommand } from "../application/inbox.js";
import type { Clock } from "../ports/index.js";
import { AppError } from "../application/errors.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { validateRequest } from "./validation.js";
import { apiError } from "./errors.js";
import type { DatabaseSync } from "node:sqlite";
import { coreRoutes } from "./core-routes.js";
import { compatibilityRoutes } from "./compatibility-routes.js";
import { catalogRoutes } from "./catalog-routes.js";
import { sourceExportRoutes } from "./source-export-routes.js";
import { pillRoutes } from "./pill-routes.js";

/** Compatibility factory for callers that already own a SQLite connection. */
export function createApp(
  db: DatabaseSync,
  options: {
    inbox?: CommandInbox;
    clock?: Clock;
    screenpipe?: ScreenpipeIntegration;
    historyRunner?: HistoryRunner;
  } = {},
) {
  return createHttpApp(
    createApplicationServices(db, options.clock, options.historyRunner),
    options,
  );
}

export function createHttpApp(
  services: ApplicationServices,
  options: { inbox?: CommandInbox; screenpipe?: ScreenpipeIntegration } = {},
) {
  const app = new Hono();
  const allowedOrigins = new Set([
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    // The dev UI may run on another port (UI_PORT), and a shared preview may add origins.
    ...(process.env.UI_PORT
      ? [`http://127.0.0.1:${process.env.UI_PORT}`, `http://localhost:${process.env.UI_PORT}`]
      : []),
    ...(process.env.TIMEKEEPER_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ]);
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !allowedOrigins.has(origin))
      throw new AppError("forbidden-origin", "Origin not allowed");
    return cors({
      origin: origin ?? "",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    })(c, next);
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => c.json({ error: "invalid-request", message: "request too large" }, 413),
    }),
  );
  app.use("/api/*", validateRequest);
  app.onError(apiError);
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/inbox/failed", async (c) =>
    c.json(await listFailedCommands(options.inbox ?? emptyCommandInbox)),
  );
  app.post("/api/inbox/failed/:file/dismiss", async (c) => {
    return c.json(dismissFailedCommand(options.inbox ?? emptyCommandInbox, c.req.param("file")));
  });
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route(
    "/api",
    screenpipeRoutes(options.screenpipe ?? new ScreenpipeIntegrationCoordinator("missing-api-key")),
  );
  app.route("/api", historyRoutes(services.history));
  app.route("/api", sourceExportRoutes(services.sourceExports));
  app.route("/api", catalogRoutes(services.catalog));
  app.route("/api", coreRoutes(services));
  app.route("/api", pillRoutes(services.pill, services.catalog));
  app.route("/api", compatibilityRoutes(services.compatibility));
  return app;
}
