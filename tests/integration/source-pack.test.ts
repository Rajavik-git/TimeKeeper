import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { CompatibilityApiService } from "../../src/backend/application/compatibility.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { createCompatibilityPort } from "../../src/backend/adapters/sqlite/compatibility.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { createApp } from "../../src/backend/api/app.js";

const databases: ReturnType<typeof memoryDb>[] = [];
function fixture() {
  const db = memoryDb();
  databases.push(db);
  const core = new TimeKeeperService(new SqliteRepository(db));
  const port = createCompatibilityPort(db);
  return { db, core, port, service: new CompatibilityApiService(port, core) };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

interface Pack {
  entries: Array<{ id: string; date: string; block_id: number | null }>;
  sources: Array<{ type: string; work_period_id: string }>;
  audit: unknown[];
}

it("keeps unattached sources separate from a period whose opaque ID is null", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const app = createApp(db);
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post("/catalog/clients", { id: "client", name: "Synthetic client" })).status).toBe(
    200,
  );
  expect(
    (
      await post("/catalog/cases", {
        id: "case",
        clientId: "client",
        reference: "SYNTHETIC",
        title: "Synthetic case",
        hourlyRateCents: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post("/commands/start", {
        producerId: "test",
        commandId: "start",
        sessionId: "session",
        occurredAt: "2026-10-17T09:00:00Z",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post("/work-periods", {
        id: "null",
        sessionId: "session",
        caseId: "case",
        startedAt: "2026-10-17T09:00:00Z",
        origin: "automatic",
        mode: "current",
      })
    ).status,
  ).toBe(200);
  for (const [id, periodId] of [
    ["attached", "null"],
    ["unattached", null],
  ]) {
    expect(
      (
        await post("/sources/import", {
          id,
          periodId,
          instanceId: "test",
          contentType: "screen",
          externalId: id,
          recordedAt: "2026-10-17T09:01:00Z",
        })
      ).status,
    ).toBe(200);
  }
  const response = await post("/cases/case/source-pack", {
    scope: "chosen",
    periodIds: ["null"],
    options: [],
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  const pack = JSON.parse(result.payload);
  expect(pack.entries.map((entry: { id: string }) => entry.id)).toEqual(["null"]);
  expect(pack.sources.map((source: { id: string }) => source.id)).toEqual(["attached"]);
  expect(createHash("sha256").update(result.payload).digest("hex")).toBe(result.export.sha256);
  expect(
    db
      .prepare("SELECT sha256, period_ids_json FROM source_exports WHERE id=?")
      .get(result.export.id),
  ).toEqual({
    sha256: result.export.sha256,
    period_ids_json: JSON.stringify(["null"]),
  });
});

it("uses inclusive dates and independently applies personal-app and audio exclusions", () => {
  const { core, service } = fixture();
  service.updateCatalog("setting", 1, { excluded_apps: " PDF READER " });
  const exportRange = (options: string[]) =>
    service.exportCaseSources(1, "period", options, {
      from: "2026-10-02",
      to: "2026-10-06",
    });
  const full = exportRange(["transcripts"]);
  const pack: Pack = JSON.parse(full.payload);
  expect(pack.entries.map((entry) => entry.id)).toEqual(
    core
      .allPeriods()
      .filter(
        (period) =>
          period.caseId === "1" &&
          !period.excluded &&
          period.startedAt.slice(0, 10) >= "2026-10-02" &&
          period.startedAt.slice(0, 10) <= "2026-10-06",
      )
      .map((period) => period.id),
  );
  expect(pack.entries.some((entry) => entry.date === "2026-10-02")).toBe(true);
  expect(pack.entries.some((entry) => entry.date === "2026-10-06")).toBe(true);
  expect(pack.sources.some((source) => source.type === "audio")).toBe(true);
  expect(pack.audit).toEqual([]);

  const noAudio: Pack = JSON.parse(exportRange([]).payload);
  expect(noAudio.sources.length).toBeGreaterThan(0);
  expect(noAudio.sources.every((source) => source.type !== "audio")).toBe(true);
  const personal: Pack = JSON.parse(exportRange(["personal", "transcripts"]).payload);
  expect(personal.entries.map((entry) => entry.block_id)).toEqual([2]);
  expect(personal.sources.length).toBeGreaterThan(0);
  expect(
    personal.sources.every((source) =>
      personal.entries.some((entry) => entry.id === source.work_period_id),
    ),
  ).toBe(true);
  expect(createHash("sha256").update(full.payload).digest("hex")).toBe(full.export.sha256);
});

it("rolls back the receipt when writing its audit event fails", () => {
  const { db, core, port } = fixture();
  const beforeExports = db.prepare("SELECT count(*) AS count FROM source_exports").get();
  const beforeAudit = db.prepare("SELECT count(*) AS count FROM audit_events").get();
  const service = new CompatibilityApiService(
    {
      ...port,
      audit: () => {
        throw Error("Synthetic audit failure");
      },
    },
    core,
  );
  expect(() => service.exportCaseSources(1, "case", [], {})).toThrow("Synthetic audit failure");
  expect(db.prepare("SELECT count(*) AS count FROM source_exports").get()).toEqual(beforeExports);
  expect(db.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual(beforeAudit);
});

it("creates no receipt or audit event when scope has no eligible periods", () => {
  const { db, service } = fixture();
  const beforeExports = db.prepare("SELECT count(*) AS count FROM source_exports").get();
  const beforeAudit = db.prepare("SELECT count(*) AS count FROM audit_events").get();
  expect(() => service.exportCaseSources(1, "chosen", [], { periodIds: [] })).toThrow(
    "No periods in source pack scope",
  );
  expect(db.prepare("SELECT count(*) AS count FROM source_exports").get()).toEqual(beforeExports);
  expect(db.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual(beforeAudit);
});
