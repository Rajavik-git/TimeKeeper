import { createHash, randomUUID } from 'node:crypto';
import type { CommandOutcome, EndCommand, PeriodView, QuestionAnswer, StartCommand } from '../../contracts/index.js';
import { canApplyQuestion, changePeriod, endSession, resolveRate, timeIsValidated, validateTime } from '../domain/rules.js';
import type { Clock } from '../ports/index.js';
import type { CaseRecord, ClientRecord, CommandRecord, PeriodRecord, Repository, SessionRecord, SettingsRecord } from '../ports/repository.js';
import { AppError, isAppErrorCode } from '../ports/errors.js';

export { AppError } from '../ports/errors.js';
export interface SourceImport { id: string; periodId: string | null; instanceId: string; contentType: string; externalId: string; recordedAt: string }
export interface SourceImportResult { id: string; status: 'imported' | 'unchanged' }
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertTime(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AppError('invalid-request', 'UTC timestamp required');
}
/** Optional guard (docs/API.md A2): the caller states which effective revision it saw; a newer one means the period changed. */
function assertEffectiveRevision(p: PeriodRecord, expected: number | undefined): void {
  if (expected !== undefined && p.effectiveRevision !== expected) throw new AppError('conflict','stale effective revision');
}
function assertId(value: string): void { if (!value || value.length > 200) throw new AppError('invalid-request', 'invalid identifier'); }
function view(p: PeriodRecord): PeriodView {
  return { id:p.id, sessionId:p.sessionId, caseId:p.caseId, startedAt:p.startedAt, endedAt:p.endedAt,
    detectedDurationMs:p.detectedDurationMs, durationOverrideMs:p.durationOverrideMs, assignmentRevision:p.assignmentRevision,
    effectiveRevision:p.effectiveRevision, validatedEffectiveRevision:p.validatedEffectiveRevision,
    timeValidated:timeIsValidated(p), timeValidatedAt:p.timeValidatedAt, billingStatus:p.billingStatus,
    appliedHourlyRateCents:p.appliedHourlyRateCents ?? null, appliedCurrency:p.appliedCurrency ?? null,
    taskTypeId:p.taskTypeId ?? null, label:p.label ?? '', billable:p.billable ?? true,
    nonbillableReason:p.nonbillableReason ?? null, excluded:p.excluded ?? false,
    demoApp:p.demoApp ?? null, demoWindowTitle:p.demoWindowTitle ?? null,
    demoConfidence:p.demoConfidence ?? null, invoiceId:p.invoiceId ?? null };
}

export class TimeKeeperService {
  constructor(private readonly repo: Repository, private readonly clock: Clock = { now: () => new Date().toISOString() }) {}
  private existing(command: StartCommand | EndCommand, kind: 'start' | 'end'): CommandOutcome | null {
    const found = this.repo.command(command.producerId,command.commandId);
    if (!found) return null;
    if (found.kind !== kind || found.payloadFingerprint !== fingerprint(command)) throw new AppError('conflict','command ID reused with different payload');
    if (found.status === 'pending') return { status:'pending', commandId:command.commandId };
    if (found.status === 'rejected') {
      const rejected = JSON.parse(found.resultJson ?? '{}') as { error?: unknown; message?: string };
      throw new AppError(isAppErrorCode(rejected.error) ? rejected.error : 'conflict',rejected.message ?? 'command was rejected');
    }
    return JSON.parse(found.resultJson!) as CommandOutcome;
  }
  private save(command: StartCommand | EndCommand, kind: 'start' | 'end', status: CommandRecord['status'], result: CommandOutcome | null): void {
    this.repo.saveCommand({ producerId:command.producerId,commandId:command.commandId,kind,payloadFingerprint:fingerprint(command),
      sessionId:command.sessionId,status,prerequisiteId:command.prerequisiteCommandId ?? null,payloadJson:JSON.stringify(command),
      resultJson:result ? JSON.stringify(result) : null },this.clock.now());
  }
  private prerequisiteReady(command: StartCommand | EndCommand): boolean {
    if (!command.prerequisiteCommandId) return true;
    const prior = this.repo.command(command.producerId,command.prerequisiteCommandId);
    return prior?.status === 'applied';
  }
  private drain(producerId: string, commandId: string): void {
    for (const pending of this.repo.pendingDependents(producerId,commandId)) {
      const payload = JSON.parse(pending.payloadJson) as StartCommand | EndCommand;
      try {
        if (pending.kind === 'start') this.start(payload as StartCommand);
        else this.end(payload as EndCommand);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        this.repo.transaction(() => this.repo.saveCommand({ ...pending,status:'rejected',resultJson:JSON.stringify({error:error.code,message:error.message}) },this.clock.now()));
      }
    }
  }
  start(command: StartCommand): CommandOutcome {
    const outcome: CommandOutcome = this.repo.transaction((): CommandOutcome => {
      for (const id of [command.producerId,command.commandId,command.sessionId]) assertId(id);
      assertTime(command.occurredAt);
      if (command.prerequisiteCommandId === command.commandId) throw new AppError('conflict','self prerequisite');
      const result = this.existing(command,'start');
      if (result?.status === 'applied') return result;
      if (!this.prerequisiteReady(command)) { this.save(command,'start','pending',null); return { status:'pending',commandId:command.commandId }; }
      const applied = this.applyStart(command);
      return applied;
    });
    if (outcome.status === 'applied') this.drain(command.producerId,command.commandId);
    return outcome;
  }
  private applyStart(command: StartCommand): CommandOutcome {
    const current = this.repo.activeSession();
    const existing = this.repo.session(command.sessionId);
    if (existing && existing.endedAt !== null) throw new AppError('conflict','session ID already ended');
    const active = current ?? existing;
    if (!active) this.repo.insertSession({ id:command.sessionId,startedAt:command.occurredAt,endedAt:null,revision:0 },this.clock.now());
    const s = active ?? this.repo.session(command.sessionId)!;
    const result: CommandOutcome = { status:'applied',sessionId:s.id,startedAt:s.startedAt,endedAt:s.endedAt };
    this.save(command,'start','applied',result);
    return result;
  }
  end(command: EndCommand): CommandOutcome {
    if (!command.sessionId) throw new AppError('no-active-session','target session required');
    const outcome: CommandOutcome = this.repo.transaction((): CommandOutcome => {
      for (const id of [command.producerId,command.commandId,command.sessionId]) assertId(id);
      assertTime(command.occurredAt);
      if (command.prerequisiteCommandId === command.commandId) throw new AppError('conflict','self prerequisite');
      const result = this.existing(command,'end');
      if (result?.status === 'applied') return result;
      if (!this.prerequisiteReady(command)) {
        if (!command.prerequisiteCommandId) throw new AppError('no-active-session','target session is not known');
        this.save(command,'end','pending',null); return { status:'pending',commandId:command.commandId };
      }
      const applied = this.applyEnd(command);
      return applied;
    });
    if (outcome.status === 'applied') this.drain(command.producerId,command.commandId);
    return outcome;
  }
  private applyEnd(command: EndCommand): CommandOutcome {
    const s = this.repo.session(command.sessionId);
    if (!s) throw new AppError('not-found','target session not found');
    let boundary: string;
    try { boundary = endSession(s.startedAt,s.endedAt,command.occurredAt); }
    catch { throw new AppError('conflict','end before start'); }
    if (s.endedAt === null) {
      const active = this.repo.activePeriod(s.id);
      if (active) {
        if (Date.parse(boundary) < Date.parse(active.startedAt)) throw new AppError('conflict','end before active period');
        this.repo.savePeriod({ ...active,endedAt:boundary,revision:active.revision+1 },this.clock.now());
      }
      this.repo.endSession(s.id,boundary,this.clock.now());
    }
    const result: CommandOutcome = { status:'applied',sessionId:s.id,startedAt:s.startedAt,endedAt:boundary };
    this.save(command,'end','applied',result);
    return result;
  }
  createClient(id: string, name: string): void {
    assertId(id); if (!name.trim()) throw new AppError('invalid-request','client name required');
    this.repo.transaction(() => this.repo.createClient(id,name,this.clock.now()));
  }
  createCase(id: string, clientId: string, reference: string, title: string, hourlyRateCents: number | null): void {
    assertId(id); assertId(clientId);
    if (!reference.trim() || !title.trim() || (hourlyRateCents !== null && (!Number.isSafeInteger(hourlyRateCents) || hourlyRateCents < 0))) throw new AppError('invalid-request','invalid case');
    this.repo.transaction(() => this.repo.createCase(id,clientId,reference,title,hourlyRateCents,this.clock.now()));
  }
  setGlobalRate(rateCents: number, currency: string, workspaceId: string): void {
    if (!Number.isSafeInteger(rateCents) || rateCents < 0 || !/^[A-Z]{3}$/.test(currency)) throw new AppError('invalid-request','invalid rate or currency');
    assertId(workspaceId);
    this.repo.transaction(() => this.repo.setGlobalRate(rateCents,currency,workspaceId,this.clock.now()));
  }
  currentRateForCase(id: string): number {
    const rates=this.repo.rateForCase(id); if (!rates) throw new AppError('not-found','case or global rate not found');
    const rate = resolveRate(rates.caseRateCents,rates.globalRateCents,rates.clientRateCents ?? null);
    if (rate === null) throw new AppError('conflict','global hourly rate is not configured');
    return rate;
  }
  listClients(): ClientRecord[] { return this.repo.listClients(); }
  listCases(filter: { clientId?: string; status?: string }): CaseRecord[] {
    if (filter.status !== undefined && filter.status !== 'active' && filter.status !== 'archived') throw new AppError('invalid-request','status must be active or archived');
    return this.repo.listCases({ ...(filter.clientId ? { clientId:filter.clientId } : {}), ...(filter.status ? { status:filter.status } : {}) });
  }
  getSettings(): SettingsRecord {
    const s = this.repo.settings(); if (!s) throw new AppError('not-found','settings are not configured'); return s;
  }
  getSession(id: string): SessionRecord {
    const s = this.repo.session(id); if (!s) throw new AppError('not-found','session not found'); return s;
  }
  activeSession(): SessionRecord | null { return this.repo.activeSession(); }
  listSessions(): SessionRecord[] { return this.repo.listSessions(); }
  allPeriods(): Array<PeriodView & {clientId:string|null}> {
    return this.repo.allPeriods().map(p=>({...view(p),clientId:p.caseId ? this.repo.clientForCase(p.caseId) : null}));
  }
  allQuestions() { return this.repo.allQuestions(); }
  allSources() { return this.repo.allSources(); }
  coverageGaps() { return this.repo.coverageGaps(); }
  getPeriod(id: string): PeriodView & {clientId:string|null} {
    const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
    return {...view(p),clientId:p.caseId ? this.repo.clientForCase(p.caseId) : null};
  }
  listPeriods(sessionId: string): Array<PeriodView & {clientId:string|null}> {
    this.getSession(sessionId); return this.repo.listPeriods(sessionId).map(p => ({...view(p),clientId:p.caseId ? this.repo.clientForCase(p.caseId) : null}));
  }
  listSources(periodId: string) {
    this.getPeriod(periodId); return this.repo.listSources(periodId);
  }
  // The caller supplies an explicit established transition. Folder recognition and duration derivation remain open: docs/DESIGN_REVIEW.md.
  openPeriod(input: { id: string; sessionId: string; caseId: string | null; startedAt: string; origin: 'automatic' | 'lawyer' | 'unresolved'; mode: 'current' | 'recovery' }): PeriodView | { status: 'pending'; conflictId: string } {
    return this.repo.transaction(() => {
      assertId(input.id); assertTime(input.startedAt);
      const existing = this.repo.period(input.id);
      if (existing) {
        if (existing.sessionId !== input.sessionId || existing.initialCaseId !== input.caseId || existing.startedAt !== input.startedAt || existing.initialOrigin !== input.origin) throw new AppError('conflict','period ID reused with different transition');
        return view(existing);
      }
      const s = this.getSession(input.sessionId);
      if (Date.parse(input.startedAt) < Date.parse(s.startedAt) || (s.endedAt !== null && Date.parse(input.startedAt) > Date.parse(s.endedAt))) throw new AppError('conflict','period outside session');
      if (input.caseId !== null && !this.repo.caseExists(input.caseId)) throw new AppError('not-found','case not found');
      const active = this.repo.periodAt(s.id,input.startedAt);
      if (active) {
        if (Date.parse(input.startedAt) <= Date.parse(active.startedAt)) throw new AppError('conflict','transition at existing period start');
        if ((input.mode === 'recovery' || active.endedAt !== null || s.endedAt !== null) &&
            (active.detectedDurationMs !== null || active.durationOverrideMs !== null || timeIsValidated(active))) {
          this.repo.insertConflict(input.id,active.id,active.revision,input.startedAt,s.endedAt,'[]');
          return { status:'pending',conflictId:input.id };
        }
        this.repo.savePeriod({ ...active,endedAt:input.startedAt,revision:active.revision+1 },this.clock.now());
      }
      const nextPeriod = this.repo.nextPeriodAfter(s.id,input.startedAt);
      const p: PeriodRecord = { id:input.id,sessionId:s.id,caseId:input.caseId,initialCaseId:input.caseId,initialOrigin:input.origin,startedAt:input.startedAt,endedAt:active?.endedAt ?? nextPeriod?.startedAt ?? s.endedAt,
        detectedDurationMs:null,durationOverrideMs:null,assignmentOrigin:input.origin,assignmentRevision:0,effectiveRevision:0,
        validatedEffectiveRevision:null,timeValidatedAt:null,billingStatus:'unbilled',billedAt:null,revision:0 };
      this.repo.insertPeriod(p,this.clock.now());
      if (p.caseId === null) this.repo.saveQuestion({questionId:`period:${p.id}`,sessionId:p.sessionId,periodId:p.id,
        expectedAssignmentRevision:p.assignmentRevision,status:'pending',responseCommandId:null,responseResultJson:null});
      return view(p);
    });
  }
  // All assignment writes, including question answers and inference, enter here.
  assignPeriod(id: string, caseId: string, expectedAssignmentRevision: number, origin: 'automatic' | 'lawyer'): PeriodView {
    return this.repo.transaction(() => this.assignInside(id,caseId,expectedAssignmentRevision,origin));
  }
  private assignInside(id: string, caseId: string, expected: number, origin: 'automatic' | 'lawyer'): PeriodView {
    const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
    if (p.billingStatus === 'billed') throw new AppError('rule-not-decided','billed-period edit policy is open');
    if (p.assignmentRevision !== expected) throw new AppError('conflict','stale assignment revision');
    if (origin === 'automatic' && p.assignmentOrigin === 'lawyer') throw new AppError('conflict','manual assignment wins');
    if (!this.repo.caseExists(caseId)) throw new AppError('not-found','case not found');
    const next = { ...changePeriod(p,{ caseId,assignmentOrigin:origin }),revision:p.revision+1 };
    this.repo.savePeriod(next,this.clock.now());
    for (const question of this.repo.allQuestions().filter(q=>q.periodId === id && q.status === 'pending'))
      this.repo.saveQuestion({...question,status:'superseded'});
    return view(next);
  }
  askQuestion(input: { questionId: string; sessionId: string; periodId: string; expectedAssignmentRevision: number }): string {
    return this.repo.transaction(() => {
      const p = this.repo.period(input.periodId);
      if (!p || p.sessionId !== input.sessionId) throw new AppError('not-found','target period not found');
      const existing = this.repo.question(input.questionId);
      if (existing) {
        if (existing.sessionId !== input.sessionId || existing.periodId !== input.periodId || existing.expectedAssignmentRevision !== input.expectedAssignmentRevision) throw new AppError('conflict','question ID reused');
        if (existing.status==='superseded') {
          if (p.excluded || !canApplyQuestion(p,input.expectedAssignmentRevision)) throw new AppError('conflict','question target is stale');
          this.repo.saveQuestion({...existing,status:'pending'});
        }
        return existing.questionId;
      }
      const sameTarget=this.repo.allQuestions().find(q=>q.sessionId===input.sessionId && q.periodId===input.periodId &&
        q.expectedAssignmentRevision===input.expectedAssignmentRevision);
      if(sameTarget) {
        if (sameTarget.status==='superseded') {
          if (p.excluded || !canApplyQuestion(p,input.expectedAssignmentRevision)) throw new AppError('conflict','question target is stale');
          this.repo.saveQuestion({...sameTarget,status:'pending'});
        }
        return sameTarget.questionId;
      }
      if (p.excluded || !canApplyQuestion(p,input.expectedAssignmentRevision)) throw new AppError('conflict','question target is stale');
      this.repo.saveQuestion({ ...input,status:'pending',responseCommandId:null,responseResultJson:null });
      return input.questionId;
    });
  }
  answerQuestion(input: QuestionAnswer): PeriodView {
    return this.repo.transaction(() => {
      const q = this.repo.question(input.questionId);
      if (!q || q.sessionId !== input.sessionId || q.periodId !== input.periodId || q.expectedAssignmentRevision !== input.expectedAssignmentRevision) throw new AppError('not-found','question target not found');
      if (q.status === 'answered') {
        if (q.responseCommandId !== input.responseCommandId || JSON.parse(q.responseResultJson!).caseId !== input.caseId) throw new AppError('conflict','question already answered differently');
        return JSON.parse(q.responseResultJson!) as PeriodView;
      }
      if (q.status !== 'pending') throw new AppError('conflict','stale question was superseded');
      const p = this.repo.period(q.periodId);
      if (!p || !canApplyQuestion(p,q.expectedAssignmentRevision)) throw new AppError('conflict','stale question answer');
      const result = this.assignInside(p.id,input.caseId,q.expectedAssignmentRevision,'lawyer');
      this.repo.saveQuestion({ ...q,status:'answered',responseCommandId:input.responseCommandId,responseResultJson:JSON.stringify(result) });
      return result;
    });
  }
  setDetectedDuration(id: string, durationMs: number | null): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      if (p.billingStatus === 'billed' && durationMs !== p.detectedDurationMs) throw new AppError('rule-not-decided','billed-period edit policy is open');
      const next = { ...changePeriod(p,{ detectedDurationMs:durationMs }),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  setDurationOverride(id: string, durationMs: number | null, expectedEffectiveRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      assertEffectiveRevision(p,expectedEffectiveRevision);
      if (p.billingStatus === 'billed') throw new AppError('rule-not-decided','billed-period edit policy is open');
      const next = { ...changePeriod(p,{ durationOverrideMs:durationMs }),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  createManualPeriod(input:{sessionId:string;caseId:string;startedAt:string;durationMs:number;taskTypeId:number;label:string}):PeriodView {
    return this.repo.transaction(()=>{
      assertTime(input.startedAt);
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || !Number.isSafeInteger(input.taskTypeId) || input.taskTypeId < 1 || !input.label.trim())
        throw new AppError('invalid-request','invalid manual period');
      const session=this.getSession(input.sessionId);
      if (!this.repo.caseExists(input.caseId)) throw new AppError('not-found','case not found');
      const end=new Date(Date.parse(input.startedAt)+input.durationMs).toISOString();
      if (Date.parse(input.startedAt) < Date.parse(session.startedAt) || (session.endedAt !== null && Date.parse(end) > Date.parse(session.endedAt)))
        throw new AppError('conflict','manual period outside session');
      const id=randomUUID();
      const period:PeriodRecord={id,sessionId:session.id,caseId:input.caseId,initialCaseId:input.caseId,initialOrigin:'lawyer',
        startedAt:input.startedAt,endedAt:end,detectedDurationMs:null,durationOverrideMs:input.durationMs,
        assignmentOrigin:'lawyer',assignmentRevision:0,effectiveRevision:0,validatedEffectiveRevision:null,timeValidatedAt:null,
        billingStatus:'unbilled',billedAt:null,revision:0,taskTypeId:input.taskTypeId,label:input.label,billable:true,excluded:false};
      this.repo.insertPeriod(period,this.clock.now());
      return view(period);
    });
  }
  updatePeriodDetails(id:string,changes:{label?:string;billable?:boolean;nonbillableReason?:string|null;excluded?:boolean}):PeriodView {
    return this.repo.transaction(()=>{
      const period=this.repo.period(id);if (!period) throw new AppError('not-found','period not found');
      if (period.billingStatus === 'billed') throw new AppError('conflict','billed period must be unbilled before editing');
      if (changes.label !== undefined && (typeof changes.label !== 'string' || !changes.label.trim())) throw new AppError('invalid-request','label required');
      if (changes.billable !== undefined && typeof changes.billable !== 'boolean') throw new AppError('invalid-request','invalid billable flag');
      if (changes.excluded !== undefined && typeof changes.excluded !== 'boolean') throw new AppError('invalid-request','invalid excluded flag');
      if (changes.nonbillableReason !== undefined && changes.nonbillableReason !== null && !['offered','internal','admin'].includes(changes.nonbillableReason))
        throw new AppError('invalid-request','invalid nonbillable reason');
      const next={...period,...changes,revision:period.revision+1};
      this.repo.savePeriod(next,this.clock.now());
      if (changes.excluded === true) for (const question of this.repo.allQuestions().filter(q=>q.periodId===id && q.status==='pending'))
        this.repo.saveQuestion({...question,status:'superseded'});
      if (changes.excluded===false && period.excluded && next.caseId===null)
        this.askQuestion({questionId:`period:${id}:${next.assignmentRevision}`,sessionId:next.sessionId,
          periodId:id,expectedAssignmentRevision:next.assignmentRevision});
      return view(next);
    });
  }
  /** Removes the lawyer's time validation (docs/API.md D2). Idempotent; refused on billed periods. */
  unvalidatePeriod(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      assertEffectiveRevision(p,expectedEffectiveRevision);
      if (!timeIsValidated(p)) return view(p);
      if (p.billingStatus === 'billed') throw new AppError('conflict','billed period must be unbilled before removing time validation');
      const next = { ...p,validatedEffectiveRevision:null,timeValidatedAt:null,revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  validatePeriod(id: string, expectedEffectiveRevision?: number): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      assertEffectiveRevision(p,expectedEffectiveRevision);
      if (p.caseId === null || (p.durationOverrideMs ?? p.detectedDurationMs) === null)
        throw new AppError('conflict','case and effective duration are required before time validation');
      const next = { ...validateTime(p,this.clock.now()),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  setBillingStatus(id: string, status: 'unbilled' | 'billed'): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      if (status === 'unbilled' && p.invoiceId != null) throw new AppError('rule-not-decided','issued invoice reversal is not defined');
      if (status === 'billed' && (p.caseId === null || !timeIsValidated(p)))
        throw new AppError('conflict','time validation and a case are required before billing');
      const snapshot = status === 'billed' && p.billingStatus !== 'billed' && p.caseId ? this.currentRateForCase(p.caseId) : null;
      const next: PeriodRecord = { ...p,billingStatus:status,billedAt:status === 'billed' ? (p.billedAt ?? this.clock.now()) : null,
        appliedHourlyRateCents:status === 'billed' ? (p.appliedHourlyRateCents ?? snapshot) : null,
        appliedCurrency:status === 'billed' ? (p.appliedCurrency ?? 'USD') : null,revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  /** Imports evidence references all or nothing (docs/API.md A12). Results keep the order of the input. */
  importSources(inputs: SourceImport[]): SourceImportResult[] {
    return this.repo.transaction(() => inputs.map(input => this.importSource(input)));
  }
  importSource(input: SourceImport): SourceImportResult {
    return this.repo.transaction(() => {
      assertId(input.id); assertTime(input.recordedAt);
      if (input.periodId) {
        const p = this.repo.period(input.periodId); if (!p) throw new AppError('not-found','period not found');
        const s = this.getSession(p.sessionId);
        if (Date.parse(input.recordedAt) < Date.parse(s.startedAt) || (s.endedAt !== null && Date.parse(input.recordedAt) > Date.parse(s.endedAt))) throw new AppError('conflict','source outside session');
        if (Date.parse(input.recordedAt) < Date.parse(p.startedAt) || (p.endedAt !== null && Date.parse(input.recordedAt) > Date.parse(p.endedAt))) throw new AppError('conflict','source outside period');
      }
      const old = this.repo.sourceByIdentity(input.instanceId,input.contentType,input.externalId);
      if (old) {
        if (old.workPeriodId !== input.periodId || old.recordedAt !== input.recordedAt) throw new AppError('conflict','source identity changed');
        return { id:old.id,status:'unchanged' };
      }
      this.repo.insertSource({ id:input.id,workPeriodId:input.periodId,instanceId:input.instanceId,contentType:input.contentType,
        externalId:input.externalId,recordedAt:input.recordedAt,ingestedAt:this.clock.now(),validationStatus:'unvalidated',validatedAt:null,availabilityStatus:'unknown',availabilityCheckedAt:null });
      return { id:input.id,status:'imported' };
    });
  }
  validateSource(instanceId: string, contentType: string, externalId: string): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId,contentType,externalId); if (!s) throw new AppError('not-found','source not found');
      this.repo.saveSource({ ...s,validationStatus:'validated',validatedAt:s.validatedAt ?? this.clock.now() });
    });
  }
  /** Removes a source validation (docs/API.md D2). Idempotent. */
  unvalidateSource(instanceId: string, contentType: string, externalId: string): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId,contentType,externalId); if (!s) throw new AppError('not-found','source not found');
      if (s.validationStatus === 'unvalidated') return;
      this.repo.saveSource({ ...s,validationStatus:'unvalidated',validatedAt:null });
    });
  }
  setSourceAvailability(instanceId: string, contentType: string, externalId: string, availability: 'available' | 'unavailable'): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId,contentType,externalId); if (!s) throw new AppError('not-found','source not found');
      this.repo.saveSource({ ...s,availabilityStatus:availability,availabilityCheckedAt:this.clock.now() });
    });
  }
  proposeReconstruction(input: { id: string; periodId: string; expectedRevision: number; startedAt: string; endedAt: string | null; sourceReferences: string[] }): void {
    this.repo.transaction(() => {
      const p = this.repo.period(input.periodId); if (!p) throw new AppError('not-found','period not found');
      if (p.revision !== input.expectedRevision) throw new AppError('conflict','stale period revision');
      if (p.durationOverrideMs === null && !timeIsValidated(p)) throw new AppError('rule-not-decided','automatic reconstruction rule is open');
      this.repo.insertConflict(input.id,p.id,p.revision,input.startedAt,input.endedAt,JSON.stringify(input.sourceReferences));
    });
  }
}
