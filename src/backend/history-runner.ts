import type { HistoryRunner } from "./ports/history.js";
import { mcpHttpConfig } from "../mcp/runtime-config.js";

const PIPE = "generate-work-periods";

/** Dispatch only. Screenpipe owns execution and reports completion through the claim API. */
export function createHistoryRunner(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): HistoryRunner & { stop(): Promise<void> } {
  const base = env.SCREENPIPE_URL || "http://localhost:3030";
  const key = env.SCREENPIPE_API_KEY?.trim();
  let configured = false;
  let mcpUrl = "";
  try {
    mcpUrl = mcpHttpConfig(env).url;
    const url = new URL(base);
    configured = Boolean(
      key &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    );
  } catch {
    /* Report missing configuration through the application. */
  }
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<"started" | "unconfirmed">>();
  let stopped = false;
  return {
    configured,
    dispatch() {
      if (!configured || stopped) return Promise.reject(new Error("not-configured"));
      const controller = new AbortController();
      controllers.add(controller);
      const operation = (async (): Promise<"started" | "unconfirmed"> => {
        // Fail before dispatch when the required workflow tool is not available.
        // This is a read-only capability check; it neither claims a job nor invokes JEV.
        try {
          const capabilities = await fetcher(mcpUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "history-readiness", method: "tools/list" }),
            redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
          });
          const body = (await capabilities.json()) as {
            result?: { tools?: Array<{ name: string }> };
          };
          if (
            !capabilities.ok ||
            !body.result?.tools?.some((tool) => tool.name === "generate_history_proposals")
          )
            throw new Error("runner-unavailable");
        } catch {
          throw new Error("runner-unavailable");
        }
        let response: Response;
        try {
          response = await fetcher(`${base.replace(/\/+$/, "")}/pipes/${PIPE}/run`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: "{}",
            redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          });
        } catch {
          // The request may have reached Screenpipe. Do not automatically dispatch it again.
          return "unconfirmed";
        }
        if (response.status === 401 || response.status === 403)
          throw new Error("authentication-failed");
        if (!response.ok) throw new Error("runner-unavailable");
        let body: { success?: boolean };
        try {
          body = (await response.json()) as { success?: boolean };
        } catch {
          // An unreadable acknowledgement does not prove that dispatch failed.
          return "unconfirmed";
        }
        if (body.success !== true) throw new Error("runner-unavailable");
        return "started";
      })();
      pending.add(operation);
      void operation
        .finally(() => {
          controllers.delete(controller);
          pending.delete(operation);
        })
        .catch(() => {});
      return operation;
    },
    async stop() {
      stopped = true;
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...pending]);
    },
  };
}
