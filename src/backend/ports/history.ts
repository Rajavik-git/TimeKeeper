import type {
  HistoryJob,
  HistoryProposal,
  HistoryAcceptResult,
  HistoryCase,
} from "../../contracts/history.js";
import type { SessionRecord, SourceRecord, PeriodRecord } from "./repository.js";

export interface HistoryRunner {
  configured: boolean;
  dispatch(): Promise<"started" | "unconfirmed">;
}
export interface HistorySnapshot {
  catalogFingerprint: string;
  session: SessionRecord;
  sources: SourceRecord[];
  periods: PeriodRecord[];
  cases: HistoryCase[];
}
export interface StoredHistoryJob {
  job: HistoryJob;
  snapshot: HistorySnapshot;
  claimId: string | null;
  claimedAt: string | null;
  completionJson: string | null;
}
export interface StoredHistoryProposal {
  proposal: HistoryProposal;
  acceptanceJson: string | null;
  acceptanceResult: HistoryAcceptResult | null;
}
export interface HistoryStorage {
  transaction<T>(work: () => T): T;
  jobs(): StoredHistoryJob[];
  job(id: string): StoredHistoryJob | null;
  saveJob(value: StoredHistoryJob): void;
  proposals(jobId?: string): StoredHistoryProposal[];
  proposal(id: string): StoredHistoryProposal | null;
  saveProposal(value: StoredHistoryProposal): void;
}
