// CLI fallback for the End TimeKeeper pipe when it cannot call MCP tools (docs/API.md D6). Same logic as end_session.
// Usage: node --import tsx src/mcp/end-session.ts   (exit code 0 only when the session ended)
import { depsFromEnv } from "./config.js";
import { endSession } from "./workflow.js";

const result = await endSession(depsFromEnv());
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "ended" ? 0 : 1;
