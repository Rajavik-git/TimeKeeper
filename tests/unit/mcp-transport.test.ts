import { Server } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ApiUnreachable, getApiJson, postApiJson } from "../../src/mcp/api-client.js";
import { serveHttp } from "../../src/mcp/server.js";
import type { SessionDeps } from "../../src/mcp/session.js";

function deps(fetch: typeof globalThis.fetch): SessionDeps {
  return {
    apiBase: "http://timekeeper.invalid/api",
    fetch,
    requestTimeoutMs: 20,
    now: () => new Date(),
    newId: () => "test",
    sleep: async () => {},
  };
}

describe("MCP API transport deadlines", () => {
  it.each(["GET", "POST"])("bounds a stalled %s response body after headers", async (method) => {
    let requestSignal: AbortSignal | null | undefined;
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const dependencies = deps((async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(stream);
    }) as typeof fetch);
    try {
      const request =
        method === "GET"
          ? getApiJson(dependencies, "/test")
          : postApiJson(dependencies, "/test", { commandId: "same-command" });
      await expect(request).rejects.toBeInstanceOf(ApiUnreachable);
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      streamController.error(new Error("test cleanup"));
    }
  });

  it("preserves response status, headers and body for callers", async () => {
    const response = await postApiJson(
      deps(
        (async () =>
          new Response('{"error":"conflict"}', {
            status: 409,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
      ),
      "/test",
      {},
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: "conflict" });
  });
});

function request() {
  return Object.assign(new PassThrough(), {
    headers: {},
    url: "/mcp",
    method: "POST",
    aborted: false,
  });
}

function response() {
  let complete!: (value: { status: number; body: string }) => void;
  const finished = new Promise<{ status: number; body: string }>((resolve) => {
    complete = resolve;
  });
  const res = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    status: 0,
    writeHead(status: number) {
      this.status = status;
      this.headersSent = true;
    },
    end(body = "") {
      this.writableEnded = true;
      complete({ status: this.status, body });
    },
    destroy() {
      this.destroyed = true;
    },
  };
  return { res, finished };
}

describe("MCP HTTP request boundary", () => {
  it("contains an aborted upload and continues serving subsequent requests", async () => {
    const listen = vi.spyOn(Server.prototype, "listen").mockImplementation(function () {
      return this;
    });
    const server = serveHttp(0, deps(vi.fn()));
    listen.mockRestore();
    try {
      const interrupted = request();
      server.emit("request", interrupted, response().res);
      interrupted.write('{"jsonrpc":');
      interrupted.aborted = true;
      interrupted.destroy(new Error("sensitive upload failure"));
      await new Promise<void>((resolve) => setImmediate(resolve));

      const next = request();
      const output = response();
      server.emit("request", next, output.res);
      next.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
      expect(await output.finished).toEqual({
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      });
    } finally {
      server.close();
    }
  });

  it("returns a sanitized response for an unexpected request failure", async () => {
    const listen = vi.spyOn(Server.prototype, "listen").mockImplementation(function () {
      return this;
    });
    const server = serveHttp(0, deps(vi.fn()));
    listen.mockRestore();
    try {
      const input = request();
      const output = response();
      server.emit("request", input, output.res);
      input.destroy(new Error("sensitive upload failure"));
      expect(await output.finished).toEqual({ status: 500, body: '{"error":"internal-error"}' });
    } finally {
      server.close();
    }
  });
});
