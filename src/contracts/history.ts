import type { PeriodView } from "./index.js";
import type { components } from "./generated.js";
type PeriodSource = components["schemas"]["PeriodSource"];
type SessionView = components["schemas"]["Session"];
export interface HistoryCase {
  id: string;
  clientId: string;
  reference: string;
  title: string;
  clientName: string;
}

export type HistoryJobStatus =
  | "dispatching"
  | "dispatched"
  | "dispatch-unconfirmed"
  | "running"
  | "ready"
  | "failed"
  | "expired";
export type HistoryFailure =
  | "dispatch-failed"
  | "workflow-failed"
  | "inference-failed"
  | "stale-snapshot"
  | "expired"
  | "not-configured"
  | "history-too-large";
export interface HistoryJob {
  id: string;
  sessionId: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  finishedAt: string | null;
  status: HistoryJobStatus;
  error: HistoryFailure | null;
  sourceCount: number;
  proposalCount: number;
}
export interface HistoryProposalInput {
  caseId: string | null;
  startedAt: string;
  endedAt: string;
  label: string;
  confidence: number | null;
  sourceIds: string[];
  hasGaps: boolean;
}
export interface HistoryProposal extends HistoryProposalInput {
  id: string;
  jobId: string;
  sessionId: string;
  revision: number;
  status: "draft" | "accepted" | "rejected";
  acceptedPeriodId: string | null;
}
export interface HistoryState {
  configured: boolean;
  jobs: HistoryJob[];
  proposals: HistoryProposal[];
}
export interface HistoryGenerateInput {
  sessionId: string;
  startAt: string;
  endAt: string;
}
export interface HistoryAcceptInput {
  expectedRevision: number;
  caseId: string | null;
  startedAt: string;
  endedAt: string;
  label: string;
  durationMs: number;
}
export interface HistoryAcceptResult {
  proposal: HistoryProposal;
  period: PeriodView;
}
export interface HistoryClaim {
  job: HistoryJob;
  claimId: string;
  session: SessionView;
  sources: PeriodSource[];
  cases: HistoryCase[];
}
