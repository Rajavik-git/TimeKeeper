import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import type { Repository } from "../ports/repository.js";
import type { Clock } from "../ports/index.js";
import type { RetrievalStore, RetrievalWindow } from "../ports/retrieval.js";

type SourceInput = {
  id: string;
  periodId: string | null;
  instanceId: string;
  contentType: string;
  externalId: string;
  recordedAt: string;
  excerpt?: string;
  appName?: string;
  windowName?: string;
};
type EvidenceImporter = {
  importRetrievedSource(input: SourceInput): {
    id: string;
    status: "imported" | "unchanged" | "updated";
  };
};
type RetrievalRepository = Pick<
  Repository,
  "transaction" | "listSessions" | "listPeriods" | "allSources"
>;
export interface RetrievalOptions {
  windowMs: number;
  overlapMs: number;
  maxWindows: number;
}

/** Plans bounded API reads. It imports observations without reconstructing worked duration. */
export class RetrievalService {
  constructor(
    private readonly repo: RetrievalRepository,
    private readonly store: RetrievalStore,
    private readonly evidence: EvidenceImporter,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {}

  retrievalPlan(instanceId: string, now: string, options: RetrievalOptions): RetrievalWindow[] {
    const { windowMs, overlapMs, maxWindows } = options;
    if (
      ![windowMs, overlapMs, maxWindows].every(Number.isSafeInteger) ||
      windowMs <= 0 ||
      overlapMs < 0 ||
      maxWindows <= 0
    )
      throw new AppError("invalid-request", "invalid retrieval options");
    const limit = Date.parse(now);
    if (!Number.isFinite(limit)) throw new AppError("invalid-request", "invalid retrieval time");
    const plan: RetrievalWindow[] = [];
    const tails: RetrievalWindow[] = [];
    const sessions = [...this.repo.listSessions()].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
    const window = (sessionId: string, start: number, end: number): RetrievalWindow => {
      const startAt = new Date(start).toISOString(),
        endAt = new Date(end).toISOString();
      const id = createHash("sha256")
        .update(JSON.stringify([sessionId, instanceId, startAt, endAt]))
        .digest("hex");
      return { id, sessionId, instanceId, startAt, endAt };
    };
    for (const session of sessions) {
      const first = Date.parse(session.startedAt);
      const end = Math.min(Date.parse(session.endedAt ?? now), limit);
      const checkpoint = this.store.checkpoint(session.id, instanceId);
      const incomplete = this.store.earliestIncomplete(session.id, instanceId);
      if (checkpoint !== null && Date.parse(checkpoint) >= end && incomplete === null) {
        // Revisit the bounded final overlap after session end, including evidence indexed after the final read.
        const start = Math.max(first, end - Math.min(overlapMs, windowMs));
        if (start < end) tails.push(window(session.id, start, end));
        continue;
      }
      let start = Math.max(first, checkpoint === null ? first : Date.parse(checkpoint) - overlapMs);
      if (incomplete !== null) start = Math.max(first, Math.min(start, Date.parse(incomplete)));
      while (start < end && plan.length < maxWindows) {
        const stop = Math.min(start + windowMs, end);
        plan.push(window(session.id, start, stop));
        start = stop;
      }
    }
    // Catch unfinished history before repeating completed tails, so old backlogs are not starved by refreshes.
    return plan.concat(tails.slice(0, Math.max(0, maxWindows - plan.length)));
  }
  beginRetrieval(window: RetrievalWindow): void {
    this.store.transaction(() => this.store.save(window, "pending", this.clock.now()));
  }
  currentWindow(window: RetrievalWindow): RetrievalWindow | null {
    const session = this.repo.listSessions().find((item) => item.id === window.sessionId);
    if (!session) throw new AppError("not-found", "retrieval session not found");
    const startAt = new Date(
      Math.max(Date.parse(window.startAt), Date.parse(session.startedAt)),
    ).toISOString();
    const endAt = new Date(
      Math.min(Date.parse(window.endAt), Date.parse(session.endedAt ?? window.endAt)),
    ).toISOString();
    if (startAt === window.startAt && endAt === window.endAt) return window;
    return this.store.transaction(() => {
      // An original-time End can arrive while Screenpipe is being read. Replace the obsolete pending range.
      this.store.discard(window.id);
      if (Date.parse(startAt) >= Date.parse(endAt)) return null;
      const id = createHash("sha256")
        .update(JSON.stringify([window.sessionId, window.instanceId, startAt, endAt]))
        .digest("hex");
      const current = { ...window, id, startAt, endAt };
      this.store.save(current, "pending", this.clock.now());
      return current;
    });
  }
  failRetrieval(window: RetrievalWindow): void {
    this.store.transaction(() => this.store.save(window, "failed", this.clock.now()));
  }
  completeRetrieval(window: RetrievalWindow): void {
    this.store.transaction(() => {
      this.store.save(window, "complete", this.clock.now());
      this.store.closeCoveredGaps(window.sessionId, window.instanceId, this.clock.now());
    });
  }
  periodIdAt(sessionId: string, at: string): string | null {
    const time = Date.parse(at);
    const sessions = this.repo.listSessions();
    const containing = sessions.filter(
      (s) =>
        time >= Date.parse(s.startedAt) && (s.endedAt === null || time <= Date.parse(s.endedAt)),
    );
    if (containing.length !== 1 || containing[0].id !== sessionId) return null;
    const session = containing[0];
    if (
      !session ||
      time < Date.parse(session.startedAt) ||
      (session.endedAt !== null && time > Date.parse(session.endedAt))
    )
      return null;
    const sessionEnd = session.endedAt === null ? null : Date.parse(session.endedAt);
    const matches = this.repo.listPeriods(sessionId).filter((p) => {
      const end = p.endedAt === null ? null : Date.parse(p.endedAt);
      return (
        time >= Date.parse(p.startedAt) &&
        (end === null || time < end || (time === end && end === sessionEnd))
      );
    });
    return matches.length === 1 ? matches[0].id : null;
  }
  /** Reconcile local references even when their provider window is no longer read. */
  reconcileUnlinked(instanceId: string): string[] {
    return this.repo.transaction(() => {
      const sessions = this.repo.listSessions();
      const updated: string[] = [];
      for (const source of this.repo.allSources()) {
        if (source.instanceId !== instanceId || source.workPeriodId !== null) continue;
        const time = Date.parse(source.recordedAt);
        const matches = sessions.filter(
          (s) =>
            time >= Date.parse(s.startedAt) &&
            (s.endedAt === null || time <= Date.parse(s.endedAt)),
        );
        if (matches.length !== 1) continue;
        const periodId = this.periodIdAt(matches[0].id, source.recordedAt);
        if (!periodId) continue;
        if (
          this.importSource({
            id: source.id,
            instanceId: source.instanceId,
            contentType: source.contentType,
            externalId: source.externalId,
            recordedAt: source.recordedAt,
            periodId,
          }).status === "updated"
        )
          updated.push(source.id);
      }
      return updated;
    });
  }
  importSource(input: SourceInput): { id: string; status: "imported" | "unchanged" | "updated" } {
    return this.evidence.importRetrievedSource(input);
  }
}
