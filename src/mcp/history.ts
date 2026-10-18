import type { HistoryClaim, HistoryJob } from "../contracts/history.js";
import { proposeHistory } from "../../integrations/screenpipe/jev-check/history.js";
import { postApiJson } from "./api-client.js";
import type { SessionDeps } from "./session.js";

/** Screenpipe pipe command. No pending, explicitly requested job means no inference. */
export async function generateHistoryProposals(
  deps: SessionDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: string; jobId?: string; proposals?: number }> {
  let claim: HistoryClaim | null = null;
  try {
    const response = await postApiJson(deps, "/history/claim", {});
    if (!response.ok) return { status: "claim-failed" };
    claim = (await response.json()) as HistoryClaim | null;
    if (!claim) return { status: "no-pending-job" };
    const proposals = await proposeHistory(claim, env, deps.fetch);
    const result = await postApiJson(
      deps,
      `/history/jobs/${encodeURIComponent(claim.job.id)}/complete`,
      {
        claimId: claim.claimId,
        proposals,
      },
    );
    if (!result.ok) return { status: "submission-unconfirmed", jobId: claim.job.id };
    const job = (await result.json()) as HistoryJob;
    return {
      status: job.status === "ready" ? "ready" : "submission-unconfirmed",
      jobId: job.id,
      proposals: job.proposalCount,
    };
  } catch (error) {
    if (claim) {
      try {
        await postApiJson(deps, `/history/jobs/${encodeURIComponent(claim.job.id)}/fail`, {
          claimId: claim.claimId,
          error:
            error instanceof Error &&
            ["inference-failed", "not-configured", "history-too-large"].includes(error.message)
              ? error.message
              : "workflow-failed",
        });
      } catch {
        /* The persisted execution deadline reports interrupted delivery. */
      }
    }
    return { status: "generation-failed", ...(claim ? { jobId: claim.job.id } : {}) };
  }
}
