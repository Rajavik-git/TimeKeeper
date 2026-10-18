import { afterEach, expect, it } from "vitest";
import { createApp } from "../../src/backend/api/app.js";
import { CompatibilityApiService } from "../../src/backend/application/compatibility.js";
import { CatalogService } from "../../src/backend/application/catalog.js";
import { SourceExportService } from "../../src/backend/application/source-export.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { createCompatibilityPort } from "../../src/backend/adapters/sqlite/compatibility.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import { sourceExportPort } from "../../src/backend/adapters/sqlite/source-export.js";
import { openDb } from "../../src/backend/adapters/sqlite/repository.js";
import { NonbillableReason, SystemTaskCode } from "../../src/backend/domain/states.js";
import { memoryDb } from "../fixtures/database.js";

const databases: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

it("protects built-in identities through canonical and compatibility routes while labels remain editable", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const app = createApp(db);
  const catalog = new CatalogService(catalogRepository(db));
  const research = catalogRepository(db)
    .state()
    .taskTypes.find((task) => task.code === SystemTaskCode.Research)!;
  const write = (path: string, body: unknown, method = "PATCH") =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const path of [`/catalog/task-types/${research.id}`, `/task/${research.id}`]) {
    expect((await write(path, { code: "RENAMED" })).status).toBe(400);
    expect(
      (await write(path, { code: SystemTaskCode.Research, label: "Research display name" })).status,
    ).toBe(200);
  }
  expect(catalogRepository(db).taskType(research.id)).toMatchObject({
    code: SystemTaskCode.Research,
    label: "Research display name",
  });
  const custom = catalog.createTaskType({ code: "CUSTOM", label: "Custom task" });
  expect(catalog.updateTaskType(custom.id, { code: "CUSTOM-RENAMED" }).code).toBe("CUSTOM-RENAMED");
  for (const path of [`/catalog/task-types/${custom.id}`, `/task/${custom.id}`]) {
    expect((await write(path, { code: SystemTaskCode.Research })).status).toBe(400);
  }
  for (const path of ["/catalog/task-types", "/tasks"]) {
    expect(
      (await write(path, { code: SystemTaskCode.Research, label: "Impersonated research" }, "POST"))
        .status,
    ).toBe(400);
  }
});

function recoveryFixture() {
  const db = memoryDb();
  databases.push(db);
  const repo = new SqliteRepository(db);
  const core = new TimeKeeperService(repo);
  const catalog = new CatalogService(catalogRepository(db));
  const port = createCompatibilityPort(db);
  const service = new CompatibilityApiService(
    port,
    core,
    catalog,
    new SourceExportService(sourceExportPort(db)),
  );
  return { db, repo, core, catalog, service };
}

it("restores the saved work without a research task and preserves its corrections and validation", () => {
  const { db, repo, core, catalog, service } = recoveryFixture();
  const task = catalog.createTaskType({ code: "CUSTOM", label: "Custom task" });
  catalog.updateTaskType(task.id, { code: "RENAMED-CUSTOM" });
  core.updatePeriodDetails("9", {
    taskTypeId: task.id,
    label: "Saved lawyer description",
    billable: false,
    nonbillableReason: NonbillableReason.Offered,
  });
  core.setDurationOverride("9", 123456);
  core.validatePeriod("9");
  service.discardEntry(9);
  const before = repo.period("9")!;
  const blockBefore = db.prepare("SELECT * FROM block WHERE id=9").get();
  // Simulate a historical workspace without the previous hardcoded recovery code.
  db.prepare("UPDATE task_types SET code='OLD-RESEARCH' WHERE code=?").run(SystemTaskCode.Research);
  db.prepare("DELETE FROM demo_period_entries WHERE period_id='9'").run();
  const recovered = service.recoverBlock(9);
  expect(repo.period("9")).toEqual({ ...before, excluded: false, revision: before.revision + 1 });
  expect(recovered).toMatchObject({
    label: "Saved lawyer description",
    task_id: task.id,
    billable: false,
    reason: NonbillableReason.Offered,
    review_status: "approved",
  });
  expect(db.prepare("SELECT * FROM block WHERE id=9").get()).toEqual(blockBefore);
});

it("rolls back restored work and alias creation when recovery audit fails", () => {
  const fixture = recoveryFixture();
  fixture.service.discardEntry(9);
  const before = fixture.repo.period("9");
  fixture.db.prepare("DELETE FROM demo_period_entries WHERE period_id='9'").run();
  const port = createCompatibilityPort(fixture.db);
  const failing = new CompatibilityApiService(
    {
      ...port,
      audit: () => {
        throw new Error("audit unavailable");
      },
    },
    fixture.core,
    fixture.catalog,
    new SourceExportService(sourceExportPort(fixture.db)),
  );
  expect(() => failing.recoverBlock(9)).toThrow("audit unavailable");
  expect(fixture.repo.period("9")).toEqual(before);
  expect(
    fixture.db.prepare("SELECT * FROM demo_period_entries WHERE period_id='9'").get(),
  ).toBeUndefined();
});

it("rejects recovery before writes when the block has no canonical period", () => {
  const { db, repo, service } = recoveryFixture();
  service.discardEntry(9);
  const before = repo.period("9");
  db.prepare("DELETE FROM demo_block_periods WHERE block_id=9").run();
  expect(() => service.recoverBlock(9)).toThrow("canonical work period not found");
  expect(repo.period("9")).toEqual(before);
});
