import { afterEach, expect, it, vi } from "vitest";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { createApplicationServices } from "../../src/backend/bootstrap.js";
import {
  createScreenpipeIntegration,
  screenpipeConfiguration,
} from "../../src/backend/screenpipe-integration.js";
import { createApp, createHttpApp } from "../../src/backend/api/app.js";
import { ScreenpipeIntegrationCoordinator } from "../../src/backend/application/screenpipe-integration.js";
import type { ScreenpipeIntegrationOperations } from "../../src/backend/ports/screenpipe-integration.js";

const databases: ReturnType<typeof openDb>[] = [];
const coordinators: ScreenpipeIntegrationCoordinator[] = [];
afterEach(async () => {
  for (const integration of coordinators.splice(0)) await integration.stop();
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});
const config = {
  SCREENPIPE_API_KEY: "fixture-private-token",
  SCREENPIPE_URL: "http://127.0.0.1:3030",
  SCREENPIPE_INSTANCE_ID: "fixture",
};
function fixture(withSession = true, start = "2026-10-17T09:00:00Z") {
  const db = openDb(":memory:");
  databases.push(db);
  const services = createApplicationServices(db, { now: () => "2026-10-17T11:00:00Z" });
  if (withSession) {
    services.core.createClient("client", "Fixture client");
    services.core.createCase("case", "client", "CASE", "Fixture case", null);
    services.core.start({
      producerId: "fixture",
      commandId: "start",
      sessionId: "session",
      occurredAt: start,
    });
    services.core.openPeriod({
      id: "period",
      sessionId: "session",
      caseId: "case",
      startedAt: start,
      origin: "automatic",
      mode: "current",
    });
    services.core.end({
      producerId: "fixture",
      commandId: "end",
      sessionId: "session",
      occurredAt: "2026-10-17T10:00:00Z",
    });
  }
  return { db, services };
}
function provider(handler?: (url: URL) => Response | undefined) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.headers).toMatchObject({ Authorization: "Bearer fixture-private-token" });
    expect(url.pathname).toBe("/search");
    const custom = handler?.(url);
    if (custom) return custom;
    const data =
      url.searchParams.get("content_type") === "ocr"
        ? [
            {
              type: "OCR",
              content: {
                frame_id: url.searchParams.get("start_time") === "2026-10-17T08:00:00.000Z" ? 0 : 1,
                timestamp:
                  url.searchParams.get("start_time") === "2026-10-17T08:00:00.000Z"
                    ? "2026-10-17T08:30:00Z"
                    : "2026-10-17T09:58:00Z",
              },
            },
          ]
        : [];
    return Response.json({ data, pagination: { total: data.length } });
  });
}
function integration(
  services: ReturnType<typeof createApplicationServices>,
  db: ReturnType<typeof openDb>,
  fetcher: typeof fetch,
  env = config,
) {
  const value = createScreenpipeIntegration(services, db, env, fetcher);
  coordinators.push(value);
  return value;
}

it("tests authenticated search without writing evidence and syncs/deduplicates through the canonical importer", async () => {
  const { db, services } = fixture();
  const fetcher = provider();
  const value = integration(services, db, fetcher);
  expect(value.status()).toMatchObject({
    configured: true,
    automaticSync: false,
    connection: { status: "not-tested" },
    lastRun: null,
  });
  expect((await value.test()).connection.status).toBe("connected");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("limit")).toBe("1");
  expect(services.core.allSources()).toHaveLength(0);
  expect((await value.sync()).lastRun).toMatchObject({
    outcome: "succeeded",
    windows: 1,
    imported: 1,
    unchanged: 0,
    error: null,
  });
  expect((await value.sync()).lastRun).toMatchObject({
    outcome: "succeeded",
    imported: 0,
    unchanged: 1,
  });
  expect(services.core.allSources()).toHaveLength(1);
  expect(services.core.getPeriod("period").durationOverrideMs).toBeNull();
});

it("reports missing or unsafe configuration without calls and reports no sessions without evidence imports", async () => {
  const { db, services } = fixture(false);
  const fetcher = provider();
  for (const url of [
    "https://127.0.0.1:3030",
    "http://example.test",
    "http://localhost/path",
    "http://name:secret@localhost",
    "http://localhost?x=1",
    "http://localhost/#secret",
    "not-a-url",
  ]) {
    expect(screenpipeConfiguration({ ...config, SCREENPIPE_URL: url }).issue).toBe("invalid-url");
  }
  for (const url of ["http://localhost:3030", "http://127.0.0.1:3030/", "http://[::1]:3030"])
    expect(screenpipeConfiguration({ ...config, SCREENPIPE_URL: url }).issue).toBeNull();
  const missing = integration(services, db, fetcher, { ...config, SCREENPIPE_API_KEY: "   " });
  expect((await missing.test()).connection.status).toBe("not-configured");
  expect((await missing.sync()).lastRun).toMatchObject({
    outcome: "not-configured",
    error: "not-configured",
    imported: 0,
  });
  const configured = integration(services, db, fetcher);
  expect((await configured.sync()).lastRun).toMatchObject({
    outcome: "no-sessions",
    windows: 0,
    imported: 0,
    error: null,
  });
  expect(configured.status().connection.status).toBe("not-tested");
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps actual counts after a partial authentication failure, pauses auto retries and resumes after an explicit successful test", async () => {
  vi.useFakeTimers();
  const { db, services } = fixture(true, "2026-10-17T08:00:00Z");
  let failed = true;
  const fetcher = provider((url) =>
    failed && String(url.searchParams.get("start_time")) >= "2026-10-17T09:00:00"
      ? new Response("provider-private-body", { status: 401 })
      : undefined,
  );
  const value = integration(services, db, fetcher);
  value.start();
  const first = await value.sync();
  expect(first).toMatchObject({
    automaticSync: false,
    connection: { status: "authentication-failed" },
    lastRun: { outcome: "partial", windows: 1, error: "authentication-failed" },
    lastSuccessfulSyncAt: null,
  });
  const attempts = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetcher).toHaveBeenCalledTimes(attempts);
  failed = false;
  expect((await value.test()).automaticSync).toBe(true);
  expect((await value.sync()).lastRun?.outcome).toBe("succeeded");
  expect(value.status().lastSuccessfulSyncAt).toBe("2026-10-17T11:00:00Z");
  expect(JSON.stringify(value.status())).not.toMatch(
    /fixture-private-token|provider-private-body|http:/,
  );
});

it("single-flights tests and coalesces startup/manual/automatic sync while preserving independent busy state", async () => {
  vi.useFakeTimers();
  let finishRun!: () => void;
  let finishTest!: () => void;
  const ops: ScreenpipeIntegrationOperations = {
    hasSessions: () => true,
    verifyAccess: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTest = resolve;
        }),
    ),
    run: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishRun = resolve;
      });
      return { windows: 1, imported: 0, unchanged: 0, preserved: 0, error: null };
    }),
  };
  const value = new ScreenpipeIntegrationCoordinator(null, ops);
  coordinators.push(value);
  value.start();
  const run = value.sync();
  expect(value.sync()).toBe(run);
  const test = value.test();
  expect(value.test()).toBe(test);
  expect(value.status()).toMatchObject({ syncing: true, testing: true });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(ops.run).toHaveBeenCalledTimes(1);
  finishRun();
  finishTest();
  await Promise.all([run, test]);
  expect(value.status()).toMatchObject({ syncing: false, testing: false });
  await value.stop();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(ops.run).toHaveBeenCalledTimes(1);
});

it("serves sanitized status with default no-network behavior, CORS and strict optional action bodies", async () => {
  const { db, services } = fixture(false);
  const fetcher = provider(() => new Response("secret-body", { status: 403 }));
  const value = integration(services, db, fetcher);
  const app = createHttpApp(services, { screenpipe: value });
  const base = "/api/integrations/screenpipe";
  expect((await (await createApp(db).request(base)).json()).configured).toBe(false);
  expect(
    (
      await app.request(`${base}/test`, {
        method: "POST",
        headers: { Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(`${base}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "no" }),
      })
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const response = await app.request(`${base}/test`, { method: "POST" });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.connection.status).toBe("authentication-failed");
  expect(JSON.stringify(body)).not.toMatch(/secret-body|fixture-private-token|http:/);
});

it("aborts and awaits in-flight operations before shutdown completes", async () => {
  let release!: () => void;
  let aborted = false;
  const value = new ScreenpipeIntegrationCoordinator(null, {
    hasSessions: () => true,
    verifyAccess: async () => {},
    run: async (_now, signal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
      return { windows: 0, imported: 0, unchanged: 0, preserved: 0, error: null };
    },
  });
  coordinators.push(value);
  const active = value.sync();
  let stopped = false;
  const stop = value.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(aborted).toBe(true);
  expect(stopped).toBe(false);
  release();
  await Promise.all([active, stop]);
  expect(stopped).toBe(true);
  expect(value.status()).toMatchObject({ automaticSync: false, syncing: false, lastRun: null });
});

it("does not claim connection proof or resume automatic retries from a zero-window batch", async () => {
  vi.useFakeTimers();
  const { db, services } = fixture(false);
  services.core.start({
    producerId: "fixture",
    commandId: "zero-start",
    sessionId: "zero",
    occurredAt: "2026-10-17T11:00:00Z",
  });
  services.core.end({
    producerId: "fixture",
    commandId: "zero-end",
    sessionId: "zero",
    occurredAt: "2026-10-17T11:00:00Z",
  });
  const fetcher = provider(() => new Response("private", { status: 401 }));
  const value = integration(services, db, fetcher);
  value.start();
  expect((await value.sync()).lastRun).toMatchObject({ outcome: "succeeded", windows: 0 });
  expect(value.status()).toMatchObject({
    connection: { status: "not-tested", checkedAt: null },
    lastSuccessfulSyncAt: null,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect((await value.test()).automaticSync).toBe(false);
  expect(await value.sync()).toMatchObject({
    automaticSync: false,
    connection: { status: "authentication-failed" },
    lastSuccessfulSyncAt: null,
    lastRun: { windows: 0 },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reports imported records before an internal storage failure without marking the window successful", async () => {
  const { db, services } = fixture();
  services.core.importSource({
    id: "existing",
    periodId: "period",
    instanceId: "fixture",
    contentType: "ocr",
    externalId: "2",
    recordedAt: "2026-10-17T09:57:00Z",
  });
  const fetcher = provider((url) =>
    url.searchParams.get("content_type") === "ocr"
      ? Response.json({
          data: [
            { type: "OCR", content: { frame_id: 1, timestamp: "2026-10-17T09:58:00Z" } },
            { type: "OCR", content: { frame_id: 2, timestamp: "2026-10-17T09:59:00Z" } },
          ],
          pagination: { total: 2 },
        })
      : undefined,
  );
  const value = integration(services, db, fetcher);
  expect((await value.sync()).lastRun).toMatchObject({
    outcome: "partial",
    imported: 1,
    windows: 0,
    error: "internal",
  });
  expect(services.core.allSources()).toHaveLength(2);
  expect(services.core.coverageGaps()).toMatchObject([{ status: "failed" }]);
  expect(value.status().lastSuccessfulSyncAt).toBeNull();
});

it("distinguishes unavailable and incomplete reads while sanitizing unexpected connection failures", async () => {
  const { db, services } = fixture();
  const unavailable = integration(
    services,
    db,
    vi.fn<typeof fetch>(async () => {
      throw new Error("private endpoint credentials");
    }),
  );
  expect((await unavailable.sync()).lastRun).toMatchObject({
    outcome: "failed",
    error: "unavailable",
  });
  const incomplete = integration(
    services,
    db,
    provider(() => Response.json({ data: [], pagination: { total: 1 } })),
  );
  expect((await incomplete.sync()).lastRun).toMatchObject({
    outcome: "failed",
    error: "incomplete",
  });
  const unexpected = new ScreenpipeIntegrationCoordinator(null, {
    hasSessions: () => true,
    verifyAccess: async () => {
      throw new Error("private endpoint credentials");
    },
    run: async () => {
      throw new Error("private endpoint credentials");
    },
  });
  coordinators.push(unexpected);
  expect((await unexpected.test()).connection.status).toBe("error");
  expect((await unexpected.sync()).lastRun?.error).toBe("internal");
  expect(JSON.stringify(unexpected.status())).not.toContain("private");
});
