import { api } from "./client";
import { actionErrorMessage, unavailableMessage } from "./errors";
import type { HistoryProposal } from "../../contracts/history";

async function result<T>(
  request: Promise<{ data?: T; error?: unknown }>,
  operation?: "generate" | "accept",
): Promise<T> {
  const response = await request.catch(() => {
    throw new Error(unavailableMessage);
  });
  if (response.error) {
    if (
      typeof response.error === "object" &&
      response.error !== null &&
      "error" in response.error &&
      response.error.error === "conflict"
    ) {
      if (operation === "accept") {
        throw new Error(
          "This proposal changed or overlaps an existing period. Your edits are kept. Refresh proposals before trying again.",
        );
      }
      // Application error messages are sanitized by the API. Keep generation prerequisites actionable.
      if (
        "message" in response.error &&
        typeof response.error.message === "string" &&
        response.error.message.trim()
      ) {
        throw new Error(response.error.message.trim());
      }
      throw new Error(
        operation === "generate"
          ? "History generation cannot start. Refresh proposals and check the selected range."
          : "This proposal changed. Refresh proposals before trying again.",
      );
    }
    throw new Error(actionErrorMessage(response.error));
  }
  if (!response.data) throw new Error("TimeKeeper returned no result. Refresh and try again.");
  return response.data;
}
export const historyApi = {
  async load(sessionId: string, signal: AbortSignal) {
    return result(api.GET("/api/history", { params: { query: { sessionId } }, signal }));
  },
  async generate(body: { sessionId: string; startAt: string; endAt: string }) {
    return result(api.POST("/api/history/generate", { body }), "generate");
  },
  async accept(
    id: string,
    body: {
      expectedRevision: number;
      caseId: string | null;
      startedAt: string;
      endedAt: string;
      label: string;
      durationMs: number;
    },
  ) {
    return result(
      api.POST("/api/history/proposals/{id}/accept", { params: { path: { id } }, body }),
      "accept",
    );
  },
  async reject(proposal: HistoryProposal) {
    return result(
      api.POST("/api/history/proposals/{id}/reject", {
        params: { path: { id: proposal.id } },
        body: { expectedRevision: proposal.revision },
      }),
    );
  },
};
