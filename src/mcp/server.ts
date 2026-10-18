// TimeKeeper MCP server: JSON-RPC 2.0 over stdio (newline-delimited) or loopback HTTP, no SDK dependency.
// Run: npx tsx src/mcp/server.ts [--http [port] [--screenpipe-link]]   (also runs with Screenpipe's bun)
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { depsFromEnv, linkFromEnv, linkStatePath } from "./config.js";
import { runScreenpipeLink } from "./screenpipe-link.js";
import { callTool, TOOLS, type ToolContext } from "./tools.js";

const PROTOCOL_VERSION = "2024-11-05";
const MAX_BODY_BYTES = 1_000_000;

type RpcId = number | string | null;

export interface Rpc {
  jsonrpc: "2.0";
  id?: RpcId;
  method: string;
  params?: { name?: unknown; arguments?: unknown };
}

const rpcError = (id: RpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const asText = (value: unknown, isError: boolean) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  isError,
});

function isRpc(value: unknown): value is Rpc {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  const id = message.id;
  return (
    message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    (id === undefined || id === null || typeof id === "string" || typeof id === "number")
  );
}

async function dispatch(message: Rpc, context: ToolContext): Promise<object | null> {
  if (message.id === undefined) return null;
  const id = message.id;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "timekeeper", version: "0.1.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const args = message.params?.arguments;
      const result = await callTool(
        message.params?.name,
        args && typeof args === "object" ? (args as Record<string, unknown>) : {},
        context,
      );
      return result
        ? reply(asText(result.value, result.isError))
        : rpcError(id, -32602, `Unknown tool: ${String(message.params?.name)}`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

/** Returns the response to send, or null for notifications. Never throws. */
export async function handle(message: unknown, context: ToolContext): Promise<object | null> {
  if (!isRpc(message)) return rpcError(null, -32600, "Invalid Request");
  try {
    return await dispatch(message, context);
  } catch (error) {
    return message.id === undefined
      ? null
      : rpcError(message.id, -32603, error instanceof Error ? error.message : "Internal error");
  }
}

/** Handles a parsed body: one message or a non-empty batch. */
async function handleBody(body: unknown, context: ToolContext): Promise<object | object[] | null> {
  if (!Array.isArray(body)) return handle(body, context);
  if (body.length === 0) return rpcError(null, -32600, "Invalid Request");
  const responses = (await Promise.all(body.map((m) => handle(m, context)))).filter(
    (response): response is object => response !== null,
  );
  return responses.length ? responses : null;
}

const defaultContext = (): ToolContext => ({
  deps: depsFromEnv(),
  linkStatePath: linkStatePath(),
});

export function serveStdio(context: ToolContext = defaultContext()): void {
  const write = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let body: unknown;
    try {
      body = JSON.parse(line);
    } catch {
      write(rpcError(null, -32700, "Parse error"));
      return;
    }
    void handleBody(body, context).then((response) => {
      if (response) write(response);
    });
  });
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison of the presented bearer token with the configured one. */
function authorized(header: string | undefined, token: string): boolean {
  const presented = /^Bearer (.+)$/.exec(header ?? "")?.[1];
  return presented !== undefined && timingSafeEqual(digest(presented), digest(token));
}

const loopbackOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Streamable HTTP transport with stateless JSON responses for Screenpipe's custom MCP connection.
 * Bound to loopback, and every request needs `Authorization: Bearer <TIMEKEEPER_MCP_TOKEN>`.
 */
export function serveHttp(
  port: number,
  token: string,
  context: ToolContext = defaultContext(),
): Server {
  if (!token) throw new Error("TIMEKEEPER_MCP_TOKEN is required for the HTTP transport");
  const server = createServer(async (request, response) => {
    const send = (status: number, body?: unknown) => {
      response.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // Browsers attach an Origin: only local pages may call, and only with the token.
    const origin = request.headers.origin;
    if (origin && !loopbackOrigin.test(origin)) return send(403, { error: "forbidden-origin" });
    if (!authorized(request.headers.authorization, token))
      return send(401, { error: "unauthorized" });
    if (request.url?.split("?")[0] !== "/mcp") return send(404, { error: "not-found" });
    if (request.method !== "POST") return send(405, { error: "method-not-allowed" });
    const chunks: Buffer[] = [];
    let size = 0;
    // An oversized body is drained, not kept, so the client receives the 413 instead of a reset.
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.byteLength;
      if (size <= MAX_BODY_BYTES) chunks.push(buffer);
    }
    if (size > MAX_BODY_BYTES) return send(413, { error: "too-large" });
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(400, rpcError(null, -32700, "Parse error"));
    }
    const result = await handleBody(body, context);
    if (result === null) return send(202);
    send(200, result);
  });
  server.on("error", (error) => console.error(`TimeKeeper MCP server error: ${error.message}`));
  server.listen(port, "127.0.0.1");
  return server;
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry && /\/src\/mcp\/server\.(ts|js)$/.test(entry)) {
  const httpFlag = process.argv.indexOf("--http");
  if (httpFlag < 0) serveStdio();
  else {
    const token = process.env.TIMEKEEPER_MCP_TOKEN ?? "";
    if (!token) {
      console.error(
        "Set TIMEKEEPER_MCP_TOKEN to serve MCP over HTTP (see integrations/screenpipe/README.md).",
      );
      process.exit(1);
    }
    const port =
      Number(process.argv[httpFlag + 1]) || Number(process.env.TIMEKEEPER_MCP_PORT) || 3032;
    serveHttp(port, token);
    console.error(`TimeKeeper MCP (HTTP): http://127.0.0.1:${port}/mcp`);
    // Only the long-running HTTP server hosts the session link; a stdio server lives per chat.
    if (process.argv.includes("--screenpipe-link")) {
      const { deps, statePath } = linkFromEnv();
      runScreenpipeLink(deps, statePath);
      console.error(`Screenpipe session link running (state: ${statePath})`);
    }
  }
}
