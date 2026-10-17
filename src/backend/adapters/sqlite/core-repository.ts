import { DatabaseSync } from "node:sqlite";
import type {
  CommandRecord,
  CoverageGap,
  PeriodRecord,
  QuestionRecord,
  Repository,
  SessionRecord,
  SourceRecord,
} from "../../ports/repository.js";
import { transaction } from "./transaction.js";
import { migrate } from "./migrate.js";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { orm } from "./orm.js";
import * as tables from "./tables.js";

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("Invalid SQLite row");
  return Object.fromEntries(Object.entries(value));
};
const str = (value: unknown): string => {
  if (typeof value !== "string") throw Error("Invalid SQLite text value");
  return value;
};
const nullable = (value: unknown): string | null => (value === null ? null : str(value));
const num = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error("Invalid SQLite numeric value");
  return value;
};
const flag = (value: unknown): boolean => {
  if (value !== 0 && value !== 1) throw Error("Invalid SQLite boolean value");
  return value === 1;
};
const nullableNum = (value: unknown): number | null => (value === null ? null : num(value));
function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  for (const item of allowed) if (item === value) return item;
  throw Error("Invalid SQLite enum value");
}

function session(value: unknown): SessionRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        startedAt: str(r.started_at),
        endedAt: nullable(r.ended_at),
        revision: num(r.revision),
      }
    : null;
}
function period(value: unknown): PeriodRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        sessionId: str(r.session_id),
        caseId: nullable(r.case_id),
        initialCaseId: nullable(r.initial_case_id),
        initialOrigin: member(r.initial_origin, ["unresolved", "automatic", "lawyer"]),
        startedAt: str(r.started_at),
        endedAt: nullable(r.ended_at),
        detectedDurationMs: nullableNum(r.detected_duration_ms),
        durationOverrideMs: nullableNum(r.duration_override_ms),
        assignmentOrigin: member(r.assignment_origin, ["unresolved", "automatic", "lawyer"]),
        assignmentRevision: num(r.assignment_revision),
        effectiveRevision: num(r.effective_revision),
        validatedEffectiveRevision: nullableNum(r.validated_effective_revision),
        timeValidatedAt: nullable(r.time_validated_at),
        billingStatus: member(r.billing_status, ["unbilled", "billed"]),
        billedAt: nullable(r.billed_at),
        revision: num(r.revision),
        appliedHourlyRateCents: nullableNum(r.applied_hourly_rate_cents),
        appliedCurrency: nullable(r.applied_currency),
        taskTypeId: nullableNum(r.task_type_id),
        label: str(r.label),
        billable: flag(r.billable),
        nonbillableReason: nullable(r.nonbillable_reason),
        excluded: flag(r.excluded),
        demoApp: nullable(r.demo_app),
        demoWindowTitle: nullable(r.demo_window_title),
        demoConfidence: nullableNum(r.demo_confidence),
        invoiceId: nullableNum(r.invoice_id),
      }
    : null;
}
function command(value: unknown): CommandRecord | null {
  const r = row(value);
  return r
    ? {
        producerId: str(r.producer_id),
        commandId: str(r.command_id),
        kind: member(r.kind, ["start", "end"]),
        payloadFingerprint: str(r.payload_fingerprint),
        sessionId: str(r.session_id),
        status: member(r.status, ["pending", "applied", "rejected"]),
        prerequisiteId: nullable(r.prerequisite_id),
        payloadJson: str(r.payload_json),
        resultJson: nullable(r.result_json),
      }
    : null;
}
function question(value: unknown): QuestionRecord | null {
  const r = row(value);
  return r
    ? {
        questionId: str(r.question_id),
        sessionId: str(r.session_id),
        periodId: str(r.work_period_id),
        expectedAssignmentRevision: num(r.expected_assignment_revision),
        status: member(r.status, ["pending", "answered", "superseded"]),
        responseCommandId: nullable(r.response_command_id),
        responseResultJson: nullable(r.response_result_json),
      }
    : null;
}
function source(value: unknown): SourceRecord | null {
  const r = row(value);
  return r
    ? {
        id: str(r.id),
        workPeriodId: nullable(r.work_period_id),
        instanceId: str(r.screenpipe_instance_id),
        contentType: str(r.content_type),
        externalId: str(r.external_id),
        recordedAt: str(r.recorded_at),
        ingestedAt: str(r.ingested_at),
        excerpt: nullable(r.excerpt),
        detectedMarker: nullable(r.detected_marker),
        validationStatus: member(r.validation_status, ["unvalidated", "validated"]),
        validatedAt: nullable(r.validated_at),
        availabilityStatus: member(r.availability_status, ["unknown", "available", "unavailable"]),
        availabilityCheckedAt: nullable(r.availability_checked_at),
      }
    : null;
}

export class SqliteRepository implements Repository {
  readonly db: DatabaseSync;
  constructor(path: string | DatabaseSync) {
    this.db = typeof path === "string" ? new DatabaseSync(path) : path;
    migrate(this.db);
  }
  close(): void {
    this.db.close();
  }
  transaction<T>(work: () => T): T {
    return transaction(this.db, work);
  }
  activeSession(): SessionRecord | null {
    return session(
      orm(this.db).select().from(tables.sessions).where(isNull(tables.sessions.ended_at)).get(),
    );
  }
  listSessions(): SessionRecord[] {
    return orm(this.db)
      .select()
      .from(tables.sessions)
      .orderBy(sql`julianday(${tables.sessions.started_at})`, tables.sessions.id)
      .all()
      .map((value) => session(value)!);
  }
  session(id: string): SessionRecord | null {
    return session(
      orm(this.db).select().from(tables.sessions).where(eq(tables.sessions.id, id)).get(),
    );
  }
  insertSession(s: SessionRecord, now: string): void {
    orm(this.db)
      .insert(tables.sessions)
      .values({
        id: s.id,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        revision: s.revision,
        created_at: now,
        updated_at: now,
      })
      .run();
  }
  endSession(id: string, endedAt: string, now: string): void {
    orm(this.db)
      .update(tables.sessions)
      .set({ ended_at: endedAt, revision: sql`${tables.sessions.revision}+1`, updated_at: now })
      .where(eq(tables.sessions.id, id))
      .run();
  }
  command(producerId: string, commandId: string): CommandRecord | null {
    return command(
      orm(this.db)
        .select()
        .from(tables.processed_commands)
        .where(
          and(
            eq(tables.processed_commands.producer_id, producerId),
            eq(tables.processed_commands.command_id, commandId),
          ),
        )
        .get(),
    );
  }
  saveCommand(c: CommandRecord, now: string): void {
    orm(this.db)
      .insert(tables.processed_commands)
      .values({
        producer_id: c.producerId,
        command_id: c.commandId,
        kind: c.kind,
        payload_fingerprint: c.payloadFingerprint,
        session_id: c.sessionId,
        status: c.status,
        prerequisite_id: c.prerequisiteId,
        payload_json: c.payloadJson,
        result_json: c.resultJson,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [tables.processed_commands.producer_id, tables.processed_commands.command_id],
        set: { status: c.status, result_json: c.resultJson, updated_at: now },
      })
      .run();
  }
  pendingDependents(producerId: string, prerequisiteId: string): CommandRecord[] {
    const t = tables.processed_commands;
    return orm(this.db)
      .select()
      .from(t)
      .where(
        and(
          eq(t.producer_id, producerId),
          eq(t.prerequisite_id, prerequisiteId),
          eq(t.status, "pending"),
        ),
      )
      .orderBy(t.created_at, t.command_id)
      .all()
      .map((value) => command(value)!);
  }
  period(id: string): PeriodRecord | null {
    return period(
      orm(this.db).select().from(tables.work_periods).where(eq(tables.work_periods.id, id)).get(),
    );
  }
  activePeriod(sessionId: string): PeriodRecord | null {
    const t = tables.work_periods;
    return period(
      orm(this.db)
        .select()
        .from(t)
        .where(and(eq(t.session_id, sessionId), isNull(t.ended_at)))
        .get(),
    );
  }
  // Keep SQLite date comparisons for mixed ISO offsets; lexical ordering is not equivalent.
  periodAt(sessionId: string, at: string): PeriodRecord | null {
    return period(
      this.db
        .prepare(
          `SELECT * FROM work_periods WHERE session_id=? AND julianday(started_at)<=julianday(?)
      AND (ended_at IS NULL OR julianday(ended_at)>julianday(?)) ORDER BY julianday(started_at) DESC, id LIMIT 1`,
        )
        .get(sessionId, at, at),
    );
  }
  nextPeriodAfter(sessionId: string, at: string): PeriodRecord | null {
    return period(
      this.db
        .prepare(
          "SELECT * FROM work_periods WHERE session_id=? AND julianday(started_at)>julianday(?) ORDER BY julianday(started_at), id LIMIT 1",
        )
        .get(sessionId, at),
    );
  }
  listPeriods(sessionId: string): PeriodRecord[] {
    const t = tables.work_periods;
    return orm(this.db)
      .select()
      .from(t)
      .where(eq(t.session_id, sessionId))
      .orderBy(sql`julianday(${t.started_at})`, t.id)
      .all()
      .map((value) => period(value)!);
  }
  allPeriods(): PeriodRecord[] {
    const t = tables.work_periods;
    return orm(this.db)
      .select()
      .from(t)
      .orderBy(sql`julianday(${t.started_at})`, t.id)
      .all()
      .map((value) => period(value)!);
  }
  insertPeriod(p: PeriodRecord, now: string): void {
    orm(this.db)
      .insert(tables.work_periods)
      .values({
        id: p.id,
        session_id: p.sessionId,
        case_id: p.caseId,
        initial_case_id: p.initialCaseId,
        initial_origin: p.initialOrigin,
        started_at: p.startedAt,
        ended_at: p.endedAt,
        detected_duration_ms: p.detectedDurationMs,
        duration_override_ms: p.durationOverrideMs,
        assignment_origin: p.assignmentOrigin,
        time_validation_status:
          p.validatedEffectiveRevision === p.effectiveRevision && p.timeValidatedAt
            ? "validated"
            : "unvalidated",
        effective_revision: p.effectiveRevision,
        validated_effective_revision: p.validatedEffectiveRevision,
        time_validated_at: p.timeValidatedAt,
        billing_status: p.billingStatus,
        billed_at: p.billedAt,
        revision: p.revision,
        assignment_revision: p.assignmentRevision,
        created_at: now,
        updated_at: now,
        applied_hourly_rate_cents: p.appliedHourlyRateCents ?? null,
        applied_currency: p.appliedCurrency ?? null,
        task_type_id: p.taskTypeId ?? null,
        label: p.label ?? "",
        billable: p.billable === false ? 0 : 1,
        nonbillable_reason: p.nonbillableReason ?? null,
        excluded: p.excluded ? 1 : 0,
        demo_app: p.demoApp ?? null,
        demo_window_title: p.demoWindowTitle ?? null,
        demo_confidence: p.demoConfidence ?? null,
        invoice_id: p.invoiceId ?? null,
      })
      .run();
  }
  savePeriod(p: PeriodRecord, now: string): void {
    orm(this.db)
      .update(tables.work_periods)
      .set({
        case_id: p.caseId,
        ended_at: p.endedAt,
        detected_duration_ms: p.detectedDurationMs,
        duration_override_ms: p.durationOverrideMs,
        assignment_origin: p.assignmentOrigin,
        time_validation_status:
          p.validatedEffectiveRevision === p.effectiveRevision && p.timeValidatedAt
            ? "validated"
            : "unvalidated",
        effective_revision: p.effectiveRevision,
        validated_effective_revision: p.validatedEffectiveRevision,
        time_validated_at: p.timeValidatedAt,
        billing_status: p.billingStatus,
        billed_at: p.billedAt,
        revision: p.revision,
        assignment_revision: p.assignmentRevision,
        updated_at: now,
        applied_hourly_rate_cents: p.appliedHourlyRateCents ?? null,
        applied_currency: p.appliedCurrency ?? null,
        task_type_id: p.taskTypeId ?? null,
        label: p.label ?? "",
        billable: p.billable === false ? 0 : 1,
        nonbillable_reason: p.nonbillableReason ?? null,
        excluded: p.excluded ? 1 : 0,
        invoice_id: p.invoiceId ?? null,
      })
      .where(eq(tables.work_periods.id, p.id))
      .run();
  }
  canSplitSources(periodId: string, at: string): boolean {
    // Provider tag intent is not defined. Preserve any committed delivery until
    // an explicit reconstruction action can recompute and verify the new tags.
    if (
      this.db
        .prepare(
          `SELECT 1 FROM sources s JOIN assignment_deliveries d ON d.tag_target_id=s.tag_target_id
      WHERE s.work_period_id=? AND julianday(s.recorded_at)>=julianday(?) LIMIT 1`,
        )
        .get(periodId, at)
    )
      return false;
    // All aliases of a provider target must remain owned by one period.
    return !this.db
      .prepare(
        `SELECT 1 FROM sources a JOIN sources b ON b.tag_target_id=a.tag_target_id
      WHERE a.work_period_id=? AND julianday(a.recorded_at)<julianday(?)
      AND julianday(b.recorded_at)>=julianday(?) LIMIT 1`,
      )
      .get(periodId, at, at);
  }
  moveSplitSources(fromId: string, toId: string, at: string): void {
    const moving = this.db
      .prepare(
        "SELECT id FROM sources WHERE work_period_id=? AND julianday(recorded_at)>=julianday(?)",
      )
      .all(fromId, at);
    for (const source of moving)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO source_relocations(source_id,from_period_id,to_period_id) VALUES (?,?,?)",
        )
        .run(str(source.id), fromId, toId);
    const targets = this.db
      .prepare(
        `SELECT DISTINCT tag_target_id AS id FROM sources
      WHERE work_period_id=? AND julianday(recorded_at)>=julianday(?) AND tag_target_id IS NOT NULL`,
      )
      .all(fromId, at);
    for (const target of targets) {
      const id = str(target.id);
      const aliases = this.db.prepare("SELECT id FROM sources WHERE tag_target_id=?").all(id);
      // Temporarily detach the aliases to satisfy both immediate ownership guards.
      this.db.prepare("UPDATE sources SET tag_target_id=NULL WHERE tag_target_id=?").run(id);
      this.db
        .prepare(
          "UPDATE tag_targets SET work_period_id=?,target_revision=target_revision+1 WHERE id=?",
        )
        .run(toId, id);
      for (const alias of aliases)
        this.db
          .prepare("UPDATE sources SET work_period_id=?,tag_target_id=? WHERE id=?")
          .run(toId, id, str(alias.id));
    }
    this.db
      .prepare(
        `UPDATE sources SET work_period_id=? WHERE work_period_id=?
      AND julianday(recorded_at)>=julianday(?)`,
      )
      .run(toId, fromId, at);
  }
  sourceRelocatedFrom(sourceId: string, periodId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM source_relocations WHERE source_id=? AND from_period_id=?")
        .get(sourceId, periodId),
    );
  }
  caseExists(id: string): boolean {
    return !!orm(this.db)
      .select({ id: tables.cases.id })
      .from(tables.cases)
      .where(eq(tables.cases.id, id))
      .get();
  }
  createClient(id: string, name: string, now: string): void {
    orm(this.db)
      .insert(tables.clients)
      .values({ id, name, created_at: now, updated_at: now })
      .run();
  }
  createCase(
    id: string,
    clientId: string,
    reference: string,
    title: string,
    hourlyRateCents: number | null,
    now: string,
  ): void {
    orm(this.db)
      .insert(tables.cases)
      .values({
        id,
        client_id: clientId,
        reference,
        title,
        hourly_rate_cents: hourlyRateCents,
        created_at: now,
        updated_at: now,
      })
      .run();
  }
  setGlobalRate(rateCents: number, currency: string, workspaceId: string, now: string): void {
    const values = {
      global_hourly_rate_cents: rateCents,
      currency,
      workspace_id: workspaceId,
      updated_at: now,
    };
    orm(this.db)
      .insert(tables.settings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: tables.settings.id, set: values })
      .run();
  }
  rateForCase(id: string): {
    caseRateCents: number | null;
    clientRateCents: number | null;
    globalRateCents: number | null;
    currency: string | null;
  } | null {
    const r = orm(this.db)
      .select({
        case_rate: tables.cases.hourly_rate_cents,
        client_rate: tables.clients.hourly_rate_cents,
        global_rate: tables.settings.global_hourly_rate_cents,
        currency: tables.settings.currency,
      })
      .from(tables.cases)
      .innerJoin(tables.clients, eq(tables.clients.id, tables.cases.client_id))
      .leftJoin(tables.settings, eq(tables.settings.id, 1))
      .where(eq(tables.cases.id, id))
      .get();
    return r
      ? {
          caseRateCents: nullableNum(r.case_rate),
          clientRateCents: nullableNum(r.client_rate),
          globalRateCents: nullableNum(r.global_rate),
          currency: nullable(r.currency),
        }
      : null;
  }
  clientForCase(id: string): string | null {
    return (
      orm(this.db)
        .select({ client_id: tables.cases.client_id })
        .from(tables.cases)
        .where(eq(tables.cases.id, id))
        .get()?.client_id ?? null
    );
  }
  question(id: string): QuestionRecord | null {
    return question(
      orm(this.db)
        .select()
        .from(tables.pending_questions)
        .where(eq(tables.pending_questions.question_id, id))
        .get(),
    );
  }
  allQuestions(): QuestionRecord[] {
    return orm(this.db)
      .select()
      .from(tables.pending_questions)
      .orderBy(tables.pending_questions.question_id)
      .all()
      .map((value) => question(value)!);
  }
  saveQuestion(q: QuestionRecord): void {
    const update = {
      status: q.status,
      response_command_id: q.responseCommandId,
      response_result_json: q.responseResultJson,
    };
    orm(this.db)
      .insert(tables.pending_questions)
      .values({
        question_id: q.questionId,
        session_id: q.sessionId,
        work_period_id: q.periodId,
        expected_assignment_revision: q.expectedAssignmentRevision,
        ...update,
      })
      .onConflictDoUpdate({ target: tables.pending_questions.question_id, set: update })
      .run();
  }
  sourceByIdentity(
    instanceId: string,
    contentType: string,
    externalId: string,
  ): SourceRecord | null {
    const t = tables.sources;
    return source(
      orm(this.db)
        .select()
        .from(t)
        .where(
          and(
            eq(t.screenpipe_instance_id, instanceId),
            eq(t.content_type, contentType),
            eq(t.external_id, externalId),
          ),
        )
        .get(),
    );
  }
  listSources(periodId: string): SourceRecord[] {
    const t = tables.sources;
    return orm(this.db)
      .select()
      .from(t)
      .where(eq(t.work_period_id, periodId))
      .orderBy(sql`julianday(${t.recorded_at})`, t.id)
      .all()
      .map((value) => source(value)!);
  }
  allSources(): SourceRecord[] {
    const t = tables.sources;
    return orm(this.db)
      .select()
      .from(t)
      .orderBy(sql`julianday(${t.recorded_at})`, t.id)
      .all()
      .map((value) => source(value)!);
  }
  coverageGaps(): CoverageGap[] {
    const t = tables.retrieval_progress;
    return orm(this.db)
      .select()
      .from(t)
      .where(ne(t.status, "complete"))
      .orderBy(sql`julianday(${t.requested_start_at})`, t.id)
      .all()
      .map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        startedAt: r.requested_start_at,
        endedAt: r.requested_end_at,
        status: member(r.status, ["pending", "failed"]),
      }));
  }
  insertSource(s: SourceRecord): void {
    orm(this.db)
      .insert(tables.sources)
      .values({
        id: s.id,
        work_period_id: s.workPeriodId,
        screenpipe_instance_id: s.instanceId,
        content_type: s.contentType,
        external_id: s.externalId,
        recorded_at: s.recordedAt,
        ingested_at: s.ingestedAt,
        validation_status: s.validationStatus,
        availability_status: s.availabilityStatus,
      })
      .run();
  }
  saveSource(s: SourceRecord): void {
    orm(this.db)
      .update(tables.sources)
      .set({
        work_period_id: s.workPeriodId,
        validation_status: s.validationStatus,
        validated_at: s.validatedAt,
        availability_status: s.availabilityStatus,
        availability_checked_at: s.availabilityCheckedAt,
      })
      .where(eq(tables.sources.id, s.id))
      .run();
  }
  reconstructionConflicts() {
    return orm(this.db)
      .select({
        id: tables.reconstruction_conflicts.id,
        periodId: tables.reconstruction_conflicts.protected_period_id,
        sessionId: tables.work_periods.session_id,
        expectedRevision: tables.reconstruction_conflicts.expected_revision,
        proposedStartedAt: tables.reconstruction_conflicts.proposed_started_at,
        proposedEndedAt: tables.reconstruction_conflicts.proposed_ended_at,
        sourceReferencesJson: tables.reconstruction_conflicts.source_references_json,
        status: tables.reconstruction_conflicts.status,
      })
      .from(tables.reconstruction_conflicts)
      .innerJoin(
        tables.work_periods,
        eq(tables.work_periods.id, tables.reconstruction_conflicts.protected_period_id),
      )
      .all()
      .map(({ sourceReferencesJson, ...row }) => ({
        ...row,
        sourceReferences: JSON.parse(sourceReferencesJson) as string[],
        status: row.status as "pending" | "resolved",
      }));
  }
  insertConflict(
    id: string,
    periodId: string,
    expectedRevision: number,
    startedAt: string,
    endedAt: string | null,
    sourceReferencesJson: string,
  ): void {
    orm(this.db)
      .insert(tables.reconstruction_conflicts)
      .values({
        id,
        protected_period_id: periodId,
        expected_revision: expectedRevision,
        proposed_started_at: startedAt,
        proposed_ended_at: endedAt,
        source_references_json: sourceReferencesJson,
        status: "pending",
      })
      .onConflictDoNothing()
      .run();
  }
}
