import type { SessionDeps, SessionInfo } from "./session.js";

export class ApiUnreachable extends Error {}

/** Shared API transport for MCP use cases. */
export async function callApi(
  deps: SessionDeps,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiUnreachable("TimeKeeper API request timed out"));
    }, deps.requestTimeoutMs ?? 5000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const response = await deps.fetch(`${deps.apiBase}${path}`, {
          ...init,
          signal: controller.signal,
          redirect: "error",
        });
        // Buffer the API response within the deadline. Callers keep the Response API,
        // and JSON parsing cannot wait indefinitely after headers have arrived.
        const body = response.body === null ? null : await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })(),
    ]);
  } catch (error) {
    throw new ApiUnreachable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function getApiJson<T>(deps: SessionDeps, path: string): Promise<T> {
  const response = await callApi(deps, path);
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return (await response.json()) as T;
}

export const postApiJson = (deps: SessionDeps, path: string, body: unknown) =>
  callApi(deps, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function decodeSession(value: unknown): SessionInfo | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.startedAt !== "string") return null;
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: typeof session.endedAt === "string" ? session.endedAt : null,
  };
}

export async function readActiveSession(deps: SessionDeps): Promise<SessionInfo | null> {
  const session = decodeSession(await getApiJson(deps, "/sessions/active"));
  return session?.endedAt === null ? session : null;
}
