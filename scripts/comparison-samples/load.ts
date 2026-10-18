import type { DatabaseSync } from "node:sqlite";
import { CatalogService } from "../../src/backend/application/catalog.js";
import { TimeKeeperService } from "../../src/backend/application/service.js";
import { catalogRepository } from "../../src/backend/adapters/sqlite/catalog-repository.js";
import { SqliteRepository } from "../../src/backend/adapters/sqlite/core-repository.js";
import {
  AssignmentOrigin,
  AvailabilityStatus,
  BillingStatus,
  ClientType,
  PeriodOpenMode,
} from "../../src/backend/domain/states.js";
import { sampleClients, sampleNamespace, type ComparisonSamplePlan } from "./plan.js";

/** Opt-in fixture import. Never runs during normal database initialization. */
export function loadComparisonSamples(db: DatabaseSync, plan: ComparisonSamplePlan) {
  const repository = new SqliteRepository(db);
  const now = () => plan.generatedAt;
  const catalog = new CatalogService(catalogRepository(db), now);
  const service = new TimeKeeperService(repository, { now });
  return repository.transaction(() => {
    let created = 0;
    const state = catalog.getCatalog();
    const task = state.taskTypes.find((item) => item.billableByDefault) ?? state.taskTypes[0];
    if (!task) throw new Error("Initialize the workspace task types before loading samples");
    for (const client of sampleClients) {
      const clientId = `${sampleNamespace}:${client.key}:client`;
      const caseId = `${sampleNamespace}:${client.key}:case`;
      const existingClient = state.clients.find((item) => item.id === clientId);
      if (existingClient && !existingClient.name.startsWith("[Sample]"))
        throw new Error("Sample client ID belongs to an unlabelled record; import cancelled");
      if (!existingClient)
        catalog.createClient({
          id: clientId,
          name: client.name,
          type: ClientType.Company,
          hourlyRateCents: client.rate,
        });
      const existingCase = state.cases.find((item) => item.id === caseId);
      if (existingCase && existingCase.clientId !== clientId)
        throw new Error("Sample case ID belongs to another client; import cancelled");
      if (!existingCase)
        catalog.createCase({
          id: caseId,
          clientId,
          reference: `SAMPLE-${client.key.toUpperCase()}`,
          title: `[Sample] ${client.key === "atlas" ? "Commercial advice" : "Contract review"}`,
          hourlyRateCents: client.rate,
          budgetCents: client.budget,
          openedOn: plan.previousDay,
        });
      for (const period of plan.periods.filter((item) => item.clientKey === client.key)) {
        // Preserve later human corrections, validation, and billing on repeated imports.
        const existing = repository.period(period.id);
        if (existing) {
          if (existing.sessionId !== period.sessionId || existing.initialCaseId !== caseId)
            throw new Error("Sample period ID collision; import cancelled");
          continue;
        }
        if (repository.session(period.sessionId))
          throw new Error("Incomplete sample session exists; inspect it before importing");
        // Historical fixture sessions are inserted closed. Calling start() here could
        // reuse the lawyer's active session. All period writes use application services.
        repository.insertSession(
          {
            id: period.sessionId,
            startedAt: period.startedAt,
            endedAt: period.endedAt,
            revision: 0,
          },
          now(),
        );
        service.openPeriod({
          id: period.id,
          sessionId: period.sessionId,
          caseId,
          startedAt: period.startedAt,
          origin: AssignmentOrigin.Lawyer,
          mode: PeriodOpenMode.Recovery,
        });
        service.setDurationOverride(period.id, period.durationMs);
        service.updatePeriodDetails(period.id, {
          taskTypeId: task.id,
          label: "[Sample] Explicit fictional work for comparison preview",
          billable: true,
        });
        // Current-day preview periods stay unvalidated, just like real work.
        if (period.day < plan.today) service.validatePeriod(period.id);
        if (period.billed) service.setBillingStatus(period.id, BillingStatus.Billed);
        created++;
      }
    }
    const sources = service.allSources();
    const incompleteUnrelated = service.allPeriods().filter((period) => {
      if (period.id.startsWith(sampleNamespace) || period.caseId === null || period.excluded)
        return false;
      const linked = sources.filter((source) => source.workPeriodId === period.id);
      return (
        (period.durationOverrideMs ?? period.detectedDurationMs) === null ||
        linked.some((source) => source.availabilityStatus !== AvailabilityStatus.Available) ||
        (period.durationOverrideMs === null && !linked.length)
      );
    }).length;
    return { created, skipped: plan.periods.length - created, incompleteUnrelated };
  });
}
