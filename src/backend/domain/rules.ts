export interface PeriodState {
  caseId: string | null;
  detectedDurationMs: number | null;
  durationOverrideMs: number | null;
  assignmentRevision: number;
  effectiveRevision: number;
  validatedEffectiveRevision: number | null;
  timeValidatedAt: string | null;
  assignmentOrigin: 'unresolved' | 'automatic' | 'lawyer';
}

export function effectiveDuration(period: Pick<PeriodState, 'detectedDurationMs' | 'durationOverrideMs'>): number | null {
  return period.durationOverrideMs ?? period.detectedDurationMs;
}

export function changePeriod<T extends PeriodState>(period: T, changes: Partial<Pick<PeriodState, 'caseId' | 'detectedDurationMs' | 'durationOverrideMs' | 'assignmentOrigin'>>): T {
  const next = { ...period, ...changes };
  if (next.detectedDurationMs !== null && (!Number.isSafeInteger(next.detectedDurationMs) || next.detectedDurationMs < 0)) throw new Error('invalid duration');
  if (next.durationOverrideMs !== null && (!Number.isSafeInteger(next.durationOverrideMs) || next.durationOverrideMs < 0)) throw new Error('invalid duration');
  if (next.caseId !== period.caseId) next.assignmentRevision++;
  if (next.caseId !== period.caseId || effectiveDuration(next) !== effectiveDuration(period)) {
    next.effectiveRevision++;
    next.validatedEffectiveRevision = null;
    next.timeValidatedAt = null;
  }
  return next;
}

export function validateTime<T extends PeriodState>(period: T, at: string): T {
  return { ...period, validatedEffectiveRevision: period.effectiveRevision, timeValidatedAt: at };
}

export function timeIsValidated(period: PeriodState): boolean {
  return period.validatedEffectiveRevision === period.effectiveRevision && period.timeValidatedAt !== null;
}

export function canApplyQuestion(period: PeriodState, expectedAssignmentRevision: number): boolean {
  return period.caseId === null && period.assignmentRevision === expectedAssignmentRevision;
}

export function endSession(startedAt: string, endedAt: string | null, requestedEnd: string): string {
  if (endedAt !== null) return endedAt;
  if (Date.parse(requestedEnd) < Date.parse(startedAt)) throw new Error('end before start');
  return requestedEnd;
}

export function resolveRate(caseRateCents: number | null, globalRateCents: number | null, clientRateCents: number | null = null): number | null {
  return caseRateCents ?? clientRateCents ?? globalRateCents;
}
