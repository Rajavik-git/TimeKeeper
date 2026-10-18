import { configuredClientRate } from "../../../../calculations/billing";
import { clientTypeLabels } from "../../../../shared/presentation/catalog";
import { CaseStatus } from "../../../../../contracts/states.generated";
import { calendarDay } from "../../../../../shared/dates";
import type { Case, Client, ScreenProps } from "../../../../api/client";
import { clientMetrics } from "../../../../calculations/cases";
import {
  effectiveMs,
  formatNearestMinuteDuration,
  formatRoundedMinutes,
} from "../../../../calculations/billing";
import { money as formatMoney, rate as displayRate, shortDate } from "../../../../shared/format";
import { CaseStats } from "../CaseStats/CaseStats";
import { CaseTile } from "../CaseTile/CaseTile";
import { periodLabel } from "../CaseTimeTable/CaseTimeTable";
import { visibleValue } from "../../lib/casePresentation";
import type { ReactNode } from "react";
type Props = Pick<ScreenProps, "catalogState" | "workspaceState" | "navigate"> & {
  currentClient: Client;
  header: (title: string, description: string) => ReactNode;
  openCase: (item: Case) => void;
  onNewCase: () => void;
};
export function ClientDetail({
  catalogState,
  workspaceState,
  currentClient,
  header,
  openCase,
  navigate,
  onNewCase,
}: Props) {
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency);
  const formatRate = (cents: number) => displayRate(cents, catalogState.settings.currency);
  const m = clientMetrics(catalogState, workspaceState, currentClient.id);
  const clientCases = new Map(m.cases.map((item) => [String(item.id), item]));
  const recentPeriods = workspaceState.periods
    .filter(
      (period) => !period.excluded && period.caseId !== null && clientCases.has(period.caseId),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id))
    .slice(0, 5);
  const clientDescription = `${clientTypeLabels[currentClient.type]} · ${formatRate(configuredClientRate(catalogState, currentClient))}${visibleValue(currentClient.billingAddress) ? ` · billing address ${currentClient.billingAddress}` : ""}`;
  return (
    <>
      {header(currentClient.name, clientDescription)}
      {
        <CaseStats
          items={[
            [
              "Cases",
              m.cases.length,
              `${m.cases.filter((item) => item.status === CaseStatus.Active).length} active`,
            ],
            [
              "Time recorded",
              `${formatRoundedMinutes(m.recordedMinutes)}${m.complete ? "" : " · partial"}`,
              "All cases",
            ],
            ["To bill", money(m.toBillCents), "Before expenses"],
            ["Time to validate", m.pending, "Periods"],
          ]}
        />
      }
      <div className="cases-client-content cases-fill">
        <div className="case-scroll case-grid cases-client-grid">
          {m.cases.length ? (
            m.cases.map((item) => (
              <CaseTile
                key={item.id}
                item={item}
                catalogState={catalogState}
                workspaceState={workspaceState}
                onOpen={openCase}
              />
            ))
          ) : (
            <p className="case-empty">
              No cases for this client yet.{" "}
              <button onClick={() => onNewCase()}>Create a case</button>
            </p>
          )}
        </div>
        <section className="card cases-recent">
          <div className="card-h">
            <div className="t">
              <h2>Recent activity</h2>
              <p>Latest recorded work for this client.</p>
            </div>
          </div>
          <div className="case-scroll tbl">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Case</th>
                  <th>Work performed</th>
                  <th className="r">Duration</th>
                </tr>
              </thead>
              <tbody>
                {recentPeriods.map((period) => (
                  <tr key={period.id}>
                    <td>{shortDate(calendarDay(period.startedAt))}</td>
                    <td title={clientCases.get(period.caseId!)?.title}>
                      <button
                        className="case-inline-link"
                        onClick={() => openCase(clientCases.get(period.caseId!)!)}
                      >
                        {clientCases.get(period.caseId!)?.title}
                      </button>
                    </td>
                    <td
                      title={periodLabel(
                        period.label,
                        clientCases.get(period.caseId!)?.reference ?? "",
                      )}
                    >
                      {periodLabel(period.label, clientCases.get(period.caseId!)?.reference ?? "")}
                    </td>
                    <td className="r num">{formatNearestMinuteDuration(effectiveMs(period))}</td>
                  </tr>
                ))}
                {!recentPeriods.length && (
                  <tr>
                    <td colSpan={4} className="case-empty">
                      No work periods for this client yet.{" "}
                      <button onClick={() => navigate("myDay")}>Open My day</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
