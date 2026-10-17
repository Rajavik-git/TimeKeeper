import { DatabaseSync } from 'node:sqlite';
import type { CommandRecord, CoverageGap, PeriodRecord, QuestionRecord, Repository, SessionRecord, SourceRecord } from '../../ports/repository.js';
import { migrate } from './migrate.js';

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value ? value as Row : null;
const str = (value: unknown): string => value as string;
const nullable = (value: unknown): string | null => value as string | null;
const num = (value: unknown): number => value as number;

function session(value: unknown): SessionRecord | null {
  const r = row(value); return r ? { id: str(r.id), startedAt: str(r.started_at), endedAt: nullable(r.ended_at), revision: num(r.revision) } : null;
}
function period(value: unknown): PeriodRecord | null {
  const r = row(value); return r ? {
    id: str(r.id), sessionId: str(r.session_id), caseId: nullable(r.case_id), initialCaseId: nullable(r.initial_case_id), initialOrigin: str(r.initial_origin) as PeriodRecord['initialOrigin'], startedAt: str(r.started_at), endedAt: nullable(r.ended_at),
    detectedDurationMs: r.detected_duration_ms as number | null, durationOverrideMs: r.duration_override_ms as number | null,
    assignmentOrigin: str(r.assignment_origin) as PeriodRecord['assignmentOrigin'],
    assignmentRevision: num(r.assignment_revision), effectiveRevision: num(r.effective_revision),
    validatedEffectiveRevision: r.validated_effective_revision as number | null, timeValidatedAt: nullable(r.time_validated_at),
    billingStatus: str(r.billing_status) as PeriodRecord['billingStatus'], billedAt: nullable(r.billed_at), revision: num(r.revision),
    appliedHourlyRateCents: r.applied_hourly_rate_cents as number | null, appliedCurrency: nullable(r.applied_currency),
    taskTypeId: r.task_type_id as number | null, label: str(r.label), billable: Boolean(r.billable),
    nonbillableReason: nullable(r.nonbillable_reason), excluded: Boolean(r.excluded), demoApp: nullable(r.demo_app),
    demoWindowTitle: nullable(r.demo_window_title), demoConfidence: r.demo_confidence as number | null,
    invoiceId: r.invoice_id as number | null
  } : null;
}
function command(value: unknown): CommandRecord | null {
  const r = row(value); return r ? {
    producerId: str(r.producer_id), commandId: str(r.command_id), kind: str(r.kind) as CommandRecord['kind'],
    payloadFingerprint: str(r.payload_fingerprint), sessionId: str(r.session_id), status: str(r.status) as CommandRecord['status'],
    prerequisiteId: nullable(r.prerequisite_id), payloadJson: str(r.payload_json), resultJson: nullable(r.result_json)
  } : null;
}
function question(value: unknown): QuestionRecord | null {
  const r = row(value); return r ? {
    questionId: str(r.question_id), sessionId: str(r.session_id), periodId: str(r.work_period_id),
    expectedAssignmentRevision: num(r.expected_assignment_revision), status: str(r.status) as QuestionRecord['status'],
    responseCommandId: nullable(r.response_command_id), responseResultJson: nullable(r.response_result_json)
  } : null;
}
function source(value: unknown): SourceRecord | null {
  const r = row(value); return r ? {
    id: str(r.id), workPeriodId: nullable(r.work_period_id), instanceId: str(r.screenpipe_instance_id),
    contentType: str(r.content_type), externalId: str(r.external_id), recordedAt: str(r.recorded_at), ingestedAt: str(r.ingested_at),
    validationStatus: str(r.validation_status) as SourceRecord['validationStatus'], validatedAt: nullable(r.validated_at), availabilityStatus: str(r.availability_status) as SourceRecord['availabilityStatus'], availabilityCheckedAt: nullable(r.availability_checked_at)
  } : null;
}

export class SqliteRepository implements Repository {
  readonly db: DatabaseSync;
  constructor(path: string | DatabaseSync) {
    this.db = typeof path === 'string' ? new DatabaseSync(path) : path;
    migrate(this.db);
  }
  close(): void { this.db.close(); }
  transaction<T>(work: () => T): T {
    this.db.exec('SAVEPOINT core_tx');
    try { const value = work(); this.db.exec('RELEASE core_tx'); return value; }
    catch (error) { this.db.exec('ROLLBACK TO core_tx'); this.db.exec('RELEASE core_tx'); throw error; }
  }
  activeSession(): SessionRecord | null { return session(this.db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL').get()); }
  listSessions(): SessionRecord[] { return this.db.prepare('SELECT * FROM sessions ORDER BY started_at').all().map(value=>session(value)!); }
  session(id: string): SessionRecord | null { return session(this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id)); }
  insertSession(s: SessionRecord, now: string): void {
    this.db.prepare('INSERT INTO sessions(id,started_at,ended_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(s.id,s.startedAt,s.endedAt,s.revision,now,now);
  }
  endSession(id: string, endedAt: string, now: string): void {
    this.db.prepare('UPDATE sessions SET ended_at=?,revision=revision+1,updated_at=? WHERE id=?').run(endedAt,now,id);
  }
  command(producerId: string, commandId: string): CommandRecord | null {
    return command(this.db.prepare('SELECT * FROM processed_commands WHERE producer_id=? AND command_id=?').get(producerId,commandId));
  }
  saveCommand(c: CommandRecord, now: string): void {
    this.db.prepare(`INSERT INTO processed_commands(producer_id,command_id,kind,payload_fingerprint,session_id,status,prerequisite_id,payload_json,result_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(producer_id,command_id) DO UPDATE SET status=excluded.status,result_json=excluded.result_json,updated_at=excluded.updated_at`).run(
      c.producerId,c.commandId,c.kind,c.payloadFingerprint,c.sessionId,c.status,c.prerequisiteId,c.payloadJson,c.resultJson,now,now);
  }
  pendingDependents(producerId: string, prerequisiteId: string): CommandRecord[] {
    return this.db.prepare("SELECT * FROM processed_commands WHERE producer_id=? AND prerequisite_id=? AND status='pending' ORDER BY created_at,command_id").all(producerId,prerequisiteId).map(value => command(value)!);
  }
  period(id: string): PeriodRecord | null { return period(this.db.prepare('SELECT * FROM work_periods WHERE id=?').get(id)); }
  activePeriod(sessionId: string): PeriodRecord | null { return period(this.db.prepare('SELECT * FROM work_periods WHERE session_id=? AND ended_at IS NULL').get(sessionId)); }
  periodAt(sessionId: string, at: string): PeriodRecord | null {
    return period(this.db.prepare(`SELECT * FROM work_periods WHERE session_id=? AND julianday(started_at)<=julianday(?)
      AND (ended_at IS NULL OR julianday(ended_at)>julianday(?)) ORDER BY started_at DESC LIMIT 1`).get(sessionId,at,at));
  }
  nextPeriodAfter(sessionId: string, at: string): PeriodRecord | null {
    return period(this.db.prepare('SELECT * FROM work_periods WHERE session_id=? AND julianday(started_at)>julianday(?) ORDER BY started_at LIMIT 1').get(sessionId,at));
  }
  listPeriods(sessionId: string): PeriodRecord[] { return this.db.prepare('SELECT * FROM work_periods WHERE session_id=? ORDER BY started_at,id').all(sessionId).map(value => period(value)!); }
  allPeriods(): PeriodRecord[] { return this.db.prepare('SELECT * FROM work_periods ORDER BY started_at,id').all().map(value => period(value)!); }
  insertPeriod(p: PeriodRecord, now: string): void {
    this.db.prepare(`INSERT INTO work_periods(id,session_id,case_id,initial_case_id,initial_origin,started_at,ended_at,detected_duration_ms,duration_override_ms,assignment_origin,
      time_validation_status,effective_revision,validated_effective_revision,time_validated_at,billing_status,billed_at,revision,assignment_revision,created_at,updated_at,
      applied_hourly_rate_cents,applied_currency,task_type_id,label,billable,nonbillable_reason,excluded,demo_app,demo_window_title,demo_confidence,invoice_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id,p.sessionId,p.caseId,p.initialCaseId,p.initialOrigin,p.startedAt,p.endedAt,p.detectedDurationMs,p.durationOverrideMs,p.assignmentOrigin,
      p.validatedEffectiveRevision === p.effectiveRevision && p.timeValidatedAt ? 'validated' : 'unvalidated',p.effectiveRevision,p.validatedEffectiveRevision,p.timeValidatedAt,
      p.billingStatus,p.billedAt,p.revision,p.assignmentRevision,now,now,p.appliedHourlyRateCents ?? null,p.appliedCurrency ?? null,
      p.taskTypeId ?? null,p.label ?? '',p.billable === false ? 0 : 1,p.nonbillableReason ?? null,p.excluded ? 1 : 0,p.demoApp ?? null,p.demoWindowTitle ?? null,p.demoConfidence ?? null,p.invoiceId ?? null);
  }
  savePeriod(p: PeriodRecord, now: string): void {
    this.db.prepare(`UPDATE work_periods SET case_id=?,ended_at=?,detected_duration_ms=?,duration_override_ms=?,assignment_origin=?,
      time_validation_status=?,effective_revision=?,validated_effective_revision=?,time_validated_at=?,billing_status=?,billed_at=?,
      revision=?,assignment_revision=?,updated_at=?,applied_hourly_rate_cents=?,applied_currency=?,task_type_id=?,label=?,billable=?,nonbillable_reason=?,excluded=?,demo_app=?,demo_window_title=?,demo_confidence=?,invoice_id=? WHERE id=?`).run(p.caseId,p.endedAt,p.detectedDurationMs,p.durationOverrideMs,p.assignmentOrigin,
      p.validatedEffectiveRevision === p.effectiveRevision && p.timeValidatedAt ? 'validated' : 'unvalidated',p.effectiveRevision,p.validatedEffectiveRevision,p.timeValidatedAt,
      p.billingStatus,p.billedAt,p.revision,p.assignmentRevision,now,p.appliedHourlyRateCents ?? null,p.appliedCurrency ?? null,
      p.taskTypeId ?? null,p.label ?? '',p.billable === false ? 0 : 1,p.nonbillableReason ?? null,p.excluded ? 1 : 0,p.demoApp ?? null,p.demoWindowTitle ?? null,p.demoConfidence ?? null,p.invoiceId ?? null,p.id);
    this.syncDemoPeriod(p);
  }
  private syncDemoPeriod(p: PeriodRecord): void {
    // The imported demo tables are compatibility projections of canonical review state.
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='time_entry'").get()) return;
    const link=row(this.db.prepare('SELECT block_id FROM demo_block_periods WHERE period_id=?').get(p.id));
    const entry=row(this.db.prepare(`SELECT e.id,e.block_id,e.matter_id FROM time_entry e
      LEFT JOIN demo_block_periods link ON link.block_id=e.block_id
      WHERE link.period_id=? OR (e.block_id IS NULL AND CAST(e.id AS TEXT)=?) LIMIT 1`).get(p.id,p.id));
    if (entry) this.db.prepare('UPDATE time_entry SET matter_id=?,review_status=? WHERE id=?').run(
      p.caseId,p.validatedEffectiveRevision===p.effectiveRevision&&p.timeValidatedAt?'approved':'to_review',Number(entry.id));
    if (link) {
      const block=row(this.db.prepare('SELECT state,matter_id FROM block WHERE id=?').get(Number(link.block_id)));
      if (!block) return;
      const caseChanged=(block.matter_id===null?null:String(block.matter_id))!==p.caseId;
      const wasDiscarded=block.state==='discarded';
      const state=p.excluded?'discarded':wasDiscarded||caseChanged?(p.caseId?'assigned':'to_check'):String(block.state);
      this.db.prepare('UPDATE block SET matter_id=?,state=? WHERE id=?').run(p.caseId,state,Number(link.block_id));
    }
  }
  caseExists(id: string): boolean { return !!this.db.prepare('SELECT 1 FROM cases WHERE id=?').get(id); }
  createClient(id: string, name: string, now: string): void {
    this.db.prepare('INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id,name,now,now);
  }
  createCase(id: string, clientId: string, reference: string, title: string, hourlyRateCents: number | null, now: string): void {
    this.db.prepare('INSERT INTO cases(id,client_id,reference,title,hourly_rate_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,clientId,reference,title,hourlyRateCents,now,now);
  }
  setGlobalRate(rateCents: number, currency: string, workspaceId: string, now: string): void {
    this.db.prepare(`INSERT INTO settings(id,global_hourly_rate_cents,currency,workspace_id,updated_at) VALUES (1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET global_hourly_rate_cents=excluded.global_hourly_rate_cents,currency=excluded.currency,
      workspace_id=excluded.workspace_id,updated_at=excluded.updated_at`).run(rateCents,currency,workspaceId,now);
  }
  rateForCase(id: string): { caseRateCents: number | null; clientRateCents: number | null; globalRateCents: number | null } | null {
    const r=row(this.db.prepare(`SELECT c.hourly_rate_cents AS case_rate, cl.hourly_rate_cents AS client_rate, s.global_hourly_rate_cents AS global_rate
      FROM cases c JOIN clients cl ON cl.id=c.client_id LEFT JOIN settings s ON s.id=1 WHERE c.id=?`).get(id));
    return r ? {caseRateCents:r.case_rate as number | null,clientRateCents:r.client_rate as number | null,globalRateCents:r.global_rate as number | null} : null;
  }
  clientForCase(id: string): string | null {
    const r=row(this.db.prepare('SELECT client_id FROM cases WHERE id=?').get(id));
    return r ? str(r.client_id) : null;
  }
  question(id: string): QuestionRecord | null { return question(this.db.prepare('SELECT * FROM pending_questions WHERE question_id=?').get(id)); }
  allQuestions(): QuestionRecord[] { return this.db.prepare('SELECT * FROM pending_questions ORDER BY question_id').all().map(value=>question(value)!); }
  saveQuestion(q: QuestionRecord): void {
    this.db.prepare(`INSERT INTO pending_questions(question_id,session_id,work_period_id,expected_assignment_revision,status,response_command_id,response_result_json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET status=excluded.status,response_command_id=excluded.response_command_id,response_result_json=excluded.response_result_json`).run(
      q.questionId,q.sessionId,q.periodId,q.expectedAssignmentRevision,q.status,q.responseCommandId,q.responseResultJson);
  }
  sourceByIdentity(instanceId: string, contentType: string, externalId: string): SourceRecord | null {
    return source(this.db.prepare('SELECT * FROM sources WHERE screenpipe_instance_id=? AND content_type=? AND external_id=?').get(instanceId,contentType,externalId));
  }
  listSources(periodId: string): SourceRecord[] {
    return this.db.prepare('SELECT * FROM sources WHERE work_period_id=? ORDER BY recorded_at,id').all(periodId).map(value=>source(value)!);
  }
  allSources(): SourceRecord[] { return this.db.prepare('SELECT * FROM sources ORDER BY recorded_at,id').all().map(value=>source(value)!); }
  coverageGaps(): CoverageGap[] { return (this.db.prepare("SELECT id,session_id,requested_start_at,requested_end_at,status FROM retrieval_progress WHERE status != 'complete' ORDER BY requested_start_at").all() as Row[]).map(r=>({
    id:str(r.id),sessionId:str(r.session_id),startedAt:str(r.requested_start_at),endedAt:str(r.requested_end_at),status:str(r.status) as CoverageGap['status'],
  })); }
  insertSource(s: SourceRecord): void {
    this.db.prepare(`INSERT INTO sources(id,work_period_id,screenpipe_instance_id,content_type,external_id,recorded_at,ingested_at,validation_status,availability_status)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(s.id,s.workPeriodId,s.instanceId,s.contentType,s.externalId,s.recordedAt,s.ingestedAt,s.validationStatus,s.availabilityStatus);
  }
  saveSource(s: SourceRecord): void {
    this.db.prepare('UPDATE sources SET work_period_id=?,validation_status=?,validated_at=?,availability_status=?,availability_checked_at=? WHERE id=?').run(
      s.workPeriodId,s.validationStatus,s.validatedAt,s.availabilityStatus,s.availabilityCheckedAt,s.id);
  }
  insertConflict(id: string, periodId: string, expectedRevision: number, startedAt: string, endedAt: string | null, sourceReferencesJson: string): void {
    this.db.prepare('INSERT OR IGNORE INTO reconstruction_conflicts(id,protected_period_id,expected_revision,proposed_started_at,proposed_ended_at,source_references_json,status) VALUES (?,?,?,?,?,?,\'pending\')').run(id,periodId,expectedRevision,startedAt,endedAt,sourceReferencesJson);
  }
}
