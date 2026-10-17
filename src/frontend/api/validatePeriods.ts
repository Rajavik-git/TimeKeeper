import { api, type CoreState } from "./client";

/** Keep committed progress visible when another request or the following read fails. */
export async function validatePeriods(
  periods: readonly Pick<CoreState["periods"][number], "id" | "effectiveRevision">[],
  refresh: () => Promise<void>,
) {
  let successful = 0;
  let stale = false;
  for (const period of periods) {
    try {
      const result = await api.POST("/api/work-periods/{id}/validate-time", {
        params: { path: { id: period.id } },
        body: { expectedEffectiveRevision: period.effectiveRevision },
      });
      if (!result.error) successful++;
      else if (result.response?.status === 409) {
        stale = true;
        break;
      }
    } catch {
      break;
    }
  }
  let refreshFailed = false;
  if (successful || stale) {
    try {
      await refresh();
    } catch {
      refreshFailed = true;
    }
  }
  return { successful, refreshFailed, stale };
}

export function validationMessage(
  successful: number,
  total: number,
  refreshFailed: boolean,
  stale = false,
) {
  if (stale)
    return `${successful} of ${total} periods validated. A period changed. Review the latest data before validating again.${refreshFailed ? " Refresh the view." : ""}`;
  const progress =
    successful === total
      ? `${successful} period${successful === 1 ? "" : "s"} validated`
      : `${successful} of ${total} periods validated. Please retry the rest.`;
  return refreshFailed
    ? `${progress}. Displayed data could not refresh. Refresh the view.`
    : progress;
}
