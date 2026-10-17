import { createHash, randomUUID } from 'node:crypto';
import type { CommandOutcome, EndCommand, PeriodView, QuestionAnswer, StartCommand } from '../../contracts/index.js';
import { canApplyQuestion, changePeriod, endSession, resolveRate, timeIsValidated, validateTime } from '../domain/rules.js';
import type { Clock } from '../ports/index.js';
import type { CommandRecord, PeriodRecord, Repository, SessionRecord } from '../ports/repository.js';

export class AppError extends Error {
  constructor(readonly code: 'no-active-session' | 'not-found' | 'conflict' | 'pending' | 'invalid-request', message: string) { super(message); }
}
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertTime(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AppError('invalid-request', 'UTC timestamp required');
}
function assertId(value: string): void { if (!value || value.length > 200) throw new AppError('invalid-request', 'invalid identifier'); }
function view(p: PeriodRecord): PeriodView {
  return { id:p.id, sessionId:p.sessionId, caseId:p.caseId, startedAt:p.startedAt, endedAt:p.endedAt,
    detectedDurationMs:p.detectedDurationMs, durationOverrideMs:p.durationOverrideMs, assignmentRevision:p.assignmentRevision,
    effectiveRevision:p.effectiveRevision, validatedEffectiveRevision:p.validatedEffectiveRevision,
    timeValidated:timeIsValidated(p), billingStatus:p.billingStatus };
}

export class TimeKeeperService {
  constructor(private readonly repo: Repository, private readonly clock: Clock = { now: () => new Date().toISOString() }) {}
  private existing(command: StartCommand | EndCommand, kind: 'start' | 'end'): CommandOutcome | null {
    const found = this.repo.command(command.producerId,command.commandId);
    if (!found) return null;
    if (found.kind !== kind || found.payloadFingerprint !== fingerprint(command)) throw new AppError('conflict','command ID reused with different payload');
    if (found.status === 'pending') return { status:'pending', commandId:command.commandId };
    if (found.status === 'rejected') {
      const rejected = JSON.parse(found.resultJson ?? '{}') as { error?: AppError['code']; message?: string };
      throw new AppError(rejected.error ?? 'conflict',rejected.message ?? 'command was rejected');
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
    const rate = resolveRate(rates.caseRateCents,rates.globalRateCents);
    if (rate === null) throw new AppError('pending','global hourly rate is not configured');
    return rate;
  }
  getSession(id: string): SessionRecord {
    const s = this.repo.session(id); if (!s) throw new AppError('not-found','session not found'); return s;
  }
  getPeriod(id: string): PeriodView {
    const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found'); return view(p);
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
        if ((input.mode === 'recovery' || active.endedAt !== null || s.endedAt !== null) && (active.durationOverrideMs !== null || timeIsValidated(active))) {
          this.repo.insertConflict(input.id,active.id,active.revision,input.startedAt,s.endedAt,'[]');
          return { status:'pending',conflictId:input.id };
        }
        this.repo.savePeriod({ ...active,endedAt:input.startedAt,revision:active.revision+1 },this.clock.now());
      }
      const nextPeriod = this.repo.nextPeriodAfter(s.id,input.startedAt);
      const p: PeriodRecord = { id:input.id,sessionId:s.id,caseId:input.caseId,initialCaseId:input.caseId,initialOrigin:input.origin,startedAt:input.startedAt,endedAt:active?.endedAt ?? nextPeriod?.startedAt ?? s.endedAt,
        detectedDurationMs:null,durationOverrideMs:null,assignmentOrigin:input.origin,assignmentRevision:0,effectiveRevision:0,
        validatedEffectiveRevision:null,timeValidatedAt:null,billingStatus:'unbilled',billedAt:null,revision:0 };
      this.repo.insertPeriod(p,this.clock.now()); return view(p);
    });
  }
  // All assignment writes, including question answers and inference, enter here.
  assignPeriod(id: string, caseId: string, expectedAssignmentRevision: number, origin: 'automatic' | 'lawyer'): PeriodView {
    return this.repo.transaction(() => this.assignInside(id,caseId,expectedAssignmentRevision,origin));
  }
  private assignInside(id: string, caseId: string, expected: number, origin: 'automatic' | 'lawyer'): PeriodView {
    const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
    if (p.billingStatus === 'billed') throw new AppError('pending','billed-period edit policy is open');
    if (p.assignmentRevision !== expected) throw new AppError('conflict','stale assignment revision');
    if (origin === 'automatic' && p.assignmentOrigin === 'lawyer') throw new AppError('conflict','manual assignment wins');
    if (!this.repo.caseExists(caseId)) throw new AppError('not-found','case not found');
    const next = { ...changePeriod(p,{ caseId,assignmentOrigin:origin }),revision:p.revision+1 };
    this.repo.savePeriod(next,this.clock.now()); return view(next);
  }
  askQuestion(input: { questionId: string; sessionId: string; periodId: string; expectedAssignmentRevision: number }): void {
    this.repo.transaction(() => {
      const p = this.repo.period(input.periodId);
      if (!p || p.sessionId !== input.sessionId) throw new AppError('not-found','target period not found');
      const existing = this.repo.question(input.questionId);
      if (existing) {
        if (existing.periodId !== input.periodId || existing.expectedAssignmentRevision !== input.expectedAssignmentRevision) throw new AppError('conflict','question ID reused');
        return;
      }
      if (!canApplyQuestion(p,input.expectedAssignmentRevision)) throw new AppError('conflict','question target is stale');
      this.repo.saveQuestion({ ...input,status:'pending',responseCommandId:null,responseResultJson:null });
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
      if (q.status !== 'pending') throw new AppError('conflict','question was superseded');
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
      if (p.billingStatus === 'billed' && durationMs !== p.detectedDurationMs) throw new AppError('pending','billed-period edit policy is open');
      const next = { ...changePeriod(p,{ detectedDurationMs:durationMs }),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  setDurationOverride(id: string, durationMs: number | null): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      if (p.billingStatus === 'billed') throw new AppError('pending','billed-period edit policy is open');
      const next = { ...changePeriod(p,{ durationOverrideMs:durationMs }),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  validatePeriod(id: string): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      const next = { ...validateTime(p,this.clock.now()),revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  setBillingStatus(id: string, status: 'unbilled' | 'billed'): PeriodView {
    return this.repo.transaction(() => {
      const p = this.repo.period(id); if (!p) throw new AppError('not-found','period not found');
      const next: PeriodRecord = { ...p,billingStatus:status,billedAt:status === 'billed' ? (p.billedAt ?? this.clock.now()) : null,revision:p.revision+1 };
      this.repo.savePeriod(next,this.clock.now()); return view(next);
    });
  }
  importSource(input: { id: string; periodId: string | null; instanceId: string; contentType: string; externalId: string; recordedAt: string }): void {
    this.repo.transaction(() => {
      assertTime(input.recordedAt);
      if (input.periodId) {
        const p = this.repo.period(input.periodId); if (!p) throw new AppError('not-found','period not found');
        const s = this.getSession(p.sessionId);
        if (Date.parse(input.recordedAt) < Date.parse(s.startedAt) || (s.endedAt !== null && Date.parse(input.recordedAt) > Date.parse(s.endedAt))) throw new AppError('conflict','source outside session');
        if (Date.parse(input.recordedAt) < Date.parse(p.startedAt) || (p.endedAt !== null && Date.parse(input.recordedAt) > Date.parse(p.endedAt))) throw new AppError('conflict','source outside period');
      }
      const old = this.repo.sourceByIdentity(input.instanceId,input.contentType,input.externalId);
      if (old) {
        if (old.workPeriodId !== input.periodId || old.recordedAt !== input.recordedAt) throw new AppError('conflict','source identity changed');
        return;
      }
      this.repo.insertSource({ id:input.id,workPeriodId:input.periodId,instanceId:input.instanceId,contentType:input.contentType,
        externalId:input.externalId,recordedAt:input.recordedAt,ingestedAt:this.clock.now(),validationStatus:'unvalidated',validatedAt:null,availabilityStatus:'unknown',availabilityCheckedAt:null });
    });
  }
  validateSource(instanceId: string, contentType: string, externalId: string): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId,contentType,externalId); if (!s) throw new AppError('not-found','source not found');
      this.repo.saveSource({ ...s,validationStatus:'validated',validatedAt:s.validatedAt ?? this.clock.now() });
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
      if (p.durationOverrideMs === null && !timeIsValidated(p)) throw new AppError('pending','automatic reconstruction rule is open');
      this.repo.insertConflict(input.id,p.id,p.revision,input.startedAt,input.endedAt,JSON.stringify(input.sourceReferences));
    });
  }
}
