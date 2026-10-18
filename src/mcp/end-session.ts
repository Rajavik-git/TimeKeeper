// CLI fallback for the End TimeKeeper pipe when it cannot call MCP tools. Same logic as end_session.
// Usage: npx tsx src/mcp/end-session.ts   (exit code 0 only when the session ended)
import { depsFromEnv } from "./config.js";
import { endSession } from "./session.js";

const result = await endSession(depsFromEnv());
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "ended" ? 0 : 1;
