export interface RetrievalWindow {
  id: string;
  sessionId: string;
  instanceId: string;
  startAt: string;
  endAt: string;
}
export type RetrievalStatus = "pending" | "complete" | "failed";
export interface RetrievalStore {
  transaction<T>(work: () => T): T;
  checkpoint(sessionId: string, instanceId: string): string | null;
  earliestIncomplete(sessionId: string, instanceId: string): string | null;
  save(window: RetrievalWindow, status: RetrievalStatus, now: string): void;
  discard(id: string): void;
  closeCoveredGaps(sessionId: string, instanceId: string, now: string): void;
}
