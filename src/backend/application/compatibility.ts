import {
  type NonbillableReason,
  AssignmentOrigin,
  BillingStatus,
  CaseStatus,
} from "../domain/states.js";
import { calendarDay, isCalendarDay } from "../../shared/dates.js";
import { formatInvoiceCsv } from "./invoice-csv.js";
import { decision } from "../domain/recognition.js";
import type {
  CompatibilityPort,
  CompatibilityRow,
  CompatibilityTable,
} from "../ports/compatibility.js";
import type { Clock } from "../ports/index.js";
import type { PeriodRecord } from "../ports/repository.js";
import {
  buildCaseSourcePack,
  type SourcePackScope,
  type SourcePackFilters,
} from "./source-pack.js";
import { CatalogService } from "./catalog.js";
import { SourceExportService } from "./source-export.js";
import { AppError } from "./errors.js";
import { TimeKeeperService } from "./service.js";

const inputDate = (value: unknown, at: string) => {
  if (value === undefined || value === null) return calendarDay(at);
  if (typeof value !== "string" || !isCalendarDay(value))
    throw new AppError("invalid-request", "date must be a valid calendar day");
  return value;
};
const required = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "")
    throw new AppError("invalid-request", `${label} is required`);
  return value;
};

const clientFields = {
  name: "name",
  code: "code",
  type: "type",
  mode: "mode",
  rate_cents: "hourlyRateCents",
  vat_applicable: "vatApplicable",
  billing_address: "billingAddress",
};
const caseFields = {
  client_id: "clientId",
  title: "title",
  category: "category",
  case_number: "caseNumber",
  opposing_party: "opposingParty",
  mode: "mode",
  own_rate_cents: "hourlyRateCents",
  flat_fee_cents: "flatFeeCents",
  hour_cap: "hourCap",
  success_fee_percent: "successFeePercent",
  budget_cents: "budgetCents",
  status: "status",
  opened_on: "openedOn",
};
const taskFields = {
  code: "code",
  label: "label",
  billable_by_default: "billableByDefault",
  off_screen: "offScreen",
  sort_order: "sortOrder",
};
const firmFields = {
  lawyer_name: "lawyerName",
  address: "address",
  vat_number: "vatNumber",
  base_rate_cents: "globalHourlyRateCents",
  base_unit: "baseUnit",
  vat_rate: "vatRate",
  currency: "currency",
};
const settingFields = {
  confidence_threshold: "confidenceThreshold",
  excluded_apps: "excludedApps",
  capture_retention: "captureRetention",
  notifications: "notifications",
  pill_position: "pillPosition",
  pill_always_on_top: "pillAlwaysOnTop",
  pill_display: "pillDisplay",
  pill_withhold_calls: "pillWithholdCalls",
  invoice_prefix: "invoicePrefix",
  next_number: "nextNumber",
};
function translate(body: Record<string, unknown>, fields: Record<string, string>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(fields, key)) throw new AppError("invalid-request", `unknown field: ${key}`);
    let translated = value;
    if (key === "client_id" || key === "matter_id") {
      if (
        typeof value !== "string" &&
        !(typeof value === "number" && Number.isSafeInteger(value) && value > 0)
      )
        throw new AppError("invalid-request", "invalid catalog ID");
      translated = String(value);
    }
    if (key === "status" && fields === caseFields) {
      if (value !== "open" && value !== "closed")
        throw new AppError("invalid-request", "invalid case status");
      translated = value === "closed" ? CaseStatus.Archived : CaseStatus.Active;
    }
    result[fields[key]!] = translated;
  }
  return result;
}

export class CompatibilityApiService {
  constructor(
    private readonly port: CompatibilityPort,
    private readonly core: TimeKeeperService,
    private readonly catalog: CatalogService,
    private readonly exports: SourceExportService,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  private get(table: CompatibilityTable, id: number | string): CompatibilityRow {
    const result = this.port.get(table, id);
    if (!result) throw new AppError("not-found", "resource not found");
    return result;
  }

  state(date?: string, clientId?: string, caseId?: string) {
    const full = this.port.state();
    if (!date && !clientId && !caseId) return full;
    const allowedCases = new Set(
      full.matter
        .filter((matter) => !clientId || String(matter.client_id) === clientId)
        .map((matter) => matter.id),
    );
    const entries = full.time_entry.filter(
      (entry) =>
        (!date || entry.date === date) &&
        (!clientId || (entry.matter_id !== null && allowedCases.has(entry.matter_id))) &&
        (!caseId || String(entry.matter_id) === caseId),
    );
    const entryIds = new Set(entries.map((entry) => entry.id));
    const blockIds = new Set(
      entries.map((entry) => entry.block_id).filter((id): id is number => id !== null),
    );
    return {
      ...full,
      time_entry: entries,
      block: full.block.filter((block) => blockIds.has(block.id)),
      source: full.source.filter(
        (source) => source.block_id !== null && blockIds.has(source.block_id),
      ),
      audit_event: full.audit_event.filter(
        (event) =>
          (event.time_entry_id !== null && entryIds.has(event.time_entry_id)) ||
          (event.block_id !== null && blockIds.has(event.block_id)),
      ),
      jev_review: full.jev_review.filter((review) => blockIds.has(review.block_id)),
      pause: full.pause.filter((pause) => !date || pause.date === date),
    };
  }

  searchCases(query: string) {
    const state = this.port.state();
    const norm = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US");
    const needle = norm(query.trim());
    if (!needle) return { clients: [], cases: [] };
    return {
      clients: state.client.filter((client) => norm(client.name).includes(needle)),
      cases: state.matter.filter((matter) =>
        [
          matter.title,
          matter.reference,
          matter.category,
          matter.opposing_party,
          state.client.find((client) => client.id === matter.client_id)?.name ?? "",
        ].some((value) => norm(value).includes(needle)),
      ),
    };
  }

  private editCatalog<T>(work: () => T): T {
    return this.port.transaction(work);
  }

  private periodForEntry(entry: CompatibilityRow): PeriodRecord {
    const period =
      entry.block_id == null
        ? this.port.canonicalPeriodForEntry(Number(entry.id))
        : this.port.canonicalPeriodForBlock(Number(entry.block_id));
    if (!period) throw new AppError("not-found", "canonical work period not found");
    return period;
  }

  updateEntry(id: number, body: Record<string, unknown>) {
    return this.port.transaction(() => {
      const before = this.get("time_entry", id);
      const prior = this.periodForEntry(before);
      const allowed = [
        "matter_id",
        "billable",
        "reason",
        "label",
        "review_status",
        "expected_assignment_revision",
        "expected_effective_revision",
      ];
      if (Object.keys(body).some((key) => !allowed.includes(key)))
        throw new AppError("invalid-request", "field not allowed");
      if (prior.billingStatus === BillingStatus.Billed || prior.invoiceId != null)
        throw new AppError("conflict", "billed period must be unbilled before editing");
      if (
        body.review_status !== undefined &&
        body.review_status !== "approved" &&
        body.review_status !== "to_review"
      )
        throw new AppError("invalid-request", "invalid review status");
      if (body.review_status === "approved")
        this.assertApprovalRevision(prior, body.expected_effective_revision);
      if ("matter_id" in body) {
        if (body.matter_id === null)
          throw new AppError("invalid-request", "use a period question to resolve or exclude work");
        if (
          !Number.isSafeInteger(body.expected_assignment_revision) ||
          body.expected_assignment_revision !== prior.assignmentRevision
        )
          throw new AppError("conflict", "stale assignment revision");
        this.core.assignPeriod(
          prior.id,
          String(body.matter_id),
          prior.assignmentRevision,
          AssignmentOrigin.Lawyer,
        );
      }
      const details = {
        ...("label" in body ? { label: body.label as string } : {}),
        ...("billable" in body ? { billable: body.billable as boolean } : {}),
        ...("reason" in body ? { nonbillableReason: body.reason as NonbillableReason | null } : {}),
      };
      if (Object.keys(details).length) this.core.updatePeriodDetails(prior.id, details);
      if (body.review_status === "approved") {
        // The supplied revision guards the pre-edit snapshot; assignment and validation
        // form one atomic legacy operation, so validate the resulting effective value.
        const current = this.core.getPeriod(prior.id);
        this.core.validatePeriod(prior.id, current.effectiveRevision);
      } else if (body.review_status === "to_review") this.core.clearTimeValidation(prior.id);
      if ("matter_id" in body && before.block_id != null)
        this.port.update("block", Number(before.block_id), {
          matter_id: body.matter_id,
          state: "assigned",
        });
      const after = this.get("time_entry", id);
      this.port.audit(
        "Time entry updated",
        JSON.stringify(before),
        JSON.stringify(after),
        id,
        before.block_id == null ? null : Number(before.block_id),
      );
      return after;
    });
  }

  private assertApprovalRevision(period: PeriodRecord, expected: unknown) {
    if (!Number.isSafeInteger(expected) || (expected as number) < 0)
      throw new AppError("invalid-request", "expected effective revision required");
    if (period.effectiveRevision !== expected)
      throw new AppError("conflict", "stale effective revision");
  }
  private assertApprovalMap(entries: CompatibilityRow[], expected: unknown) {
    if (!expected || typeof expected !== "object" || Array.isArray(expected))
      throw new AppError("invalid-request", "expected effective revisions required");
    for (const entry of entries) {
      const period = this.periodForEntry(entry);
      this.assertApprovalRevision(period, (expected as Record<string, unknown>)[period.id]);
    }
  }
  approveDay(date: string, expectedEffectiveRevisions: unknown) {
    return this.port.transaction(() => {
      this.assertApprovalMap(
        this.port
          .rows("time_entry")
          .filter(
            (item) => item.date === date && item.matter_id && item.review_status !== "approved",
          ),
        expectedEffectiveRevisions,
      );
      let approved = 0,
        unassigned = 0;
      for (const entry of this.port.rows("time_entry").filter((item) => item.date === date)) {
        if (!entry.matter_id) {
          unassigned++;
          continue;
        }
        if (entry.review_status !== "approved") {
          const period = this.periodForEntry(entry);
          this.core.validatePeriod(period.id, period.effectiveRevision);
          this.port.audit(
            "Time entry approved",
            "to_review",
            "approved",
            Number(entry.id),
            entry.block_id as number | null,
          );
          approved++;
        }
      }
      return { approved, unassigned };
    });
  }

  approveCase(id: number | string, expectedEffectiveRevisions: unknown) {
    this.get("matter", id);
    return this.port.transaction(() => {
      this.assertApprovalMap(
        this.port
          .rows("time_entry")
          .filter(
            (item) => String(item.matter_id) === String(id) && item.review_status !== "approved",
          ),
        expectedEffectiveRevisions,
      );
      let approved = 0;
      for (const entry of this.port
        .rows("time_entry")
        .filter(
          (item) => String(item.matter_id) === String(id) && item.review_status !== "approved",
        )) {
        const period = this.periodForEntry(entry);
        this.core.validatePeriod(period.id, period.effectiveRevision);
        this.port.audit(
          "Time entry approved",
          "to_review",
          "approved",
          Number(entry.id),
          entry.block_id as number | null,
        );
        approved++;
      }
      return { approved };
    });
  }

  discardEntry(id: number) {
    const entry = this.get("time_entry", id);
    if (entry.billing_status === BillingStatus.Billed || !entry.block_id)
      throw new AppError("invalid-request", "Block cannot be discarded");
    return this.port.transaction(() => {
      const period = this.periodForEntry(entry);
      if (period.billingStatus === BillingStatus.Billed || period.invoiceId !== null)
        throw new AppError("invalid-request", "Billed work period cannot be discarded");
      const block = this.port.update("block", Number(entry.block_id), { state: "discarded" });
      this.core.updatePeriodDetails(period.id, { excluded: true }, period.revision);
      this.port.delete("time_entry", id);
      this.port.audit(
        "Block discarded",
        String(entry.label),
        "not counted",
        null,
        Number(entry.block_id),
      );
      return block;
    });
  }

  recoverBlock(id: number) {
    return this.port.transaction(() => {
      const block = this.get("block", id);
      const period = this.port.canonicalPeriodForBlock(id);
      if (!period) throw new AppError("not-found", "canonical work period not found");
      if (block.state !== "discarded" || !period.excluded)
        throw new AppError("invalid-request", "Block cannot be recovered");
      this.core.updatePeriodDetails(period.id, { excluded: false }, period.revision);
      const entryId = this.port.ensureCompatibilityEntryId(period.id);
      this.port.audit("Block recovered", "", "restored", entryId, id);
      return this.get("time_entry", entryId);
    });
  }

  createCase(body: Record<string, unknown>) {
    const value = this.catalog.createCase(translate(body, caseFields));
    return this.get("matter", value.id);
  }
  addMarker(body: Record<string, unknown>) {
    const value = this.catalog.createMarker(
      translate(body, {
        matter_id: "caseId",
        type: "type",
        value: "value",
        weight: "weight",
      }),
    );
    return this.get("marker", value.id);
  }
  removeMarker(id: number) {
    return this.catalog.removeMarker(id);
  }

  addExpense(body: Record<string, unknown>) {
    return this.port.transaction(() => {
      const item = this.port.insert("expense", {
        matter_id: body.matter_id,
        date: inputDate(body.date, this.clock.now()),
        label: required(body.label, "Label"),
        type: body.type,
        amount_cents: body.amount_cents,
        invoice_id: null,
      });
      this.port.insertCanonicalExpense(item);
      this.port.audit("Expense added", "", JSON.stringify(item));
      return item;
    });
  }

  removeExpense(id: number) {
    return this.port.transaction(() => {
      const item = this.get("expense", id);
      if (item.invoice_id) throw new AppError("invalid-request", "Expense already billed");
      this.port.assertExpenseCanBeRemoved(item);
      this.port.delete("expense", id);
      this.port.audit("Expense removed", JSON.stringify(item));
      return { deleted: true };
    });
  }

  invoiceCsv(id: number) {
    const invoice = this.port.invoiceExport(id);
    if (!invoice) throw new AppError("not-found", "resource not found");
    return { csv: formatInvoiceCsv(invoice) };
  }

  recognition(id: number) {
    const block = this.get("block", id);
    const threshold = Number(this.get("setting", 1).confidence_threshold);
    const candidates = this.port.recognition(block);
    return { block_id: block.id, threshold, decision: decision(candidates, threshold), candidates };
  }

  timeEntrySourceDetails(id: number) {
    const entry = this.get("time_entry", id);
    if (!entry.block_id) throw new AppError("not-found", "resource not found");
    const block = this.get("block", Number(entry.block_id));
    return {
      time_entry: entry,
      block,
      sources: this.port
        .rows("source")
        .filter((item) => item.block_id === block.id)
        .map(({ work_period_id: _period, ...source }) => source),
      jev_reviews: this.port.rows("jev_review").filter((item) => item.block_id === block.id),
      audit: this.port
        .rows("audit_event")
        .filter((item) => item.time_entry_id === entry.id || item.block_id === block.id),
    };
  }

  exportSources(id: number, options: string[]) {
    return this.port.transaction(() => {
      const entry = this.get("time_entry", id);
      const block = entry.block_id ? this.get("block", Number(entry.block_id)) : null;
      const pack = {
        time_entry: entry,
        block,
        sources: this.port.rows("source").filter((item) => item.block_id === block?.id),
        audit: this.port.rows("audit_event").filter((item) => item.time_entry_id === entry.id),
        options,
      };
      const period = this.periodForEntry(entry);
      const receipt = this.exports.recordReceipt(JSON.stringify(pack), [period.id], options);
      return this.get("source_export", receipt.id);
    });
  }

  exportCaseSources(
    id: number | string,
    scope: SourcePackScope,
    options: string[],
    filters: SourcePackFilters,
  ) {
    const matter = this.get("matter", id);
    return this.port.transaction(() => {
      const periods = this.core
        .allPeriods()
        .filter((period) => period.caseId === String(id) && !period.excluded);
      const compatibilityEntryIds = new Map(
        periods.map((period) => [period.id, this.port.ensureCompatibilityEntryId(period.id)]),
      );
      const { payload, periodIds } = buildCaseSourcePack({
        caseId: id,
        clientId: String(matter.client_id),
        scope,
        options,
        filters,
        snapshot: this.port.state(),
        sourceRows: this.port.rows("source").map((source) => ({
          ...source,
          work_period_id: source.work_period_id == null ? null : String(source.work_period_id),
          block_id: source.block_id == null ? null : Number(source.block_id),
          type: String(source.type),
          excerpt: String(source.excerpt ?? ""),
          detected_marker: String(source.detected_marker ?? ""),
        })),
        periods,
        compatibilityEntryIds,
      });
      const receipt = this.exports.recordReceipt(payload, periodIds, [scope, ...options]);
      return { export: this.get("source_export", receipt.id), payload };
    });
  }

  addPause(body: Record<string, unknown>) {
    return this.port.transaction(() => {
      const item = this.port.insert("pause", {
        date: inputDate(body.date, this.clock.now()),
        start_time: required(body.start_time, "Start time"),
        end_time: null,
        origin: "button",
        reason: body.reason ?? "",
      });
      this.port.audit("Pause annotation recorded");
      return item;
    });
  }

  closePause(id: number, endTime: string) {
    return this.port.transaction(() => {
      const item = this.port.update("pause", id, { end_time: required(endTime, "End time") });
      this.port.audit("Pause annotation ended");
      return item;
    });
  }

  closeBlock(id: number, minutes: number) {
    const block = this.get("block", id);
    if (!Number.isInteger(minutes) || minutes < 1)
      throw new AppError("invalid-request", "Invalid duration");
    return this.port.transaction(() => {
      const entry = this.port.rows("time_entry").find((item) => item.block_id === block.id);
      if (!entry || entry.billing_status === BillingStatus.Billed)
        throw new AppError("invalid-request", "Block cannot be closed");
      const before = Number(entry.tenths_of_hour);
      this.port.update("block", id, {
        minutes: Number(block.minutes) + minutes,
        state: "assigned",
      });
      const period = this.periodForEntry(entry);
      if (period.billingStatus === BillingStatus.Billed || period.invoiceId !== null)
        throw new AppError("invalid-request", "Billed work period cannot be closed");
      this.core.setDetectedDuration(period.id, (period.detectedDurationMs ?? 0) + minutes * 60000);
      this.port.audit(
        "Block closed",
        String(before),
        String(this.get("time_entry", Number(entry.id)).tenths_of_hour),
        Number(entry.id),
        id,
        "TimeKeeper",
      );
      return this.get("time_entry", Number(entry.id));
    });
  }

  updateCatalog(
    table: "firm" | "setting" | "client" | "matter" | "task",
    id: number | string,
    body: Record<string, unknown>,
  ) {
    this.get(table, id);
    if (table === "client") this.catalog.updateClient(String(id), translate(body, clientFields));
    else if (table === "matter") this.catalog.updateCase(String(id), translate(body, caseFields));
    else if (table === "task") this.catalog.updateTaskType(Number(id), translate(body, taskFields));
    else
      this.catalog.updateSettings(translate(body, table === "firm" ? firmFields : settingFields));
    return this.get(table, id);
  }
  createClient(body: Record<string, unknown>) {
    const value = this.catalog.createClient(translate(body, clientFields));
    return this.get("client", value.id);
  }
  createTask(body: Record<string, unknown>) {
    const value = this.catalog.createTaskType(translate(body, taskFields));
    return this.get("task", value.id);
  }
  createClientRule(body: Record<string, unknown>) {
    const value = this.catalog.createClientRule(
      translate(body, {
        client_id: "clientId",
        type: "type",
        value: "value",
        label: "label",
      }),
    );
    return this.get("client_rule", value.id);
  }
  removeClientRule(id: number) {
    return this.catalog.removeClientRule(id);
  }
}
