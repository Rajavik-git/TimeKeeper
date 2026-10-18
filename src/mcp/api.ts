// HTTP access to the TimeKeeper application API. MCP tools never read SQLite or app files.
import type { components } from "../contracts/generated.js";

type Schemas = components["schemas"];
export type Session = Schemas["Session"];
export type WorkPeriod = Schemas["WorkPeriod"];
export type PendingQuestion = Schemas["PendingQuestion"];
export type Catalog = Schemas["Catalog"];

export interface ApiDeps {
  /** API origin, for example http://127.0.0.1:8787 (routes are under /api). */
  apiOrigin: string;
  fetch: typeof fetch;
  now: () => Date;
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
}

/** The API did not answer: TimeKeeper is closed, starting, or the request timed out. */
export class Unreachable extends Error {}

/** The API answered with an error status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function call(deps: ApiDeps, path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? 5000);
  try {
    return await deps.fetch(`${deps.apiOrigin}${path}`, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function failure(response: Response, label: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  return new ApiError(
    response.status,
    typeof body?.error === "string" ? body.error : `http-${response.status}`,
    typeof body?.message === "string" ? body.message : `${label} returned ${response.status}`,
  );
}

export async function getJson<T>(deps: ApiDeps, path: string): Promise<T> {
  const response = await call(deps, path);
  if (!response.ok) throw await failure(response, `GET ${path}`);
  return (await response.json()) as T;
}

/** Posts JSON; returns the HTTP status with the parsed body so callers can treat 202 explicitly. */
export async function postJson<T>(
  deps: ApiDeps,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const response = await call(deps, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response, `POST ${path}`);
  return { status: response.status, body: (await response.json()) as T };
}

/** True when TimeKeeper's API answers its public readiness route. */
export async function healthy(deps: ApiDeps): Promise<boolean> {
  try {
    const response = await call(deps, "/health");
    return response.ok && ((await response.json()) as { status?: string }).status === "ok";
  } catch (error) {
    if (error instanceof Unreachable) return false;
    throw error;
  }
}

export const activeSession = (deps: ApiDeps) =>
  getJson<Session | null>(deps, "/api/sessions/active");

/** The open period of a session, if any. */
export async function openPeriod(deps: ApiDeps, sessionId: string): Promise<WorkPeriod | null> {
  const periods = await getJson<WorkPeriod[]>(deps, "/api/work-periods");
  return (
    periods
      .filter((period) => period.sessionId === sessionId && period.endedAt === null)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null
  );
}

/** Tool results never throw: they report the failure kind. */
export type Failure =
  | { status: "timekeeper_not_running"; message: string }
  | { status: "error"; error: string; message: string };

export function toFailure(error: unknown): Failure {
  if (error instanceof Unreachable)
    return { status: "timekeeper_not_running", message: "TimeKeeper is not running." };
  if (error instanceof ApiError)
    return { status: "error", error: error.code, message: error.message };
  return {
    status: "error",
    error: "unexpected",
    message: error instanceof Error ? error.message : String(error),
  };
}
