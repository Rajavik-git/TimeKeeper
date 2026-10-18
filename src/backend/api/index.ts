import { serve } from "@hono/node-server";
import { openDb } from "../adapters/sqlite/repository.js";
import { createApplicationServices } from "../bootstrap.js";
import { folderInbox, inboxDir } from "../adapters/inbox/folder.js";
import { syncInbox } from "../workers/inbox-sync.js";
import { createScreenpipeIntegration } from "../screenpipe-integration.js";
import { createHttpApp } from "./app.js";
import { createHistoryRunner } from "../history-runner.js";

const db = openDb();
const port = Number(process.env.TIMEKEEPER_PORT ?? 8787);
const historyRunner = createHistoryRunner();
const services = createApplicationServices(db, undefined, historyRunner);
const { core: service } = services;
const screenpipe = createScreenpipeIntegration(services, db);
const inbox = folderInbox(inboxDir());
const synchronize = () => {
  try {
    const result = syncInbox(inbox, service);
    if (Object.values(result).some((files) => files.length))
      console.log(
        `TimeKeeper inbox: ${result.applied.length} applied, ${result.pending.length} pending, ${result.failed.length} failed, ${result.retry.length} to retry`,
      );
  } catch {
    console.error("TimeKeeper inbox synchronization failed; commands will retry.");
  }
};
// Local commands apply before readiness. Unavailable Screenpipe reads never delay API readiness.
synchronize();
const inboxTimer = setInterval(synchronize, 30_000);
inboxTimer.unref();
const server = serve(
  { fetch: createHttpApp(services, { inbox, screenpipe }).fetch, port, hostname: "127.0.0.1" },
  () => console.log(`TimeKeeper API: http://127.0.0.1:${port}`),
);

let closing = false;
screenpipe.start();

const close = () => {
  if (closing) return;
  closing = true;
  clearInterval(inboxTimer);
  const stopped = Promise.allSettled([screenpipe.stop(), historyRunner.stop()]);
  server.close(() => {
    void stopped.finally(() => db.close());
  });
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
// Preserve the newer desktop host's orphan cleanup without changing the stored session boundary.
const parentPid = Number(process.env.TIMEKEEPER_PARENT_PID);
if (Number.isSafeInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      close();
    }
  }, 2000).unref();
}
