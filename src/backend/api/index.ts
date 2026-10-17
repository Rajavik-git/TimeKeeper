import { serve } from "@hono/node-server";
import { openDb } from "../adapters/sqlite/repository.js";
import { SqliteRepository } from "../adapters/sqlite/core-repository.js";
import { folderInbox, inboxDir } from "../adapters/inbox/folder.js";
import { TimeKeeperService } from "../application/service.js";
import { syncInbox } from "../workers/inbox-sync.js";
import { httpScreenpipe, screenpipeConfigFromEnv } from "../adapters/screenpipe/http.js";
import { catchUpRecordings } from "../workers/recording-catchup.js";
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
  fetch: createApp(db, { inbox }).fetch,
  port,
  hostname: "127.0.0.1",
});
console.log(`TimeKeeper API: http://127.0.0.1:${port}`);

// docs/API.md D8 step 4: catch up recordings missed while TimeKeeper was closed. It runs after the API listens so a
// slow or stopped Screenpipe never delays /api/health, and only when Screenpipe is configured, so the demo without
// Screenpipe does not record false coverage gaps.
let recordingTimer: NodeJS.Timeout | undefined;
if (process.env.SCREENPIPE_URL || process.env.SCREENPIPE_API_KEY) {
  const config = screenpipeConfigFromEnv();
  const memory = httpScreenpipe(config);
  let running = false;
  const catchUp = async () => {
    if (running) return;
    running = true;
    try {
      const r = await catchUpRecordings(memory, service, config.instanceId, new Date().toISOString());
      if (r.windows || r.stoppedBy) console.log(`TimeKeeper recordings: ${r.windows} windows read, ${r.imported} new, ${r.unchanged} known, ${r.skipped} skipped${r.stoppedBy ? `; stopped: ${r.stoppedBy}` : ""}`);
    } catch (error) {
      console.error("TimeKeeper recording catch-up failed:", error instanceof Error ? error.message : typeof error);
    } finally {
      running = false;
    }
  };
  void catchUp();
  recordingTimer = setInterval(() => void catchUp(), 5 * 60_000);
  recordingTimer.unref();
}
const close = () => { clearInterval(timer); clearInterval(recordingTimer); server.close(() => db.close()); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
