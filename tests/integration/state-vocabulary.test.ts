import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { stateDefinitions, stateObjects } from "../../src/backend/domain/states.js";
import * as publicStates from "../../src/contracts/states.generated.js";
import { defaultWeights } from "../../src/backend/domain/recognition.js";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { getTableName } from "drizzle-orm";
import * as tables from "../../src/backend/adapters/sqlite/tables.js";

it("keeps generated public states and query mappings aligned with the domain vocabulary", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../../src/contracts/openapi.yaml", import.meta.url), "utf8"),
  );
  for (const [name, values] of Object.entries(stateDefinitions)) {
    expect(contract.components.schemas[name].enum, name).toEqual([...values]);
    expect(publicStates[name as keyof typeof publicStates], name).toEqual(
      stateObjects[name as keyof typeof stateObjects],
    );
  }
  expect(Object.keys(defaultWeights).sort()).toEqual([...stateDefinitions.MarkerType].sort());
  const mappings = [
    [tables.work_periods.initial_origin, stateDefinitions.AssignmentOrigin],
    [tables.work_periods.assignment_origin, stateDefinitions.AssignmentOrigin],
    [tables.work_periods.billing_status, stateDefinitions.BillingStatus],
    [tables.work_periods.time_validation_status, stateDefinitions.ValidationStatus],
    [tables.sources.validation_status, stateDefinitions.ValidationStatus],
    [tables.sources.availability_status, stateDefinitions.AvailabilityStatus],
    [tables.cases.status, stateDefinitions.CaseStatus],
    [tables.clients.type, stateDefinitions.ClientType],
    [tables.clients.mode, stateDefinitions.ClientBillingMode],
    [tables.cases.mode, stateDefinitions.CaseBillingMode],
    [tables.pending_questions.status, stateDefinitions.QuestionStatus],
    [tables.processed_commands.status, stateDefinitions.CommandStatus],
    [tables.reconstruction_conflicts.status, stateDefinitions.ReconstructionStatus],
    [tables.assignment_deliveries.status, stateDefinitions.DeliveryStatus],
    [tables.retrieval_progress.status, stateDefinitions.RetrievalStatus],
    [tables.expenses.type, stateDefinitions.ExpenseType],
    [tables.invoices.type, stateDefinitions.InvoiceType],
    [tables.invoices.status, stateDefinitions.InvoiceStatus],
    [tables.invoice_lines.origin, stateDefinitions.InvoiceLineOrigin],
    [tables.settings.base_unit, stateDefinitions.BaseUnit],
    [tables.settings.pill_display, stateDefinitions.PillDisplay],
    [tables.client_rules.type, stateDefinitions.ClientRuleType],
    [tables.markers.type, stateDefinitions.MarkerType],
  ] as const;
  for (const [column, values] of mappings) expect(column.enumValues, column.name).toEqual(values);
});

it("requires a deliberate SQL migration when current period or source states change", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db);
    db.exec(`
      INSERT INTO sessions(id,started_at,ended_at,created_at,updated_at)
        VALUES('session','2026-10-17T08:00:00Z','2026-10-17T09:00:00Z',
          '2026-10-17T08:00:00Z','2026-10-17T09:00:00Z');
      INSERT INTO work_periods(id,session_id,initial_origin,started_at,ended_at,
        detected_duration_ms,label,created_at,updated_at)
        VALUES('period','session','unresolved','2026-10-17T08:00:00Z',
          '2026-10-17T09:00:00Z',60000,'Fictional test work',
          '2026-10-17T08:00:00Z','2026-10-17T09:00:00Z');
      INSERT INTO sources(id,work_period_id,screenpipe_instance_id,content_type,
        external_id,recorded_at,ingested_at)
        VALUES('source','period','fictional','ocr','frame',
          '2026-10-17T08:00:00Z','2026-10-17T08:00:00Z');
    `);
    for (const column of ["initial_origin", "assignment_origin"]) {
      const update = db.prepare(`UPDATE work_periods SET ${column}=? WHERE id='period'`);
      for (const state of stateDefinitions.AssignmentOrigin)
        expect(() => update.run(state)).not.toThrow();
      expect(() => update.run("unsupported")).toThrow();
    }
    const billing = db.prepare(
      "UPDATE work_periods SET billing_status=?, billed_at=? WHERE id='period'",
    );
    for (const state of stateDefinitions.BillingStatus)
      expect(() =>
        billing.run(state, state === "billed" ? "2026-10-17T09:00:00Z" : null),
      ).not.toThrow();
    expect(() => billing.run("unsupported", null)).toThrow();
    const time = db.prepare(
      "UPDATE work_periods SET time_validation_status=?,validated_effective_revision=?,time_validated_at=? WHERE id='period'",
    );
    const source = db.prepare(
      "UPDATE sources SET validation_status=?,validated_at=? WHERE id='source'",
    );
    for (const state of stateDefinitions.ValidationStatus) {
      const at = state === "validated" ? "2026-10-17T09:00:00Z" : null;
      expect(() => time.run(state, at === null ? null : 0, at)).not.toThrow();
      expect(() => source.run(state, at)).not.toThrow();
    }
    expect(() => time.run("unsupported", null, null)).toThrow();
    expect(() => source.run("unsupported", null)).toThrow();
    const availability = db.prepare("UPDATE sources SET availability_status=? WHERE id='source'");
    for (const state of stateDefinitions.AvailabilityStatus)
      expect(() => availability.run(state)).not.toThrow();
    expect(() => availability.run("unsupported")).toThrow();
  } finally {
    db.close();
  }
});

it("keeps named runtime defaults identical to migrated SQLite defaults", () => {
  const defaults = [
    [tables.cases, tables.cases.status],
    [tables.cases, tables.cases.mode],
    [tables.clients, tables.clients.type],
    [tables.clients, tables.clients.mode],
    [tables.reconstruction_conflicts, tables.reconstruction_conflicts.status],
    [tables.settings, tables.settings.base_unit],
    [tables.settings, tables.settings.pill_display],
    [tables.sources, tables.sources.validation_status],
    [tables.sources, tables.sources.availability_status],
    [tables.work_periods, tables.work_periods.assignment_origin],
    [tables.work_periods, tables.work_periods.time_validation_status],
    [tables.work_periods, tables.work_periods.billing_status],
  ] as const;
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db);
    for (const [table, column] of defaults) {
      const tableName = getTableName(table);
      const stored = db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .find((row) => row.name === column.name);
      expect(stored, `${tableName}.${column.name}`).toBeDefined();
      // Only SQL schema metadata from this isolated migrated database enters this query.
      const result = db.prepare(`SELECT ${stored!.dflt_value} AS value`).get();
      expect(column.default, `${tableName}.${column.name}`).toBe(result!.value);
    }
    expect(tables.setting.pill_display.default).toBe(tables.settings.pill_display.default);
  } finally {
    db.close();
  }
});

it("references the canonical source-pack vocabulary without narrowing custom task codes", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../../src/contracts/openapi.yaml", import.meta.url), "utf8"),
  );
  const schemas = contract.components.schemas;
  expect(schemas.CanonicalSourcePackRequest.properties.scope).toEqual({
    $ref: "#/components/schemas/SourcePackScope",
  });
  expect(schemas.CanonicalSourcePackRequest.properties.options.items).toEqual({
    $ref: "#/components/schemas/SourcePackOption",
  });
  for (const name of [
    "CatalogTaskType",
    "CreateCatalogTaskTypeRequest",
    "PatchCatalogTaskTypeRequest",
  ])
    expect(schemas[name].properties.code).toEqual({ type: "string" });
});
