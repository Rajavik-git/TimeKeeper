import { serve } from "@hono/node-server";
import { openDb } from "../adapters/sqlite/repository.js";
import { SqliteRepository } from "../adapters/sqlite/core-repository.js";
import { folderInbox, inboxDir } from "../adapters/inbox/folder.js";
import { TimeKeeperService } from "../application/service.js";
import { syncInbox } from "../workers/inbox-sync.js";
import { createApp } from "./app.js";
const db = openDb();
const port = Number(process.env.TIMEKEEPER_PORT ?? 8787);

// docs/API.md D8: apply commands left in the inbox while TimeKeeper was closed before the API (and /api/health)
// answers, then keep checking for files written during short outages.
const inbox = folderInbox(inboxDir());
const service = new TimeKeeperService(new SqliteRepository(db));
const synchronize = () => {
  try {
    const r = syncInbox(inbox, service);
    const total = r.applied.length + r.pending.length + r.failed.length + r.retry.length;
    if (total) console.log(`TimeKeeper inbox: ${r.applied.length} applied, ${r.pending.length} waiting, ${r.failed.length} failed, ${r.retry.length} to retry`);
  } catch (error) {
    console.error("TimeKeeper inbox synchronization failed:", error instanceof Error ? error.message : typeof error);
  }
};
synchronize();
const timer = setInterval(synchronize, 30_000);
timer.unref();

const server = serve({
  fetch: createApp(db).fetch,
  port,
  hostname: "127.0.0.1",
});
console.log(`TimeKeeper API: http://127.0.0.1:${port}`);
const close = () => { clearInterval(timer); server.close(() => db.close()); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
