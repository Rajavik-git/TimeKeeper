import type { MemoryObservation, ScreenpipeMemory } from '../../ports/index.js';

/** Screenpipe refused the token (401/403). Retrying with the same token cannot succeed (docs/API.md D5). */
export class ScreenpipeAuthError extends Error {
  constructor() { super('Screenpipe authentication failed: check SCREENPIPE_API_KEY'); }
}
/** Screenpipe did not answer, timed out, or failed. The caller may retry later. */
export class ScreenpipeUnavailableError extends Error {}

export interface ScreenpipeConfig {
  baseUrl: string;
  apiKey?: string;
  /** First part of every source identity (instanceId + contentType + externalId). */
  instanceId: string;
  fetch: typeof fetch;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export interface ScreenpipeClient extends ScreenpipeMemory {
  /** `GET /health`, which needs no token: Screenpipe is running. It does not prove the token works. */
  health(): Promise<boolean>;
  /** One small authenticated read: throws ScreenpipeAuthError when the token is refused. */
  verifyAccess(): Promise<void>;
}

/** Reads `SCREENPIPE_URL`, `SCREENPIPE_API_KEY`, and `SCREENPIPE_INSTANCE_ID` (docs/API.md D5). */
export function screenpipeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ScreenpipeConfig {
  return {
    baseUrl: (env.SCREENPIPE_URL || 'http://localhost:3030').replace(/\/+$/, ''),
    ...(env.SCREENPIPE_API_KEY ? { apiKey: env.SCREENPIPE_API_KEY } : {}),
    instanceId: env.SCREENPIPE_INSTANCE_ID || 'local',
    fetch: globalThis.fetch,
  };
}

type SearchItem = { type: string; content: Record<string, unknown> };
type SearchPage = { data: SearchItem[]; pagination: { limit: number; offset: number; total: number } };

/** Evidence kinds read for work periods; `accessibility` results come back with `type: "UI"`. */
const CONTENT_TYPES = ['accessibility', 'ocr', 'audio'] as const;

const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Converts one search item to a reference. Screen text and transcriptions are deliberately not kept. */
function observation(item: SearchItem, instanceId: string): MemoryObservation | null {
  const c = item.content ?? {};
  const kind = item.type === 'UI' ? 'accessibility' : item.type === 'OCR' ? 'ocr' : item.type === 'Audio' ? 'audio' : null;
  const id = kind === 'accessibility' ? c.id : kind === 'ocr' ? c.frame_id : kind === 'audio' ? c.chunk_id : undefined;
  const at = Date.parse(String(c.timestamp ?? ''));
  if (!kind || (typeof id !== 'number' && typeof id !== 'string') || !Number.isFinite(at)) return null;
  const appName = text(c.app_name), windowName = text(c.window_name), url = text(c.browser_url);
  return {
    instanceId, contentType: kind, externalId: String(id), recordedAt: new Date(at).toISOString(),
    ...(appName ? { appName } : {}), ...(windowName ? { windowName } : {}), ...(url ? { url } : {}),
  };
}

/** HTTP adapter for Screenpipe's local API, following docs/API.md D5 and docs/SCREENPIPE_INTEGRATION.md. */
export function httpScreenpipe(config: ScreenpipeConfig): ScreenpipeClient {
  const pageSize = config.pageSize ?? 100, maxPages = config.maxPages ?? 50, timeoutMs = config.timeoutMs ?? 10_000;

  async function get(path: string, authenticated: boolean): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'X-Screenpipe-Client': 'api' };
      if (authenticated && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      return await config.fetch(`${config.baseUrl}${path}`, { headers, signal: controller.signal, redirect: 'error' });
    } catch (error) {
      throw new ScreenpipeUnavailableError(`Screenpipe is not reachable at ${config.baseUrl}${error instanceof Error && error.name === 'AbortError' ? ' (timeout)' : ''}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function search(contentType: string, startAt: string, endAt: string, offset: number, limit: number): Promise<SearchPage> {
    const query = new URLSearchParams({
      content_type: contentType, start_time: startAt, end_time: endAt,
      limit: String(limit), offset: String(offset), include_cloud: 'false',
    });
    const response = await get(`/search?${query}`, true);
    if (response.status === 401 || response.status === 403) throw new ScreenpipeAuthError();
    if (!response.ok) throw new ScreenpipeUnavailableError(`Screenpipe search returned ${response.status}`);
    const body = await response.json() as Partial<SearchPage>;
    if (!Array.isArray(body.data)) throw new ScreenpipeUnavailableError('Screenpipe search returned an unexpected response');
    return { data: body.data, pagination: body.pagination ?? { limit, offset, total: offset + body.data.length } };
  }

  return {
    async read(startAt, endAt) {
      const found = new Map<string, MemoryObservation>();
      for (const contentType of CONTENT_TYPES) {
        let offset = 0;
        for (let page = 0; page < maxPages; page++) {
          const result = await search(contentType, startAt, endAt, offset, pageSize);
          for (const item of result.data) {
            const o = observation(item, config.instanceId);
            if (o) found.set(`${o.contentType}:${o.externalId}`, o);
          }
          offset += result.data.length;
          if (result.data.length === 0 || offset >= result.pagination.total) break;
        }
      }
      return [...found.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) ||
        `${a.contentType}:${a.externalId}`.localeCompare(`${b.contentType}:${b.externalId}`));
    },
    async health() {
      try { return (await get('/health', false)).ok; } catch { return false; }
    },
    async verifyAccess() {
      await search('ocr', new Date(Date.now() - 60_000).toISOString(), new Date().toISOString(), 0, 1);
    },
  };
}
