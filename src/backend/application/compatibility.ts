import { calendarDay, isCalendarDay } from "../../shared/dates.js";
import { formatInvoiceCsv } from "./invoice-csv.js";
import { decision } from "../domain/recognition.js";
import type {
  CompatibilityPort,
  CompatibilityRow,
  CompatibilityTable,
} from "../ports/compatibility.js";
import type { AssignmentPort } from "../ports/assignment.js";
import type { PeriodRecord } from "../ports/repository.js";
import { updateTimeEntry } from "./assignment.js";
import {
  buildCaseSourcePack,
  type SourcePackScope,
  type SourcePackFilters,
} from "./source-pack.js";
import { CatalogService } from "./catalog.js";
import { SourceExportService } from "./source-export.js";
import { changePeriod, effectiveDuration, validateTime } from "../domain/rules.js";
import { AppError, TimeKeeperService } from "./service.js";

const currentDate = () => calendarDay(new Date());
const inputDate = (value: unknown) => {
  if (value === undefined || value === null) return currentDate();
  if (typeof value !== "string" || !isCalendarDay(value))
    throw new AppError("invalid-request", "date must be a valid calendar day");
  return value;
};
const required = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") throw Error(`${label} is required`);
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
      translated = value === "closed" ? "archived" : "active";
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
  ) {}

  private get(table: CompatibilityTable, id: number | string): CompatibilityRow {
    const result = this.port.get(table, id);
    if (!result) throw Error("Not found");
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
    if (!period) throw Error("Canonical work period not found");
    return period;
  }

  private saveEntryPeriod(
    entry: CompatibilityRow,
    options: { validate?: boolean; unvalidate?: boolean } = {},
  ) {
    const prior = this.periodForEntry(entry);
    if (prior.billingStatus === "billed" || prior.invoiceId !== null)
      throw Error("Billed work period cannot be edited");
    const caseId = entry.matter_id == null ? null : String(entry.matter_id);
    if (caseId !== prior.caseId)
      throw new AppError("conflict", "compatibility assignment is out of sync");
    let next = prior;
    if (options.unvalidate)
      next = { ...next, validatedEffectiveRevision: null, timeValidatedAt: null };
    if (options.validate) {
      if (caseId === null || effectiveDuration(next) === null)
        throw Error("Case and duration required for approval");
      next = validateTime(next, new Date().toISOString());
    }
    next = {
      ...next,
      taskTypeId: entry.task_id == null ? null : Number(entry.task_id),
      label: String(entry.label),
      billable: Boolean(entry.billable),
      nonbillableReason: entry.reason as string | null,
      revision: prior.revision + 1,
    };
    this.port.saveCanonicalPeriod(next, new Date().toISOString());
    return next;
  }

  updateEntry(id: number, body: Record<string, unknown>, assignment: AssignmentPort) {
    return this.port.transaction(() => {
      const before = this.get("time_entry", id);
      const prior = this.periodForEntry(before);
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
          "lawyer",
        );
      }
      const {
        expected_assignment_revision: _revision,
        expected_effective_revision: _effective,
        ...legacyBody
      } = body;
      const after = updateTimeEntry(
        { ...assignment, transaction: (work) => work() },
        id,
        legacyBody,
      );
      const changedCase =
        "matter_id" in body &&
        (after.matter_id == null ? null : String(after.matter_id)) !== prior.caseId;
      this.saveEntryPeriod(after, {
        validate: body.review_status === "approved",
        unvalidate: body.review_status === "to_review",
      });
      if (changedCase && body.review_status !== "approved")
        this.port.update("time_entry", id, { review_status: "to_review" });
      return this.get("time_entry", id);
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
          this.port.update("time_entry", Number(entry.id), { review_status: "approved" });
          this.saveEntryPeriod(this.get("time_entry", Number(entry.id)), { validate: true });
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
        this.port.update("time_entry", Number(entry.id), { review_status: "approved" });
        this.saveEntryPeriod(this.get("time_entry", Number(entry.id)), { validate: true });
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
    if (entry.billing_status === "billed" || !entry.block_id)
      throw Error("Block cannot be discarded");
    return this.port.transaction(() => {
      const period = this.periodForEntry(entry);
      if (period.billingStatus === "billed" || period.invoiceId !== null)
        throw Error("Billed work period cannot be discarded");
      const block = this.port.update("block", Number(entry.block_id), { state: "discarded" });
      this.port.saveCanonicalPeriod(
        { ...period, excluded: true, revision: period.revision + 1 },
        new Date().toISOString(),
      );
      for (const question of this.port.pendingQuestions(period.id))
        this.port.saveQuestion({ ...question, status: "superseded" });
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
    const block = this.get("block", id);
    if (
      block.state !== "discarded" ||
      this.port.rows("time_entry").some((entry) => entry.block_id === block.id)
    )
      throw Error("Block cannot be recovered");
    return this.port.transaction(() => {
      const task = this.port.rows("task").find((item) => item.code === "RECH");
      if (!task) throw Error("Recovery task missing");
      const entry = this.port.insert("time_entry", {
        block_id: block.id,
        matter_id: null,
        task_id: task.id,
        date: block.date,
        tenths_of_hour: Math.max(1, Math.round(Number(block.minutes) / 6)),
        label: `${block.app} · ${block.window_title}`,
        amount_cents: 0,
        rate_origin: "base",
        billable: true,
        reason: null,
        review_status: "to_review",
        billing_status: "to_bill",
        invoice_id: null,
      });
      this.port.update("block", id, { state: "to_check" });
      const period = this.port.canonicalPeriodForBlock(id);
      if (!period) throw Error("Canonical work period not found");
      if (period.caseId !== null)
        this.port.update("time_entry", Number(entry.id), { matter_id: period.caseId });
      this.port.update("block", id, {
        state: period.caseId ? "assigned" : "to_check",
        matter_id: period.caseId,
      });
      const next = {
        ...period,
        excluded: false,
        taskTypeId: Number(task.id),
        label: String(entry.label),
        billable: true,
        revision: period.revision + 1,
      };
      this.port.saveCanonicalPeriod(next, new Date().toISOString());
      if (next.caseId === null)
        this.core.askQuestion({
          questionId: `recovered-period-question-${next.id}-${next.assignmentRevision}`,
          sessionId: next.sessionId,
          periodId: next.id,
          expectedAssignmentRevision: next.assignmentRevision,
        });
      this.port.audit("Block recovered", "", "to assign", Number(entry.id), id);
      return this.get("time_entry", Number(entry.id));
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
        date: inputDate(body.date),
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
      if (item.invoice_id) throw Error("Expense already billed");
      this.port.assertExpenseCanBeRemoved(item);
      this.port.delete("expense", id);
      this.port.audit("Expense removed", JSON.stringify(item));
      return { deleted: true };
    });
  }

  invoiceCsv(id: number) {
    const invoice = this.port.invoiceExport(id);
    if (!invoice) throw Error("Not found");
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
    if (!entry.block_id) throw Error("Not found");
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
        date: inputDate(body.date),
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
    if (!Number.isInteger(minutes) || minutes < 1) throw Error("Invalid duration");
    return this.port.transaction(() => {
      const entry = this.port.rows("time_entry").find((item) => item.block_id === block.id);
      if (!entry || entry.billing_status === "billed") throw Error("Block cannot be closed");
      const before = Number(entry.tenths_of_hour);
      this.port.update("time_entry", Number(entry.id), {
        tenths_of_hour: before + Math.max(1, Math.round(minutes / 6)),
      });
      this.port.update("block", id, {
        minutes: Number(block.minutes) + minutes,
        state: "assigned",
      });
      const period = this.periodForEntry(entry);
      if (period.billingStatus === "billed" || period.invoiceId !== null)
        throw Error("Billed work period cannot be closed");
      const next = {
        ...changePeriod(period, {
          detectedDurationMs: (period.detectedDurationMs ?? 0) + minutes * 60000,
        }),
        revision: period.revision + 1,
      };
      this.port.saveCanonicalPeriod(next, new Date().toISOString());
      if (next.effectiveRevision !== period.effectiveRevision)
        this.port.update("time_entry", Number(entry.id), { review_status: "to_review" });
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
