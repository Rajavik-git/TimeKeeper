export interface SummaryPeriod {
  id: string; caseId: string | null; clientId: string | null;
  startedAt: string; endedAt: string | null;
  detectedDurationMs: number | null; durationOverrideMs: number | null;
  coverage: 'complete' | 'incomplete';
  reconstructionCandidate?: boolean;
}
export interface Summary {
  preciseDurationMs: number;
  roundedMinutes: number;
  complete: boolean;
  incompletePeriodIds: string[];
}
export interface SummaryFilter { caseId?: string; clientId?: string; startAt?: string; endAt?: string }

export function summarize(periods: readonly SummaryPeriod[], filter: SummaryFilter = {}): Summary {
  let preciseDurationMs = 0;
  const incompletePeriodIds: string[] = [];
  for (const period of periods) {
    if (period.reconstructionCandidate) continue;
    if (filter.caseId !== undefined && period.caseId !== filter.caseId) continue;
    if (filter.clientId !== undefined && period.clientId !== filter.clientId) continue;
    // Range selection uses whole periods only. Clipping remains an open decision in docs/DESIGN_REVIEW.md.
    if (filter.startAt !== undefined && period.endedAt !== null && Date.parse(period.endedAt) <= Date.parse(filter.startAt)) continue;
    if (filter.endAt !== undefined && Date.parse(period.startedAt) >= Date.parse(filter.endAt)) continue;
    if ((filter.startAt !== undefined && Date.parse(period.startedAt) < Date.parse(filter.startAt)) ||
        (filter.endAt !== undefined && (period.endedAt === null || Date.parse(period.endedAt) > Date.parse(filter.endAt)))) {
      throw new Error('range clipping is pending a product decision: docs/DESIGN_REVIEW.md');
    }
    const duration = period.durationOverrideMs ?? period.detectedDurationMs;
    if (period.coverage === 'incomplete' || duration === null) incompletePeriodIds.push(period.id);
    if (duration !== null) {
      if (!Number.isSafeInteger(duration) || duration < 0) throw new Error('invalid duration');
      preciseDurationMs += duration;
      if (!Number.isSafeInteger(preciseDurationMs)) throw new Error('duration overflow');
    }
  }
  return { preciseDurationMs, roundedMinutes: Math.ceil(preciseDurationMs / 60000), complete: incompletePeriodIds.length === 0, incompletePeriodIds };
}
