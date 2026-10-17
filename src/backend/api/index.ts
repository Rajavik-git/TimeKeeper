import { serve } from "@hono/node-server";
import { openDb } from "../adapters/sqlite/repository.js";
import { createApp } from "./app.js";
const db = openDb();
const port = Number(process.env.TIMEKEEPER_PORT ?? 8787);
const server = serve({
  fetch: createApp(db).fetch,
  port,
  hostname: "127.0.0.1",
});
console.log(`TimeKeeper API: http://127.0.0.1:${port}`);
const close = () => server.close(() => db.close());
process.on("SIGINT", close);
process.on("SIGTERM", close);
