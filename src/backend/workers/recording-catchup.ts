import { screenpipeFailure, type ScreenpipeSyncError } from "../ports/screenpipe-integration.js";
import type { ScreenpipeMemory } from "../ports/index.js";
import type { RetrievalWindow } from "../ports/retrieval.js";

/** The retrieval operations used by the catch-up worker. */
export interface CatchUpService {
  retrievalPlan(
    instanceId: string,
    now: string,
    o: { windowMs: number; overlapMs: number; maxWindows: number },
  ): RetrievalWindow[];
  beginRetrieval(w: RetrievalWindow): void;
  currentWindow(w: RetrievalWindow): RetrievalWindow | null;
  completeRetrieval(w: RetrievalWindow): void;
  failRetrieval(w: RetrievalWindow): void;
  reconcileUnlinked?(instanceId: string): string[];
  periodIdAt(sessionId: string, at: string): string | null;
  importSource(input: {
    id: string;
    periodId: string | null;
    instanceId: string;
    contentType: string;
    externalId: string;
    recordedAt: string;
    excerpt?: string;
    appName?: string;
    windowName?: string;
  }): { id?: string; status: "imported" | "unchanged" | "preserved" | "updated" };
}
export interface CatchUpResult {
  windows: number;
  imported: number;
  updated?: number;
  unchanged: number;
  skipped: number;
  /** Set when a window could not be read; that window is marked failed and shows as a coverage gap. */
  stoppedBy?: string;
  retryable?: boolean;
  failureCode?: ScreenpipeSyncError;
}

export const CATCH_UP_DEFAULTS = { windowMs: 60 * 60_000, overlapMs: 5 * 60_000, maxWindows: 24 };

/**
 * Catches up recordings missed while TimeKeeper was closed (docs/API.md D8 step 4). Reads each planned window from
 * Screenpipe, attaches every reference to the work period it falls in (or leaves it unlinked), and imports it through
 * the internal evidence service path, preserving existing attachments and filling missing context. A window is marked complete only after its
 * references are saved; a failed read marks it failed and stops the run, so the next run starts again from there.
 */
export async function catchUpRecordings(
  memory: ScreenpipeMemory,
  service: CatchUpService,
  instanceId: string,
  now: string,
  options: typeof CATCH_UP_DEFAULTS & {
    signal?: AbortSignal;
    onProgress?: (counts: CatchUpResult) => void;
  } = CATCH_UP_DEFAULTS,
): Promise<CatchUpResult> {
  const result: CatchUpResult = { windows: 0, imported: 0, unchanged: 0, skipped: 0 };
  const progress = () => options.onProgress?.({ ...result });
  if (options.signal?.aborted) return result;
  const updatedIds = new Set(service.reconcileUnlinked?.(instanceId) ?? []);
  if (updatedIds.size) {
    result.updated = updatedIds.size;
    progress();
  }
  for (const planned of service.retrievalPlan(instanceId, now, options)) {
    let window = service.currentWindow(planned);
    if (!window) continue;
    if (options.signal?.aborted) return result;
    service.beginRetrieval(window);
    let observations;
    try {
      observations = await memory.read(window.startAt, window.endAt);
    } catch (error) {
      if (options.signal?.aborted) return result;
      const failed = service.currentWindow(window);
      if (failed) service.failRetrieval(failed);
      result.stoppedBy =
        error instanceof Error && "retryable" in error ? error.message : "Screenpipe read failed";
      result.failureCode = screenpipeFailure(error);
      progress();
      result.retryable = !(
        error instanceof Error &&
        "retryable" in error &&
        error.retryable === false
      );
      return result;
    }
    if (options.signal?.aborted) return result;
    const current = service.currentWindow(window);
    if (!current) continue;
    window = current;
    for (const o of observations) {
      if (options.signal?.aborted) return result;
      // Window overlap and late indexing can return references outside the session; leave those out.
      if (
        o.instanceId !== instanceId ||
        Date.parse(o.recordedAt) < Date.parse(window.startAt) ||
        Date.parse(o.recordedAt) > Date.parse(window.endAt)
      ) {
        result.skipped++;
        progress();
        continue;
      }
      try {
        const { id, status } = service.importSource({
          id: `sp:${o.instanceId}:${o.contentType}:${o.externalId}`,
          periodId: service.periodIdAt(window.sessionId, o.recordedAt),
          instanceId: o.instanceId,
          contentType: o.contentType,
          externalId: o.externalId,
          recordedAt: o.recordedAt,
          excerpt: o.excerpt,
          appName: o.appName,
          windowName: o.windowName,
        });
        if (status === "updated") {
          updatedIds.add(id ?? `sp:${o.instanceId}:${o.contentType}:${o.externalId}`);
          result.updated = updatedIds.size;
        } else result[status === "preserved" ? "skipped" : status]++;
        progress();
      } catch (error) {
        service.failRetrieval(window);
        throw error;
      }
    }
    service.completeRetrieval(window);
    result.windows++;
    progress();
  }
  return result;
}
