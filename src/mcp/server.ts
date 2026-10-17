// TimeKeeper MCP server (stdio, newline-delimited JSON-RPC 2.0), dependency-free.
// Run: bun src/mcp/server.ts [--http [port]]   or   npx tsx src/mcp/server.ts [--http [port]]
import { createServer, type Server } from 'node:http';
import { createInterface } from 'node:readline';
import { depsFromEnv } from './config.js';
import { ensureSession, getStatus, type SessionDeps } from './session.js';

const PROTOCOL_VERSION = '2024-11-05';

export const TOOLS = [
  {
    name: 'timekeeper_status',
    description: 'Read-only. Reports whether the TimeKeeper API is running and returns the active session, or null.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'start_session',
    description:
      'Start TimeKeeper button. If a TimeKeeper session is already active, does nothing and returns it. ' +
      'Otherwise starts a new session (launching TimeKeeper first when a launch command is configured). ' +
      'Only call this when the lawyer explicitly asks to start TimeKeeper. Result status: ' +
      'started | already_active | timekeeper_not_running | pending | unconfirmed | error. Only "started" and "already_active" mean a session is running.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
] as const;

type Rpc = { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> };

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError });

/** Returns the response to send, or null for notifications. */
export async function handle(msg: Rpc, deps: SessionDeps): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'timekeeper', version: '0.1.0' } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      if (name === 'timekeeper_status') {
        try { return reply(text(await getStatus(deps))); }
        catch (error) { return reply(text({ error: error instanceof Error ? error.message : String(error) }, true)); }
      }
      if (name === 'start_session') {
        const result = await ensureSession(deps);
        return reply(text(result, !['started', 'already_active'].includes(result.status)));
      }
      return fail(-32602, `Unknown tool: ${String(name)}`);
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export function serve(deps: SessionDeps = depsFromEnv()): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async line => {
    if (!line.trim()) return;
    let msg: Rpc;
    try { msg = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
    const response = await handle(msg, deps);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
}

/** Streamable HTTP transport, stateless JSON responses, loopback only (for Screenpipe custom MCP connections). */
export function serveHttp(port: number, deps: SessionDeps = depsFromEnv()): Server {
  const server = createServer(async (req, res) => {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(403, { error: 'forbidden-origin' });
    if (req.url?.split('?')[0] !== '/mcp') return send(404, { error: 'not-found' });
    if (req.method !== 'POST') return send(405, { error: 'method-not-allowed' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) return send(413, { error: 'too-large' }); }
    let body: Rpc | Rpc[];
    try { body = JSON.parse(raw); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const responses = (await Promise.all((Array.isArray(body) ? body : [body]).map(m => handle(m, deps)))).filter(Boolean);
    if (responses.length === 0) return send(202);
    send(200, Array.isArray(body) ? responses : responses[0]);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && /\/src\/mcp\/server\.(ts|js)$/.test(entry)) {
  const i = process.argv.indexOf('--http');
  if (i >= 0) {
    const port = Number(process.argv[i + 1]) || Number(process.env.TIMEKEEPER_MCP_PORT) || 3032;
    serveHttp(port);
    console.error(`TimeKeeper MCP (HTTP): http://127.0.0.1:${port}/mcp`);
  } else {
    serve();
  }
}
