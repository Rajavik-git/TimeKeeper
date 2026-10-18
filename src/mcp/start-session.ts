// CLI fallback for pipes that cannot call MCP tools (docs/API.md D6). Same logic as the start_session tool.
// Usage: bun src/mcp/start-session.ts [--status]
// Exit code 0 only when a session is running (started or already active).
import { depsFromEnv } from './config.js';
import { ensureSession, getStatus } from './session.js';

const deps = depsFromEnv();
if (process.argv.includes('--status')) {
  const status = await getStatus(deps);
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.timekeeper === 'running' ? 0 : 1;
} else {
  const result = await ensureSession(deps);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'started' || result.status === 'already_active' ? 0 : 1;
}
