import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<string>;
export const MCP_PACKAGE_DEFAULT = "screenpipe-mcp@0.20.3";
interface RpcResult {
  tools?: { name: string }[];
  content?: { type: string; text?: string }[];
  isError?: boolean;
}
interface Pending {
  resolve: (value: RpcResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Newline-delimited MCP client. Only read-only Screenpipe searches are retried. */
export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private command: string[],
    private env: Record<string, string>,
    private timeoutMs = 30_000,
  ) {}

  async start(): Promise<void> {
    const executable = this.command[0];
    if (!executable) throw new Error("MCP executable is required");
    this.proc = spawn(executable, this.command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
      windowsHide: true,
    });
    this.proc.on("error", () => this.rejectPending("MCP server could not start"));
    this.proc.stderr.resume();
    void this.readLoop(this.proc.stdout);
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "timekeeper-jev-check", version: "0.1.0" },
    });
    this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  private async readLoop(stream: AsyncIterable<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("{")) continue;
          let message: {
            id?: number;
            result?: RpcResult;
            error?: { code: number; message: string };
          };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
          if (!pending || message.id === undefined) continue;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(`MCP error ${message.error.code}`));
          else pending.resolve(message.result ?? {});
        }
      }
    } finally {
      this.rejectPending("MCP server exited");
    }
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private write(message: object) {
    if (!this.proc?.stdin.writable) throw new Error("MCP server not started");
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }

  private request(method: string, params: object): Promise<RpcResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async listTools(): Promise<string[]> {
    return (await this.request("tools/list", {})).tools?.map((tool) => tool.name) ?? [];
  }

  callTool: ToolCaller = async (name, args) => {
    for (let attempt = 0; ; attempt++) {
      const result = await this.request("tools/call", { name, arguments: args });
      const text =
        result.content
          ?.filter((content) => content.type === "text")
          .map((content) => content.text ?? "")
          .join("\n") ?? "";
      if (!result.isError) return text;
      if (name === "search-content" && attempt < 2 && /busy|retry shortly|503/i.test(text)) {
        await sleep(1000);
        continue;
      }
      throw new Error(`MCP tool ${name} failed`);
    }
  };

  async callToolJson<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; value: T }> {
    const result = await this.request("tools/call", { name, arguments: args });
    const text =
      result.content
        ?.filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("\n") ?? "";
    return { isError: Boolean(result.isError), value: JSON.parse(text) as T };
  }

  async close() {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = null;
    this.rejectPending("MCP client closed");
  }
}
