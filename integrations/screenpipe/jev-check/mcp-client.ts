// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0), no dependencies.
// Launches the Screenpipe MCP server and calls its tools.

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<string>;

export const MCP_PACKAGE_DEFAULT = "screenpipe-mcp@0.20.3";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class McpStdioClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private command: string[],
    private env: Record<string, string>,
    private timeoutMs = 30_000,
  ) {}

  async start(): Promise<void> {
    this.proc = Bun.spawn(this.command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, ...this.env },
      // When the watcher runs in the background without a console, Windows would open a visible one for this child.
      windowsHide: true,
    } as Parameters<typeof Bun.spawn>[1]);
    this.readLoop(this.proc.stdout as ReadableStream<Uint8Array>);
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "timekeeper-jev-check", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  private async readLoop(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`)) : p.resolve(msg.result);
      }
    }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("MCP server exited")); }
    this.pending.clear();
  }

  private write(msg: object) {
    const stdin = this.proc?.stdin as any;
    if (!stdin) throw new Error("MCP server not started");
    stdin.write(JSON.stringify(msg) + "\n");
    stdin.flush?.();
  }

  private notify(method: string, params: object) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: object): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools(): Promise<string[]> {
    const r = await this.request("tools/list", {});
    return (r?.tools ?? []).map((t: any) => t.name);
  }

  /** Calls a tool and returns its concatenated text content. Retries briefly when Screenpipe search is busy. */
  callTool: ToolCaller = async (name, args) => {
    for (let attempt = 0; ; attempt++) {
      const r = await this.request("tools/call", { name, arguments: args });
      const text = (r?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      if (!r?.isError) return text;
      if (attempt < 2 && /busy|retry shortly|503/i.test(text)) {
        await Bun.sleep(1000);
        continue;
      }
      throw new Error(`MCP tool ${name} failed: ${text.slice(0, 200)}`);
    }
  };

  /** Calls a tool whose text content is JSON; returns it with the tool's error flag instead of throwing on isError. */
  async callToolJson<T = any>(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; value: T }> {
    const r = await this.request("tools/call", { name, arguments: args });
    const text = (r?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return { isError: Boolean(r?.isError), value: JSON.parse(text) as T };
  }

  async close() {
    try { (this.proc?.stdin as any)?.end?.(); } catch {}
    this.proc?.kill();
    this.proc = null;
  }
}
