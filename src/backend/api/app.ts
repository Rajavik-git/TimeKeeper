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

export function createApp(db: DatabaseSync) {
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
    if (origin && !allowedOrigins.has(origin)) return c.json({ error: "Origin not allowed" }, 403);
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
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/api", sourceExportRoutes(db));
  app.route("/api", catalogRoutes(db));
  app.route("/api", coreRoutes(db));
  app.route("/api", compatibilityRoutes(db));
  return app;
}
