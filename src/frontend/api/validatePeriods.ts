import { api, type CoreState } from "./client";
import { isApiError } from "./errors";

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
      if (!result.error && !isApiError(result.data)) successful++;
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
  const periodLabel = total === 1 ? "period" : "periods";
  if (stale)
    return `Time validated for ${successful} of ${total} ${periodLabel}. A period changed. Review the latest data before validating again.${refreshFailed ? " Refresh the view." : ""}`;
  const progress =
    successful === total
      ? `Time validated for ${successful} ${periodLabel}`
      : `Time validated for ${successful} of ${total} ${periodLabel}. Retry the remaining periods`;
  return refreshFailed
    ? `${progress}. Displayed data could not refresh. Refresh the view.`
    : successful === total
      ? progress
      : `${progress}.`;
}
