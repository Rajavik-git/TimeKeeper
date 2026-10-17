import { AppError } from '../ports/errors.js';
import type { ScreenpipeMemory } from '../ports/index.js';
import type { RetrievalWindow } from '../ports/repository.js';

/** The service operations the catch-up needs (TimeKeeperService implements them). */
export interface CatchUpService {
  retrievalPlan(instanceId: string, now: string, o: { windowMs: number; overlapMs: number; maxWindows: number }): RetrievalWindow[];
  beginRetrieval(w: RetrievalWindow): void;
  completeRetrieval(w: RetrievalWindow): void;
  failRetrieval(w: RetrievalWindow): void;
  periodIdAt(sessionId: string, at: string): string | null;
  importSource(input: { id: string; periodId: string | null; instanceId: string; contentType: string; externalId: string; recordedAt: string }): { status: 'imported' | 'unchanged' };
}
export interface CatchUpResult {
  windows: number; imported: number; unchanged: number; skipped: number;
  /** Set when a window could not be read; that window is marked failed and shows as a coverage gap. */
  stoppedBy?: string;
}

export const CATCH_UP_DEFAULTS = { windowMs: 60 * 60_000, overlapMs: 5 * 60_000, maxWindows: 24 };

/**
 * Catches up recordings missed while TimeKeeper was closed (docs/API.md D8 step 4). Reads each planned window from
 * Screenpipe, attaches every reference to the work period it falls in (or leaves it unlinked), and imports it through
 * the same service as POST /api/sources, so duplicates change nothing. A window is marked complete only after its
 * references are saved; a failed read marks it failed and stops the run, so the next run starts again from there.
 */
export async function catchUpRecordings(memory: ScreenpipeMemory, service: CatchUpService, instanceId: string,
  now: string, options = CATCH_UP_DEFAULTS): Promise<CatchUpResult> {
  const result: CatchUpResult = { windows: 0, imported: 0, unchanged: 0, skipped: 0 };
  for (const window of service.retrievalPlan(instanceId, now, options)) {
    service.beginRetrieval(window);
    let observations;
    try {
      observations = await memory.read(window.startAt, window.endAt);
    } catch (error) {
      service.failRetrieval(window);
      result.stoppedBy = error instanceof Error ? error.message : 'Screenpipe read failed';
      return result;
    }
    for (const o of observations) {
      // Window overlap and late indexing can return references outside the session; leave those out.
      if (o.recordedAt < window.startAt || o.recordedAt > window.endAt) { result.skipped++; continue; }
      try {
        const { status } = service.importSource({
          id: `sp:${o.instanceId}:${o.contentType}:${o.externalId}`, periodId: service.periodIdAt(window.sessionId, o.recordedAt),
          instanceId: o.instanceId, contentType: o.contentType, externalId: o.externalId, recordedAt: o.recordedAt,
        });
        result[status === 'imported' ? 'imported' : 'unchanged']++;
      } catch (error) {
        // An existing reference attached differently (for example after a correction) is kept as it is.
        if (error instanceof AppError) { result.skipped++; continue; }
        service.failRetrieval(window);
        throw error;
      }
    }
    service.completeRetrieval(window);
    result.windows++;
  }
  return result;
}
