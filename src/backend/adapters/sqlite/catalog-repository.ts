import type { DatabaseSync } from "node:sqlite";
import { asc, eq, sql } from "drizzle-orm";
import { orm } from "./orm.js";
import * as t from "./tables.js";
import { transaction } from "./transaction.js";
import type {
  CatalogCase,
  CatalogClient,
  CatalogClientRule,
  CatalogMarker,
  CatalogPort,
  CatalogSettings,
  CatalogTaskType,
} from "../../ports/catalog.js";

function settings(row: typeof t.settings.$inferSelect): CatalogSettings {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    globalHourlyRateCents: row.global_hourly_rate_cents,
    currency: row.currency,
    lawyerName: row.lawyer_name ?? "",
    address: row.address ?? "",
    vatNumber: row.vat_number ?? "",
    baseUnit: row.base_unit as CatalogSettings["baseUnit"],
    vatRate: row.vat_rate,
    confidenceThreshold: row.confidence_threshold,
    excludedApps: row.excluded_apps,
    captureRetention: row.capture_retention,
    notifications: Boolean(row.notifications),
    pillPosition: row.pill_position,
    pillAlwaysOnTop: Boolean(row.pill_always_on_top),
    pillDisplay: row.pill_display as CatalogSettings["pillDisplay"],
    pillWithholdCalls: Boolean(row.pill_withhold_calls),
    invoicePrefix: row.invoice_prefix,
    nextNumber: row.next_number,
  };
}
function client(row: typeof t.clients.$inferSelect): CatalogClient {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    active: Boolean(row.active),
    type: row.type as CatalogClient["type"],
    mode: row.mode as CatalogClient["mode"],
    hourlyRateCents: row.hourly_rate_cents,
    vatApplicable: Boolean(row.vat_applicable),
    billingAddress: row.billing_address,
  };
}
function legalCase(row: typeof t.cases.$inferSelect): CatalogCase {
  return {
    id: row.id,
    clientId: row.client_id,
    reference: row.reference,
    title: row.title,
    hourlyRateCents: row.hourly_rate_cents,
    status: row.status as CatalogCase["status"],
    category: row.category,
    caseNumber: row.case_number,
    opposingParty: row.opposing_party,
    mode: row.mode as CatalogCase["mode"],
    flatFeeCents: row.flat_fee_cents,
    hourCap: row.hour_cap,
    successFeePercent: row.success_fee_percent,
    budgetCents: row.budget_cents,
    openedOn: row.opened_on,
  };
}
function taskType(row: typeof t.task_types.$inferSelect): CatalogTaskType {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    billableByDefault: Boolean(row.billable_by_default),
    offScreen: Boolean(row.off_screen),
    sortOrder: row.sort_order,
  };
}
function marker(row: typeof t.markers.$inferSelect): CatalogMarker {
  return {
    id: row.id,
    caseId: row.case_id,
    type: row.type as CatalogMarker["type"],
    value: row.value,
    weight: row.weight,
    learned: Boolean(row.learned),
    hits: row.hits,
    lastSeenAt: row.last_seen_at,
  };
}
function clientRule(row: typeof t.client_rules.$inferSelect): CatalogClientRule {
  return {
    id: row.id,
    clientId: row.client_id,
    type: row.type as CatalogClientRule["type"],
    value: row.value,
    label: row.label,
  };
}
const flag = (value: boolean | undefined) => (value === undefined ? undefined : value ? 1 : 0);
function clientValues(value: Partial<CatalogClient>) {
  return {
    name: value.name,
    code: value.code,
    active: flag(value.active),
    type: value.type,
    mode: value.mode,
    hourly_rate_cents: value.hourlyRateCents,
    vat_applicable: flag(value.vatApplicable),
    billing_address: value.billingAddress,
  };
}
function caseValues(value: Partial<CatalogCase>) {
  return {
    client_id: value.clientId,
    title: value.title,
    hourly_rate_cents: value.hourlyRateCents,
    status: value.status,
    category: value.category,
    case_number: value.caseNumber,
    opposing_party: value.opposingParty,
    mode: value.mode,
    flat_fee_cents: value.flatFeeCents,
    hour_cap: value.hourCap,
    success_fee_percent: value.successFeePercent,
    budget_cents: value.budgetCents,
    opened_on: value.openedOn,
  };
}
function taskValues(value: Partial<CatalogTaskType>) {
  return {
    code: value.code,
    label: value.label,
    billable_by_default: flag(value.billableByDefault),
    off_screen: flag(value.offScreen),
    sort_order: value.sortOrder,
  };
}

/** Typed catalogue persistence reads canonical tables without legacy projections. */
export function catalogRepository(db: DatabaseSync): CatalogPort {
  const query = orm(db);
  const readSettings = () => {
    const row = query.select().from(t.settings).where(eq(t.settings.id, 1)).get();
    if (!row) throw Error("workspace settings missing");
    return settings(row);
  };
  return {
    transaction: (work) => transaction(db, work),
    state: () => ({
      settings: readSettings(),
      clients: query
        .select()
        .from(t.clients)
        .orderBy(asc(t.clients.name), asc(t.clients.id))
        .all()
        .map(client),
      cases: query
        .select()
        .from(t.cases)
        .orderBy(asc(t.cases.reference), asc(t.cases.id))
        .all()
        .map(legalCase),
      taskTypes: query
        .select()
        .from(t.task_types)
        .orderBy(asc(t.task_types.sort_order), asc(t.task_types.id))
        .all()
        .map(taskType),
      markers: query.select().from(t.markers).orderBy(asc(t.markers.id)).all().map(marker),
      clientRules: query
        .select()
        .from(t.client_rules)
        .orderBy(asc(t.client_rules.id))
        .all()
        .map(clientRule),
    }),
    client(id) {
      const row = query.select().from(t.clients).where(eq(t.clients.id, id)).get();
      return row && client(row);
    },
    case(id) {
      const row = query.select().from(t.cases).where(eq(t.cases.id, id)).get();
      return row && legalCase(row);
    },
    taskType(id) {
      const row = query.select().from(t.task_types).where(eq(t.task_types.id, id)).get();
      return row && taskType(row);
    },
    marker(id) {
      const row = query.select().from(t.markers).where(eq(t.markers.id, id)).get();
      return row && marker(row);
    },
    clientRule(id) {
      const row = query.select().from(t.client_rules).where(eq(t.client_rules.id, id)).get();
      return row && clientRule(row);
    },
    createClient(value, at) {
      return client(
        query
          .insert(t.clients)
          .values({
            id: value.id,
            created_at: at,
            updated_at: at,
            ...clientValues(value),
          } as typeof t.clients.$inferInsert)
          .returning()
          .get(),
      );
    },
    updateClient(id, patch, at) {
      return client(
        query
          .update(t.clients)
          .set({ ...clientValues(patch), updated_at: at })
          .where(eq(t.clients.id, id))
          .returning()
          .get(),
      );
    },
    createCase(value, at) {
      return legalCase(
        query
          .insert(t.cases)
          .values({
            id: value.id,
            reference: value.reference,
            created_at: at,
            updated_at: at,
            ...caseValues(value),
          } as typeof t.cases.$inferInsert)
          .returning()
          .get(),
      );
    },
    updateCase(id, patch, at) {
      return legalCase(
        query
          .update(t.cases)
          .set({ ...caseValues(patch), updated_at: at })
          .where(eq(t.cases.id, id))
          .returning()
          .get(),
      );
    },
    updateSettings(value, at) {
      query
        .update(t.settings)
        .set({
          workspace_id: value.workspaceId,
          global_hourly_rate_cents: value.globalHourlyRateCents,
          currency: value.currency,
          lawyer_name: value.lawyerName,
          address: value.address,
          vat_number: value.vatNumber,
          base_unit: value.baseUnit,
          vat_rate: value.vatRate,
          confidence_threshold: value.confidenceThreshold,
          excluded_apps: value.excludedApps,
          capture_retention: value.captureRetention,
          notifications: flag(value.notifications),
          pill_position: value.pillPosition,
          pill_always_on_top: flag(value.pillAlwaysOnTop),
          pill_display: value.pillDisplay,
          pill_withhold_calls: flag(value.pillWithholdCalls),
          invoice_prefix: value.invoicePrefix,
          next_number: value.nextNumber,
          updated_at: at,
        })
        .where(eq(t.settings.id, 1))
        .run();
      return readSettings();
    },
    createTaskType(value) {
      return taskType(
        query
          .insert(t.task_types)
          .values(taskValues(value) as typeof t.task_types.$inferInsert)
          .returning()
          .get(),
      );
    },
    updateTaskType(id, patch) {
      return taskType(
        query
          .update(t.task_types)
          .set(taskValues(patch))
          .where(eq(t.task_types.id, id))
          .returning()
          .get(),
      );
    },
    createMarker(value) {
      return marker(
        query
          .insert(t.markers)
          .values({
            case_id: value.caseId,
            type: value.type,
            value: value.value,
            weight: value.weight,
            learned: value.learned ? 1 : 0,
            hits: value.hits,
            last_seen_at: value.lastSeenAt,
          })
          .returning()
          .get(),
      );
    },
    removeMarker(id) {
      query.delete(t.markers).where(eq(t.markers.id, id)).run();
    },
    createClientRule(value) {
      return clientRule(
        query
          .insert(t.client_rules)
          .values({
            client_id: value.clientId,
            type: value.type,
            value: value.value,
            label: value.label,
          })
          .returning()
          .get(),
      );
    },
    removeClientRule(id) {
      query.delete(t.client_rules).where(eq(t.client_rules.id, id)).run();
    },
    lastCaseSequence(year) {
      const prefix = `${year}-`;
      return query
        .select({ reference: t.cases.reference })
        .from(t.cases)
        .all()
        .reduce((last, row) => {
          const match = row.reference.startsWith(prefix)
            ? /^\d{4}-(\d{3})-/.exec(row.reference)
            : null;
          return match ? Math.max(last, Number(match[1])) : last;
        }, 0);
    },
    audit(action, before, after, at) {
      query
        .insert(t.audit_events)
        .values({ work_period_id: null, timestamp: at, actor: "Lawyer", action, before, after })
        .run();
    },
    auditEvents() {
      return query
        .select({
          id: t.audit_events.id,
          periodId: t.audit_events.work_period_id,
          timestamp: t.audit_events.timestamp,
          actor: t.audit_events.actor,
          action: t.audit_events.action,
          before: t.audit_events.before,
          after: t.audit_events.after,
        })
        .from(t.audit_events)
        .orderBy(sql`julianday(${t.audit_events.timestamp})`, asc(t.audit_events.id))
        .all();
    },
  };
}

export function readCatalog(db: DatabaseSync) {
  const repository = catalogRepository(db);
  return repository.transaction(() => repository.state());
}
