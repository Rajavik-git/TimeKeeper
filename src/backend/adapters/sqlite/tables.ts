import {
  AssignmentOrigin,
  AvailabilityStatus,
  BaseUnit,
  BillingStatus,
  CaseBillingMode,
  CaseStatus,
  ClientBillingMode,
  ClientType,
  PillDisplay,
  ReconstructionStatus,
  ValidationStatus,
  assignmentOrigins,
  availabilityStatuses,
  baseUnits,
  billingStatuses,
  caseBillingModes,
  caseStatuses,
  clientBillingModes,
  clientRuleTypes,
  clientTypes,
  commandStatuses,
  deliveryStatuses,
  expenseTypes,
  invoiceLineOrigins,
  invoiceStatuses,
  invoiceTypes,
  markerTypes,
  pillDisplays,
  questionStatuses,
  reconstructionStatuses,
  retrievalStatuses,
  validationStatuses,
} from "../../domain/states.js";
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// Runtime query mappings. migrate.ts owns DDL, constraints, indexes and triggers.
export const assignment_deliveries = sqliteTable("assignment_deliveries", {
  id: text("id").primaryKey(),
  tag_target_id: text("tag_target_id").notNull(),
  target_revision: integer("target_revision").notNull(),
  intended_tags_json: text("intended_tags_json").notNull(),
  status: text("status", { enum: deliveryStatuses }).notNull(),
  attempts: integer("attempts")
    .notNull()
    .default(sql`0`),
  next_retry_at: text("next_retry_at"),
  acknowledged_at: text("acknowledged_at"),
});

export const audit_event = sqliteTable("audit_event", {
  id: integer("id").primaryKey(),
  time_entry_id: integer("time_entry_id"),
  block_id: integer("block_id"),
  timestamp: text("timestamp").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  before: text("before").notNull(),
  after: text("after").notNull(),
});

export const audit_events = sqliteTable("audit_events", {
  id: integer("id").primaryKey(),
  work_period_id: text("work_period_id"),
  timestamp: text("timestamp").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  before: text("before").notNull(),
  after: text("after").notNull(),
});

export const block = sqliteTable("block", {
  id: integer("id").primaryKey(),
  date: text("date").notNull(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time"),
  minutes: integer("minutes").notNull(),
  app: text("app").notNull(),
  window_title: text("window_title").notNull(),
  task_id: integer("task_id"),
  matter_id: integer("matter_id"),
  confidence: real("confidence").notNull(),
  state: text("state").notNull(),
  overlaps_block_id: integer("overlaps_block_id"),
});

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  client_id: text("client_id").notNull(),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  hourly_rate_cents: integer("hourly_rate_cents"),
  status: text("status", { enum: caseStatuses }).notNull().default(CaseStatus.Active),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  category: text("category")
    .notNull()
    .default(sql`''`),
  case_number: text("case_number")
    .notNull()
    .default(sql`''`),
  opposing_party: text("opposing_party")
    .notNull()
    .default(sql`''`),
  mode: text("mode", { enum: caseBillingModes }).notNull().default(CaseBillingMode.Hourly),
  flat_fee_cents: integer("flat_fee_cents"),
  hour_cap: real("hour_cap"),
  success_fee_percent: real("success_fee_percent"),
  budget_cents: integer("budget_cents"),
  opened_on: text("opened_on"),
});

export const client = sqliteTable("client", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  type: text("type").notNull(),
  mode: text("mode").notNull(),
  rate_cents: integer("rate_cents").notNull(),
  vat_applicable: integer("vat_applicable").notNull(),
  billing_address: text("billing_address").notNull(),
});

export const client_rule = sqliteTable("client_rule", {
  id: integer("id").primaryKey(),
  client_id: integer("client_id").notNull(),
  type: text("type").notNull(),
  value: integer("value").notNull(),
  label: text("label").notNull(),
});

export const client_rules = sqliteTable("client_rules", {
  id: integer("id").primaryKey(),
  client_id: text("client_id").notNull(),
  type: text("type", { enum: clientRuleTypes }).notNull(),
  value: integer("value").notNull(),
  label: text("label").notNull(),
});

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active")
    .notNull()
    .default(sql`1`),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  code: text("code"),
  type: text("type", { enum: clientTypes }).notNull().default(ClientType.Individual),
  mode: text("mode", { enum: clientBillingModes }).notNull().default(ClientBillingMode.Hourly),
  hourly_rate_cents: integer("hourly_rate_cents"),
  vat_applicable: integer("vat_applicable")
    .notNull()
    .default(sql`1`),
  billing_address: text("billing_address")
    .notNull()
    .default(sql`''`),
});

export const demo_block_periods = sqliteTable("demo_block_periods", {
  block_id: integer("block_id").primaryKey(),
  period_id: text("period_id").notNull(),
});

export const demo_period_entries = sqliteTable("demo_period_entries", {
  period_id: text("period_id").primaryKey(),
  entry_id: integer("entry_id").notNull(),
});

export const expense = sqliteTable("expense", {
  id: integer("id").primaryKey(),
  matter_id: integer("matter_id").notNull(),
  date: text("date").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(),
  amount_cents: integer("amount_cents").notNull(),
  invoice_id: integer("invoice_id"),
});

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey(),
  case_id: text("case_id").notNull(),
  date: text("date").notNull(),
  label: text("label").notNull(),
  type: text("type", { enum: expenseTypes }).notNull(),
  amount_cents: integer("amount_cents").notNull(),
  invoice_id: integer("invoice_id"),
});

export const firm = sqliteTable("firm", {
  id: integer("id").primaryKey(),
  lawyer_name: text("lawyer_name").notNull(),
  address: text("address").notNull(),
  vat_number: text("vat_number").notNull(),
  base_rate_cents: integer("base_rate_cents").notNull(),
  base_unit: text("base_unit").notNull(),
  vat_rate: real("vat_rate").notNull(),
});

export const invoice = sqliteTable("invoice", {
  id: integer("id").primaryKey(),
  matter_id: integer("matter_id").notNull(),
  number: text("number").notNull(),
  date: text("date").notNull(),
  type: text("type").notNull(),
  subtotal_cents: integer("subtotal_cents").notNull(),
  vat_cents: integer("vat_cents").notNull(),
  disbursements_cents: integer("disbursements_cents").notNull(),
  status: text("status").notNull(),
});

export const invoice_line = sqliteTable("invoice_line", {
  id: integer("id").primaryKey(),
  invoice_id: integer("invoice_id").notNull(),
  origin: text("origin").notNull(),
  origin_id: integer("origin_id").notNull(),
  label: text("label").notNull(),
  tenths_of_hour: integer("tenths_of_hour").notNull(),
  rate_cents: integer("rate_cents").notNull(),
  amount_cents: integer("amount_cents").notNull(),
  vat: integer("vat").notNull(),
});

export const invoice_lines = sqliteTable("invoice_lines", {
  id: integer("id").primaryKey(),
  invoice_id: integer("invoice_id").notNull(),
  origin: text("origin", { enum: invoiceLineOrigins }).notNull(),
  origin_id: text("origin_id").notNull(),
  label: text("label").notNull(),
  billed_minutes: integer("billed_minutes").notNull(),
  rate_cents: integer("rate_cents").notNull(),
  amount_cents: integer("amount_cents").notNull(),
  vat: integer("vat").notNull(),
  period_ids_json: text("period_ids_json"),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey(),
  case_id: text("case_id").notNull(),
  number: text("number").notNull(),
  date: text("date").notNull(),
  type: text("type", { enum: invoiceTypes }).notNull(),
  status: text("status", { enum: invoiceStatuses }).notNull(),
  subtotal_cents: integer("subtotal_cents"),
  vat_cents: integer("vat_cents"),
  disbursements_cents: integer("disbursements_cents"),
  total_cents: integer("total_cents"),
  snapshot_json: text("snapshot_json"),
  currency: text("currency"),
});

export const jev_review = sqliteTable("jev_review", {
  id: integer("id").primaryKey(),
  block_id: integer("block_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  probability: real("probability").notNull(),
  sent_data: text("sent_data").notNull(),
});

export const jev_reviews = sqliteTable("jev_reviews", {
  id: integer("id").primaryKey(),
  work_period_id: text("work_period_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  probability: real("probability").notNull(),
  sent_data: text("sent_data").notNull(),
});

export const marker = sqliteTable("marker", {
  id: integer("id").primaryKey(),
  matter_id: integer("matter_id").notNull(),
  type: text("type").notNull(),
  value: text("value").notNull(),
  weight: real("weight").notNull(),
  learned: integer("learned").notNull(),
  hits: integer("hits")
    .notNull()
    .default(sql`0`),
  last_seen_at: text("last_seen_at"),
});

export const markers = sqliteTable("markers", {
  id: integer("id").primaryKey(),
  case_id: text("case_id").notNull(),
  type: text("type", {
    enum: markerTypes,
  }).notNull(),
  value: text("value").notNull(),
  weight: real("weight").notNull(),
  learned: integer("learned")
    .notNull()
    .default(sql`0`),
  hits: integer("hits")
    .notNull()
    .default(sql`0`),
  last_seen_at: text("last_seen_at"),
});

export const matter = sqliteTable("matter", {
  id: integer("id").primaryKey(),
  client_id: integer("client_id").notNull(),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  case_number: text("case_number").notNull(),
  opposing_party: text("opposing_party").notNull(),
  mode: text("mode").notNull(),
  own_rate_cents: integer("own_rate_cents"),
  flat_fee_cents: integer("flat_fee_cents"),
  hour_cap: real("hour_cap"),
  success_fee_percent: real("success_fee_percent"),
  budget_cents: integer("budget_cents"),
  status: text("status").notNull(),
  opened_on: text("opened_on").notNull(),
});

export const pause = sqliteTable("pause", {
  id: integer("id").primaryKey(),
  date: text("date").notNull(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time"),
  origin: text("origin").notNull(),
  reason: text("reason").notNull(),
});

export const pending_questions = sqliteTable("pending_questions", {
  question_id: text("question_id").primaryKey(),
  session_id: text("session_id").notNull(),
  work_period_id: text("work_period_id").notNull(),
  expected_assignment_revision: integer("expected_assignment_revision").notNull(),
  status: text("status", { enum: questionStatuses }).notNull(),
  response_command_id: text("response_command_id"),
  response_result_json: text("response_result_json"),
});

export const processed_commands = sqliteTable("processed_commands", {
  producer_id: text("producer_id").notNull(),
  command_id: text("command_id").notNull(),
  kind: text("kind").notNull(),
  payload_fingerprint: text("payload_fingerprint").notNull(),
  session_id: text("session_id"),
  status: text("status", { enum: commandStatuses }).notNull(),
  prerequisite_id: text("prerequisite_id"),
  payload_json: text("payload_json").notNull(),
  result_json: text("result_json"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const reconstruction_conflicts = sqliteTable("reconstruction_conflicts", {
  id: text("id").primaryKey(),
  protected_period_id: text("protected_period_id").notNull(),
  expected_revision: integer("expected_revision").notNull(),
  proposed_started_at: text("proposed_started_at").notNull(),
  proposed_ended_at: text("proposed_ended_at"),
  source_references_json: text("source_references_json").notNull(),
  status: text("status", { enum: reconstructionStatuses })
    .notNull()
    .default(ReconstructionStatus.Pending),
});

export const retrieval_progress = sqliteTable("retrieval_progress", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  screenpipe_instance_id: text("screenpipe_instance_id").notNull(),
  requested_start_at: text("requested_start_at").notNull(),
  requested_end_at: text("requested_end_at").notNull(),
  cursor: text("cursor"),
  last_completed_at: text("last_completed_at"),
  status: text("status", { enum: retrievalStatuses }).notNull(),
});

export const schema_migrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
});

export const schema_version = sqliteTable("schema_version", {
  version: integer("version").primaryKey(),
  applied_on: text("applied_on").notNull(),
  description: text("description").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  started_at: text("started_at").notNull(),
  ended_at: text("ended_at"),
  revision: integer("revision")
    .notNull()
    .default(sql`0`),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const setting = sqliteTable("setting", {
  id: integer("id").primaryKey(),
  confidence_threshold: real("confidence_threshold").notNull(),
  excluded_apps: text("excluded_apps").notNull(),
  capture_retention: text("capture_retention").notNull(),
  notifications: integer("notifications").notNull(),
  pill_position: text("pill_position").notNull(),
  pill_always_on_top: integer("pill_always_on_top")
    .notNull()
    .default(sql`1`),
  pill_display: text("pill_display").notNull().default(PillDisplay.Fees),
  pill_withhold_calls: integer("pill_withhold_calls")
    .notNull()
    .default(sql`1`),
  invoice_prefix: text("invoice_prefix").notNull(),
  next_number: integer("next_number").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  global_hourly_rate_cents: integer("global_hourly_rate_cents").notNull(),
  currency: text("currency").notNull(),
  workspace_id: text("workspace_id").notNull(),
  updated_at: text("updated_at").notNull(),
  lawyer_name: text("lawyer_name"),
  address: text("address"),
  vat_number: text("vat_number"),
  base_unit: text("base_unit", { enum: baseUnits }).notNull().default(BaseUnit.Hour),
  vat_rate: real("vat_rate")
    .notNull()
    .default(sql`20`),
  confidence_threshold: real("confidence_threshold")
    .notNull()
    .default(sql`0.8`),
  excluded_apps: text("excluded_apps")
    .notNull()
    .default(sql`''`),
  capture_retention: text("capture_retention")
    .notNull()
    .default(sql`''`),
  notifications: integer("notifications")
    .notNull()
    .default(sql`1`),
  pill_position: text("pill_position")
    .notNull()
    .default(sql`'top'`),
  invoice_prefix: text("invoice_prefix")
    .notNull()
    .default(sql`'F-2026-'`),
  next_number: integer("next_number")
    .notNull()
    .default(sql`1`),
  pill_always_on_top: integer("pill_always_on_top")
    .notNull()
    .default(sql`1`),
  pill_display: text("pill_display", { enum: pillDisplays }).notNull().default(PillDisplay.Fees),
  pill_withhold_calls: integer("pill_withhold_calls")
    .notNull()
    .default(sql`1`),
});

export const source = sqliteTable("source", {
  id: integer("id").primaryKey(),
  block_id: integer("block_id").notNull(),
  type: text("type").notNull(),
  screenpipe_ref: text("screenpipe_ref").notNull(),
  timestamp: text("timestamp").notNull(),
  excerpt: text("excerpt").notNull(),
  detected_marker: text("detected_marker").notNull(),
  available: integer("available").notNull(),
});

export const source_export = sqliteTable("source_export", {
  id: integer("id").primaryKey(),
  time_entry_ids: text("time_entry_ids").notNull(),
  options: text("options").notNull(),
  sha256: text("sha256").notNull(),
  created_at: text("created_at").notNull(),
});

export const source_exports = sqliteTable("source_exports", {
  id: integer("id").primaryKey(),
  period_ids_json: text("period_ids_json").notNull(),
  options_json: text("options_json").notNull(),
  sha256: text("sha256").notNull(),
  created_at: text("created_at").notNull(),
  format_version: integer("format_version").notNull().default(1),
});

export const source_relocations = sqliteTable("source_relocations", {
  source_id: text("source_id").notNull(),
  from_period_id: text("from_period_id").notNull(),
  to_period_id: text("to_period_id").notNull(),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  work_period_id: text("work_period_id"),
  screenpipe_instance_id: text("screenpipe_instance_id").notNull(),
  content_type: text("content_type").notNull(),
  external_id: text("external_id").notNull(),
  tag_target_id: text("tag_target_id"),
  recorded_at: text("recorded_at").notNull(),
  ingested_at: text("ingested_at").notNull(),
  app_name: text("app_name"),
  window_name: text("window_name"),
  url: text("url"),
  validation_status: text("validation_status", { enum: validationStatuses })
    .notNull()
    .default(ValidationStatus.Unvalidated),
  validated_at: text("validated_at"),
  availability_status: text("availability_status", {
    enum: availabilityStatuses,
  })
    .notNull()
    .default(AvailabilityStatus.Unknown),
  availability_checked_at: text("availability_checked_at"),
  excerpt: text("excerpt"),
  detected_marker: text("detected_marker"),
});

export const tag_targets = sqliteTable("tag_targets", {
  id: text("id").primaryKey(),
  screenpipe_instance_id: text("screenpipe_instance_id").notNull(),
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  work_period_id: text("work_period_id"),
  target_revision: integer("target_revision")
    .notNull()
    .default(sql`0`),
});

export const task = sqliteTable("task", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  billable_by_default: integer("billable_by_default").notNull(),
  off_screen: integer("off_screen").notNull(),
  sort_order: integer("sort_order").notNull(),
});

export const task_types = sqliteTable("task_types", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  billable_by_default: integer("billable_by_default").notNull(),
  off_screen: integer("off_screen").notNull(),
  sort_order: integer("sort_order").notNull(),
});

export const time_entry = sqliteTable("time_entry", {
  id: integer("id").primaryKey(),
  block_id: integer("block_id"),
  matter_id: integer("matter_id"),
  task_id: integer("task_id").notNull(),
  date: text("date").notNull(),
  tenths_of_hour: integer("tenths_of_hour").notNull(),
  label: text("label").notNull(),
  amount_cents: integer("amount_cents").notNull(),
  rate_origin: text("rate_origin").notNull(),
  billable: integer("billable").notNull(),
  reason: text("reason"),
  review_status: text("review_status").notNull(),
  billing_status: text("billing_status").notNull(),
  invoice_id: integer("invoice_id"),
});

export const work_periods = sqliteTable("work_periods", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  case_id: text("case_id"),
  initial_case_id: text("initial_case_id"),
  initial_origin: text("initial_origin", { enum: assignmentOrigins }).notNull(),
  started_at: text("started_at").notNull(),
  ended_at: text("ended_at"),
  detected_duration_ms: integer("detected_duration_ms"),
  duration_override_ms: integer("duration_override_ms"),
  assignment_origin: text("assignment_origin", { enum: assignmentOrigins })
    .notNull()
    .default(AssignmentOrigin.Unresolved),
  time_validation_status: text("time_validation_status", { enum: validationStatuses })
    .notNull()
    .default(ValidationStatus.Unvalidated),
  effective_revision: integer("effective_revision")
    .notNull()
    .default(sql`0`),
  validated_effective_revision: integer("validated_effective_revision"),
  time_validated_at: text("time_validated_at"),
  billing_status: text("billing_status", { enum: billingStatuses })
    .notNull()
    .default(BillingStatus.Unbilled),
  billed_at: text("billed_at"),
  applied_hourly_rate_cents: integer("applied_hourly_rate_cents"),
  applied_currency: text("applied_currency"),
  revision: integer("revision")
    .notNull()
    .default(sql`0`),
  assignment_revision: integer("assignment_revision")
    .notNull()
    .default(sql`0`),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  task_type_id: integer("task_type_id"),
  label: text("label")
    .notNull()
    .default(sql`''`),
  billable: integer("billable")
    .notNull()
    .default(sql`1`),
  nonbillable_reason: text("nonbillable_reason"),
  excluded: integer("excluded")
    .notNull()
    .default(sql`0`),
  demo_app: text("demo_app"),
  demo_window_title: text("demo_window_title"),
  demo_confidence: real("demo_confidence"),
  invoice_id: integer("invoice_id"),
});

export const tables = {
  assignment_deliveries,
  audit_event,
  audit_events,
  block,
  cases,
  client,
  client_rule,
  client_rules,
  clients,
  demo_block_periods,
  demo_period_entries,
  expense,
  expenses,
  firm,
  invoice,
  invoice_line,
  invoice_lines,
  invoices,
  jev_review,
  jev_reviews,
  marker,
  markers,
  matter,
  pause,
  pending_questions,
  processed_commands,
  reconstruction_conflicts,
  retrieval_progress,
  schema_migrations,
  schema_version,
  sessions,
  setting,
  settings,
  source,
  source_export,
  source_exports,
  source_relocations,
  sources,
  tag_targets,
  task,
  task_types,
  time_entry,
  work_periods,
};
