import { existsSync, readFileSync } from "node:fs";
import type {
  FrameImage,
  ScreenpipeFrame,
  ScreenpipeReader,
  WindowFocus,
} from "../../ports/index.js";

/** Screenpipe refused the request (401/403): the key is missing or wrong. */
export class ScreenpipeAuthError extends Error {
  constructor() {
    super("Screenpipe refused the request: check SCREENPIPE_API_KEY");
  }
}
/** Screenpipe did not answer, timed out, or failed. The caller may retry later. */
export class ScreenpipeUnavailableError extends Error {}

export interface ScreenpipeConfig {
  baseUrl: string;
  /** Sent as a bearer token. Without it requests are attempted unauthenticated. */
  apiKey?: string;
  fetch: typeof fetch;
  /** Focus reads poll every 2 s and must answer quickly. */
  focusTimeoutMs?: number;
}

/** Screenpipe's local API origin: `SCREENPIPE_URL`, the setup's `SCREENPIPE_API_URL`, or the default. */
export function screenpipeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SCREENPIPE_URL || env.SCREENPIPE_API_URL || "http://127.0.0.1:3030").replace(
    /\/+$/,
    "",
  );
}

/** `SCREENPIPE_API_KEY`, else the trimmed content of `SCREENPIPE_API_KEY_FILE` when it exists. */
function screenpipeApiKey(env: NodeJS.ProcessEnv): string | undefined {
  if (env.SCREENPIPE_API_KEY) return env.SCREENPIPE_API_KEY;
  const file = env.SCREENPIPE_API_KEY_FILE;
  if (!file || !existsSync(file)) return undefined;
  return readFileSync(file, "utf8").trim() || undefined;
}

export function screenpipeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ScreenpipeConfig {
  const apiKey = screenpipeApiKey(env);
  return {
    baseUrl: screenpipeBaseUrl(env),
    ...(apiKey ? { apiKey } : {}),
    fetch: globalThis.fetch,
  };
}

type SearchItem = { type?: string; content?: Record<string, unknown> };

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** Input events that mean a window gained focus; clicks and keys are ignored. */
const focusEvents = new Set(["window_focus", "app_switch"]);

/** Window metadata of one search item. Screen text and typed input are deliberately never read. */
function focusOf(item: SearchItem): WindowFocus | null {
  const c = item.content ?? {};
  if (c.focused === false) return null;
  if (item.type === "Input" && !focusEvents.has(String(c.event_type))) return null;
  const appName = text(c.app_name);
  // Captures name the window `window_name`; input events name it `window_title`.
  const windowTitle = text(c.window_name) ?? text(c.window_title);
  const at = Date.parse(String(c.timestamp ?? ""));
  if (!appName || !windowTitle || !Number.isFinite(at)) return null;
  return {
    appName,
    windowTitle,
    url: text(c.browser_url) ?? null,
    recordedAt: new Date(at).toISOString(),
  };
}

/** Window metadata of one OCR frame. Screen text is deliberately never read. */
function frameOf(item: SearchItem): ScreenpipeFrame | null {
  const c = item.content ?? {};
  const id = c.frame_id;
  const appName = text(c.app_name);
  const windowTitle = text(c.window_name);
  const at = Date.parse(String(c.timestamp ?? ""));
  if ((typeof id !== "number" && typeof id !== "string") || !appName || !windowTitle) return null;
  if (!Number.isFinite(at)) return null;
  return { frameId: String(id), recordedAt: new Date(at).toISOString(), appName, windowTitle };
}

/** Screenpipe caps each search page at 20 results. */
const pageSize = 20;
/** A busy search is retried at most this many times, waiting at most `maxBusyWaitMs` each. */
const busyRetries = 2;
const maxBusyWaitMs = 1_000;

/** The wait Screenpipe asks for in a 503 "search is busy" reply, or null for any other 503. */
async function busyRetryMs(response: Response): Promise<number | null> {
  try {
    const body = (await response.clone().json()) as { error?: unknown; retry_after_ms?: unknown };
    if (typeof body.error !== "string" || !body.error.includes("busy")) return null;
    const wait = typeof body.retry_after_ms === "number" ? body.retry_after_ms : maxBusyWaitMs;
    return Math.min(Math.max(wait, 0), maxBusyWaitMs);
  } catch {
    return null;
  }
}

/** Read-only HTTP adapter for Screenpipe's local API. Searches stay local (`include_cloud=false`). */
export function httpScreenpipe(config: ScreenpipeConfig): ScreenpipeReader {
  const focusTimeoutMs = config.focusTimeoutMs ?? 2_000;

  /**
   * Authenticated GET. Refusals and failures become typed errors; 404 is left to the caller.
   * Screenpipe answers 503 "search is busy" to concurrent searches, so that reply is retried.
   */
  async function get(path: string, timeoutMs: number): Promise<Response> {
    const headers: Record<string, string> = { "X-Screenpipe-Client": "api" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await config.fetch(`${config.baseUrl}${path}`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch {
        throw new ScreenpipeUnavailableError(`Screenpipe is not reachable at ${config.baseUrl}`);
      }
      const retryMs = response.status === 503 ? await busyRetryMs(response) : null;
      if (retryMs === null || attempt >= busyRetries) break;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
    if (response.status === 401 || response.status === 403) throw new ScreenpipeAuthError();
    if (!response.ok && response.status !== 404)
      throw new ScreenpipeUnavailableError(`Screenpipe returned ${response.status}`);
    return response;
  }

  async function search(
    contentType: string,
    startAt: string,
    endAt: string,
    timeoutMs: number,
    offset = 0,
  ): Promise<SearchItem[]> {
    const query = new URLSearchParams({
      content_type: contentType,
      start_time: startAt,
      end_time: endAt,
      limit: String(pageSize),
      offset: String(offset),
      include_cloud: "false",
    });
    const response = await get(`/search?${query}`, timeoutMs);
    if (!response.ok)
      throw new ScreenpipeUnavailableError(`Screenpipe search returned ${response.status}`);
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body.data))
      throw new ScreenpipeUnavailableError("Screenpipe search returned an unexpected response");
    return body.data as SearchItem[];
  }

  return {
    async latestFocus(withinMs) {
      const endAt = new Date().toISOString();
      const startAt = new Date(Date.now() - withinMs).toISOString();
      // Focus events arrive as soon as the window changes; captures confirm it afterwards.
      // Accessibility follows the focused window; OCR covers apps without accessibility text.
      // Sequential on purpose: Screenpipe rejects concurrent searches as busy.
      let latest: WindowFocus | null = null;
      for (const type of ["input", "accessibility", "ocr"]) {
        for (const item of await search(type, startAt, endAt, focusTimeoutMs)) {
          const focus = focusOf(item);
          if (focus && (!latest || focus.recordedAt > latest.recordedAt)) latest = focus;
        }
      }
      return latest;
    },
    async frames(startAt, endAt, limit) {
      const found = new Map<string, ScreenpipeFrame>();
      // Screenpipe returns newest first; page until enough frames or an empty page.
      for (let offset = 0; found.size < limit; offset += pageSize) {
        const page = await search("ocr", startAt, endAt, 5_000, offset);
        for (const item of page) {
          const frame = frameOf(item);
          if (frame && found.size < limit) found.set(frame.frameId, frame);
        }
        if (page.length < pageSize) break;
      }
      return [...found.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    },
    async frameImage(frameId): Promise<FrameImage | null> {
      const response = await get(`/frames/${encodeURIComponent(frameId)}`, 10_000);
      if (response.status === 404) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/"))
        throw new ScreenpipeUnavailableError("Screenpipe returned a frame that is not an image");
      return { contentType, body: await response.arrayBuffer() };
    },
  };
}
