import { afterEach, expect, it, vi } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  httpScreenpipe,
  screenpipeBaseUrl,
  screenpipeConfigFromEnv,
} from "../../src/backend/adapters/screenpipe/http.js";

const databases: ReturnType<typeof memoryDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.useRealTimers();
});

const now = Date.now();
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

/** A fake Screenpipe /search answering per content type. */
function fakeScreenpipe(pages: Partial<Record<string, unknown[]>>, status = 200) {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const data = pages[url.searchParams.get("content_type") ?? ""] ?? [];
    return new Response(JSON.stringify({ data }), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

function setup(fetchImpl: typeof fetch, apiKey: string | null = "test-key") {
  const db = memoryDb();
  databases.push(db);
  const screenpipe = httpScreenpipe({
    baseUrl: "http://127.0.0.1:3030",
    ...(apiKey ? { apiKey } : {}),
    fetch: fetchImpl,
  });
  const app = createApp(db, { screenpipe });
  return async () => (await app.request("/api/screenpipe/focus")).json();
}

it("returns the newest focused window with metadata only", async () => {
  const fake = fakeScreenpipe({
    accessibility: [
      {
        type: "UI",
        content: {
          id: 7,
          timestamp: at(20),
          app_name: "Explorer",
          window_name: "Documents",
          text: "secret",
        },
      },
    ],
    ocr: [
      {
        type: "OCR",
        content: {
          frame_id: 42,
          timestamp: at(3),
          app_name: "WINWORD",
          window_name: "2025-031 Opposition Brief v3 - Word",
          text: "privileged screen text",
        },
      },
      {
        type: "OCR",
        content: {
          frame_id: 43,
          timestamp: at(1),
          app_name: "Chrome",
          window_name: "Background",
          focused: false,
        },
      },
    ],
  });
  const body = await setup(fake.fetch)();
  expect(body).toEqual({
    status: "ok",
    focus: {
      appName: "WINWORD",
      windowTitle: "2025-031 Opposition Brief v3 - Word",
      url: null,
      recordedAt: at(3),
    },
  });
  expect(JSON.stringify(body)).not.toContain("privileged");
  expect(fake.calls.map((call) => call.url.searchParams.get("content_type")).sort()).toEqual([
    "accessibility",
    "input",
    "ocr",
  ]);
  for (const call of fake.calls) {
    expect(call.url.searchParams.get("include_cloud")).toBe("false");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
  }
});

it("reports a missing focus, a refused request and an unreachable Screenpipe as states", async () => {
  expect(await setup(fakeScreenpipe({}).fetch)()).toEqual({ status: "ok", focus: null });
  expect(await setup(fakeScreenpipe({}, 403).fetch)()).toMatchObject({ status: "unauthorized" });
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  expect(await setup(offline)()).toMatchObject({ status: "unavailable" });
});

it("tries Screenpipe without a key and reports the refusal", async () => {
  const fake = fakeScreenpipe({}, 401);
  expect(await setup(fake.fetch, null)()).toMatchObject({ status: "unauthorized" });
  expect(fake.calls[0].headers.has("authorization")).toBe(false);
});

it("shares one Screenpipe read between polls within a second", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fake = fakeScreenpipe({});
  const read = setup(fake.fetch);
  await read();
  await read();
  expect(fake.calls).toHaveLength(3);
  vi.setSystemTime(Date.now() + 1_500);
  await read();
  expect(fake.calls).toHaveLength(6);
});

it("reads the Screenpipe origin from either variable", () => {
  expect(screenpipeBaseUrl({ SCREENPIPE_URL: "http://127.0.0.1:4040/" })).toBe(
    "http://127.0.0.1:4040",
  );
  expect(screenpipeBaseUrl({ SCREENPIPE_API_URL: "http://localhost:3030" })).toBe(
    "http://localhost:3030",
  );
  expect(screenpipeBaseUrl({})).toBe("http://127.0.0.1:3030");
});

it("reads the key from SCREENPIPE_API_KEY, else from SCREENPIPE_API_KEY_FILE", () => {
  const dir = mkdtempSync(join(tmpdir(), "timekeeper-screenpipe-"));
  try {
    const file = join(dir, "screenpipe-api-key");
    writeFileSync(file, "file-key\n");
    expect(screenpipeConfigFromEnv({ SCREENPIPE_API_KEY_FILE: file }).apiKey).toBe("file-key");
    expect(
      screenpipeConfigFromEnv({ SCREENPIPE_API_KEY: "env-key", SCREENPIPE_API_KEY_FILE: file })
        .apiKey,
    ).toBe("env-key");
    expect(
      screenpipeConfigFromEnv({ SCREENPIPE_API_KEY_FILE: join(dir, "missing") }).apiKey,
    ).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("prefers the newest focus event, ignores clicks and never returns typed input", async () => {
  const fake = fakeScreenpipe({
    input: [
      {
        type: "Input",
        content: {
          id: 9,
          timestamp: at(1),
          event_type: "click",
          app_name: "Chrome",
          window_title: "Banking",
          text_content: "typed secret",
        },
      },
      {
        type: "Input",
        content: {
          id: 8,
          timestamp: at(2),
          event_type: "window_focus",
          app_name: "WINWORD.EXE",
          window_title: "2026-012 Lumen Bylaws draft v2 - Word",
          text_content: "typed secret",
        },
      },
    ],
    ocr: [
      {
        type: "OCR",
        content: { frame_id: 1, timestamp: at(10), app_name: "Orca.exe", window_name: "Orca" },
      },
    ],
  });
  const body = await setup(fake.fetch)();
  expect(body).toEqual({
    status: "ok",
    focus: {
      appName: "WINWORD.EXE",
      windowTitle: "2026-012 Lumen Bylaws draft v2 - Word",
      url: null,
      recordedAt: at(2),
    },
  });
  expect(JSON.stringify(body)).not.toContain("typed secret");
});

it("retries a busy Screenpipe search instead of reporting it unavailable", async () => {
  let busy = 1;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get("content_type") === "ocr" && busy-- > 0)
      return new Response(
        JSON.stringify({ error: "search is busy — retry shortly", retry_after_ms: 1 }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    return new Response(JSON.stringify({ data: [] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  expect(await setup(fetchImpl)()).toEqual({ status: "ok", focus: null });
});
