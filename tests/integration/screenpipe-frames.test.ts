import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { httpScreenpipe } from "../../src/backend/adapters/screenpipe/http.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type Call = { url: URL; headers: Headers };
type Reply = (url: URL) => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** OCR item as Screenpipe returns it, including screen text that must never leak. */
const ocr = (frameId: number, timestamp: string) => ({
  type: "OCR",
  content: {
    frame_id: frameId,
    timestamp,
    app_name: "WINWORD.EXE",
    window_name: `Brief ${frameId} - Word`,
    text: "privileged screen text",
  },
});

function setup(reply: Reply, apiKey: string | null = "test-key") {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return reply(url);
  }) as typeof fetch;
  const db = memoryDb();
  databases.push(db);
  const screenpipe = httpScreenpipe({
    baseUrl: "http://127.0.0.1:3030",
    ...(apiKey ? { apiKey } : {}),
    fetch: fetchImpl,
  });
  const app = createApp(db, { screenpipe });
  return { calls, request: (path: string) => app.request(`/api/screenpipe${path}`) };
}

const range = "start=2026-10-16T09:00:00Z&end=2026-10-16T10:00:00Z";

it("lists frames oldest first, deduplicated, paged, without screen text", async () => {
  // Screenpipe answers newest first, 20 per page; frame 30 appears on both pages.
  const first = Array.from({ length: 20 }, (_, i) =>
    ocr(40 - i, `2026-10-16T09:${String(40 - i).padStart(2, "0")}:00Z`),
  );
  const second = [ocr(30, "2026-10-16T09:30:00Z"), ocr(5, "2026-10-16T09:05:00Z")];
  const { calls, request } = setup((url) =>
    json({ data: url.searchParams.get("offset") === "0" ? first : second }),
  );
  const response = await request(`/frames?${range}`);
  const body = (await response.json()) as { status: string; frames: Array<{ frameId: string }> };
  expect(body.status).toBe("ok");
  expect(body.frames.map((frame) => frame.frameId)).toEqual([
    "5",
    ...Array.from({ length: 20 }, (_, i) => String(21 + i)),
  ]);
  expect(body.frames[0]).toEqual({
    frameId: "5",
    recordedAt: "2026-10-16T09:05:00.000Z",
    appName: "WINWORD.EXE",
    windowTitle: "Brief 5 - Word",
  });
  expect(JSON.stringify(body)).not.toContain("privileged");
  expect(calls.map((call) => call.url.searchParams.get("offset"))).toEqual(["0", "20"]);
  for (const call of calls) {
    expect(call.url.pathname).toBe("/search");
    expect(call.url.searchParams.get("content_type")).toBe("ocr");
    expect(call.url.searchParams.get("include_cloud")).toBe("false");
    expect(call.url.searchParams.get("start_time")).toBe("2026-10-16T09:00:00.000Z");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
  }
});

it("stops at the requested limit", async () => {
  const page = Array.from({ length: 20 }, (_, i) => ocr(100 - i, `2026-10-16T09:${i}:00Z`));
  const { calls, request } = setup(() => json({ data: page }));
  const body = (await (await request(`/frames?${range}&limit=3`)).json()) as {
    frames: unknown[];
  };
  expect(body.frames).toHaveLength(3);
  expect(calls).toHaveLength(1);
});

it("rejects invalid ranges and limits without calling Screenpipe", async () => {
  const { calls, request } = setup(() => json({ data: [] }));
  for (const query of [
    "start=2026-10-16T10:00:00Z&end=2026-10-16T09:00:00Z",
    "start=2026-10-15T09:00:00Z&end=2026-10-16T10:00:00Z",
    "start=yesterday&end=2026-10-16T10:00:00Z",
    "end=2026-10-16T10:00:00Z",
    `${range}&limit=0`,
    `${range}&limit=201`,
  ]) {
    const response = await request(`/frames?${query}`);
    expect(response.status, query).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  }
  expect(calls).toHaveLength(0);
});

it("reports a refused or unreachable Screenpipe as a state", async () => {
  expect(await (await setup(() => json({}, 403)).request(`/frames?${range}`)).json()).toMatchObject(
    { status: "unauthorized" },
  );
  const offline = setup(() => {
    throw new TypeError("fetch failed");
  });
  expect(await (await offline.request(`/frames?${range}`)).json()).toMatchObject({
    status: "unavailable",
  });
});

it("proxies a screenshot with its type, a private cache and the server-side key", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const { calls, request } = setup(
    () => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
  );
  const response = await request("/frames/42/image");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(calls[0].url.pathname).toBe("/frames/42");
  expect(calls[0].headers.get("authorization")).toBe("Bearer test-key");
});

it("maps missing, refused and unreachable screenshots, and rejects bad IDs", async () => {
  expect(
    (await setup(() => json({ error: "not found" }, 404)).request("/frames/42/image")).status,
  ).toBe(404);
  const refused = await setup(() => json({}, 401)).request("/frames/42/image");
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({
    error: "unavailable",
    message: "Screenpipe refused the request",
  });
  const offline = setup(() => {
    throw new TypeError("fetch failed");
  });
  expect((await offline.request("/frames/42/image")).status).toBe(503);
  const notImage = setup(() => json({ hello: "world" }));
  expect((await notImage.request("/frames/42/image")).status).toBe(503);
  const invalid = setup(() => json({}));
  expect((await invalid.request("/frames/12a/image")).status).toBe(400);
  expect(invalid.calls).toHaveLength(0);
});

it("serves screenshots to image requests that carry no Origin header", async () => {
  const { request } = setup(
    () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
  );
  expect((await request("/frames/7/image")).status).toBe(200);
});
