import { api } from "./client";

/** Keep committed progress visible when another request or the following read fails. */
export async function validatePeriods(ids: readonly string[], refresh: () => Promise<void>) {
  let successful = 0;
  for (const id of ids) {
    try {
      const result = await api.POST("/api/work-periods/{id}/validate-time", {
        params: { path: { id } },
        body: {},
      });
      if (!result.error) successful++;
    } catch {
      break;
    }
  }
  let refreshFailed = false;
  if (successful) {
    try {
      await refresh();
    } catch {
      refreshFailed = true;
    }
  }
  return { successful, refreshFailed };
}

export function validationMessage(successful: number, total: number, refreshFailed: boolean) {
  const progress =
    successful === total
      ? `${successful} period${successful === 1 ? "" : "s"} validated`
      : `${successful} of ${total} periods validated. Please retry the rest.`;
  return refreshFailed
    ? `${progress}. Displayed data could not refresh. Refresh the view.`
    : progress;
}
