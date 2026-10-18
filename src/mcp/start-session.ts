// CLI fallback for the Start TimeKeeper pipe when it cannot call MCP tools. Same logic as start_session.
// Usage: npx tsx src/mcp/start-session.ts [--status]   (exit code 0 only when a session is running)
import { depsFromEnv } from "./config.js";
import { getStatus, startSession } from "./session.js";

const deps = depsFromEnv();
if (process.argv.includes("--status")) {
  const status = await getStatus(deps);
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.timekeeper === "running" ? 0 : 1;
} else {
  const result = await startSession(deps);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "started" || result.status === "already_active" ? 0 : 1;
}
