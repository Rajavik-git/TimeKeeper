import { afterEach, beforeEach, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { handle, serveHttp } from "../../src/mcp/server.js";
import type { ToolContext } from "../../src/mcp/tools.js";

const token = "test-token-0123456789";
const closed = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

/** Tools that never reach a TimeKeeper API: transport behaviour only. */
const context = (now: () => Date = () => new Date()): ToolContext => ({
  deps: {
    apiOrigin: "http://127.0.0.1:1",
    fetch: closed,
    now,
    newId: () => "id",
    sleep: async () => undefined,
  },
  linkStatePath: "missing-link-state.json",
});

let server: Server;
let url: string;
beforeEach(async () => {
  server = serveHttp(0, token, context());
  await new Promise((done) => server.once("listening", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterEach(async () => {
  await new Promise((done) => server.close(done));
});

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body,
  });

it("rejects invalid messages and contains handler failures", async () => {
  for (const message of [
    null,
    5,
    "x",
    { jsonrpc: "1.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 1 },
  ])
    expect(await handle(message, context())).toMatchObject({ error: { code: -32600 } });
  const failing = context(() => {
    throw new Error("clock failed");
  });
  expect(
    await handle(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "screenpipe_link_status" } },
      failing,
    ),
  ).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32603, message: "clock failed" } });
});

it("requires the bearer token", async () => {
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  expect((await post(ping, { authorization: "" })).status).toBe(401);
  expect((await post(ping, { authorization: "Bearer wrong-token" })).status).toBe(401);
  expect((await post(ping, { authorization: token })).status).toBe(401);
  const listed = await post(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(8);
});

it("allows local pages only, and still requires the token for them", async () => {
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  expect((await post(ping, { origin: "http://localhost:9999" })).status).toBe(200);
  expect((await post(ping, { origin: "http://localhost:9999", authorization: "" })).status).toBe(
    401,
  );
  expect((await post(ping, { origin: "https://example.com" })).status).toBe(403);
});

it("answers null, invalid and empty batch bodies with JSON-RPC errors", async () => {
  const body = async (raw: string) => {
    const response = await post(raw);
    return { status: response.status, json: (await response.json()) as unknown };
  };
  expect(await body("null")).toMatchObject({ status: 200, json: { error: { code: -32600 } } });
  expect(await body("[null]")).toMatchObject({
    status: 200,
    json: [{ error: { code: -32600 } }],
  });
  expect(await body("[]")).toMatchObject({ status: 200, json: { error: { code: -32600 } } });
  expect(await body("{")).toMatchObject({ status: 400, json: { error: { code: -32700 } } });
  const notification = await post(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  expect(notification.status).toBe(202);
});

it("refuses bodies over 1 MB", async () => {
  const response = await post(`"${"x".repeat(1_000_001)}"`);
  expect(response.status).toBe(413);
});

it("does not serve HTTP without a token", () => {
  expect(() => serveHttp(0, "", context())).toThrow(/TIMEKEEPER_MCP_TOKEN/);
});
