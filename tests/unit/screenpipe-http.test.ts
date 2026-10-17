import { describe, expect, it } from 'vitest';
import { httpScreenpipe, ScreenpipeAuthError, ScreenpipeUnavailableError, screenpipeConfigFromEnv } from '../../src/backend/adapters/screenpipe/http';

// A stand-in for Screenpipe's GET /search, shaped like its documented response (docs/API.md D5).
type Item = { type: string; content: Record<string, unknown> };
function fakeScreenpipe(byType: Record<string, Item[]>, options: { status?: number } = {}) {
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if (url.pathname === '/health') return new Response('{"status":"healthy"}', { status: 200 });
    if (options.status) return new Response('{}', { status: options.status });
    const items = byType[url.searchParams.get('content_type')!] ?? [];
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
    return Response.json({ data: items.slice(offset, offset + limit), pagination: { limit, offset, total: items.length } });
  }) as typeof fetch;
  return { fetcher, requests };
}
const client = (fetcher: typeof fetch, apiKey?: string) =>
  httpScreenpipe({ baseUrl: 'http://localhost:3030', instanceId: 'laptop', fetch: fetcher, pageSize: 2, ...(apiKey ? { apiKey } : {}) });

const ui = (id: number, timestamp: string) => ({ type: 'UI', content: { id, text: 'secret screen text', timestamp, app_name: 'Word', window_name: 'Lease draft.docx', browser_url: null } });
const ocr = (frame_id: number, timestamp: string) => ({ type: 'OCR', content: { frame_id, text: 'secret OCR text', timestamp, app_name: 'Chrome', window_name: 'Court portal', browser_url: 'https://court.example/case' } });
const audio = (chunk_id: number, timestamp: string) => ({ type: 'Audio', content: { chunk_id, transcription: 'secret call', timestamp } });

describe('Screenpipe HTTP adapter (docs/API.md D5)', () => {
  it('reads every page of each evidence kind, keeps references only, and sorts by time', async () => {
    const { fetcher } = fakeScreenpipe({
      accessibility: [ui(1, '2026-10-17T09:00:02.123456+02:00'), ui(2, '2026-10-17T07:05:00Z'), ui(3, '2026-10-17T07:10:00Z')],
      ocr: [ocr(40, '2026-10-17T07:01:00Z')],
      audio: [audio(7, '2026-10-17T07:20:00Z')],
    });
    const observations = await client(fetcher).read('2026-10-17T07:00:00.000Z', '2026-10-17T08:00:00.000Z');
    expect(observations.map(o => `${o.contentType}:${o.externalId}@${o.recordedAt}`)).toEqual([
      'accessibility:1@2026-10-17T07:00:02.123Z',
      'ocr:40@2026-10-17T07:01:00.000Z',
      'accessibility:2@2026-10-17T07:05:00.000Z',
      'accessibility:3@2026-10-17T07:10:00.000Z',
      'audio:7@2026-10-17T07:20:00.000Z',
    ]);
    expect(observations[1]).toEqual({ instanceId: 'laptop', contentType: 'ocr', externalId: '40', recordedAt: '2026-10-17T07:01:00.000Z',
      appName: 'Chrome', windowName: 'Court portal', url: 'https://court.example/case' });
    expect(JSON.stringify(observations)).not.toContain('secret');
  });

  it('sends the token and client header, local-only search, and the time window', async () => {
    const { fetcher, requests } = fakeScreenpipe({});
    await client(fetcher, 'sp-token').read('2026-10-17T07:00:00.000Z', '2026-10-17T08:00:00.000Z');
    expect(requests.map(r => r.url.searchParams.get('content_type'))).toEqual(['accessibility', 'ocr', 'audio']);
    for (const { url, headers } of requests) {
      expect(headers).toEqual({ 'X-Screenpipe-Client': 'api', Authorization: 'Bearer sp-token' });
      expect(url.searchParams.get('include_cloud')).toBe('false');
      expect(url.searchParams.get('start_time')).toBe('2026-10-17T07:00:00.000Z');
      expect(url.searchParams.get('end_time')).toBe('2026-10-17T08:00:00.000Z');
    }
  });

  it('removes duplicates returned on overlapping pages', async () => {
    const { fetcher } = fakeScreenpipe({ ocr: [ocr(40, '2026-10-17T07:01:00Z'), ocr(40, '2026-10-17T07:01:00Z'), ocr(41, '2026-10-17T07:02:00Z')] });
    expect((await client(fetcher).read('a', 'b')).map(o => o.externalId)).toEqual(['40', '41']);
  });

  it('skips items it cannot identify instead of inventing references', async () => {
    const { fetcher } = fakeScreenpipe({ ocr: [{ type: 'OCR', content: { text: 'no id', timestamp: '2026-10-17T07:00:00Z' } },
      { type: 'OCR', content: { frame_id: 5, timestamp: 'not a date' } }, ocr(6, '2026-10-17T07:00:00Z')] });
    expect((await client(fetcher).read('a', 'b')).map(o => o.externalId)).toEqual(['6']);
  });

  it('reports a refused token without exposing it, and does not retry', async () => {
    for (const status of [401, 403]) {
      const { fetcher, requests } = fakeScreenpipe({}, { status });
      const error = await client(fetcher, 'sp-secret-token').read('a', 'b').catch(e => e);
      expect(error).toBeInstanceOf(ScreenpipeAuthError);
      expect(error.message).not.toContain('sp-secret-token');
      expect(requests).toHaveLength(1);
    }
  });

  it('reports Screenpipe failures and an unreachable Screenpipe as unavailable', async () => {
    const { fetcher } = fakeScreenpipe({}, { status: 500 });
    await expect(client(fetcher).read('a', 'b')).rejects.toBeInstanceOf(ScreenpipeUnavailableError);
    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(client(down).read('a', 'b')).rejects.toBeInstanceOf(ScreenpipeUnavailableError);
    expect(await client(down).health()).toBe(false);
  });

  it('checks health without the token and verifies access with it', async () => {
    const { fetcher, requests } = fakeScreenpipe({});
    const c = client(fetcher, 'sp-token');
    expect(await c.health()).toBe(true);
    expect(requests[0]!.headers.Authorization).toBeUndefined();
    await c.verifyAccess();
    expect(requests[1]!.headers.Authorization).toBe('Bearer sp-token');
    const { fetcher: refusing } = fakeScreenpipe({}, { status: 401 });
    await expect(client(refusing, 'bad').verifyAccess()).rejects.toBeInstanceOf(ScreenpipeAuthError);
  });

  it('reads its configuration from the environment', () => {
    expect(screenpipeConfigFromEnv({})).toMatchObject({ baseUrl: 'http://localhost:3030', instanceId: 'local' });
    const config = screenpipeConfigFromEnv({ SCREENPIPE_URL: 'http://127.0.0.1:4040/', SCREENPIPE_API_KEY: 'k', SCREENPIPE_INSTANCE_ID: 'office' });
    expect(config).toMatchObject({ baseUrl: 'http://127.0.0.1:4040', apiKey: 'k', instanceId: 'office' });
  });
});
