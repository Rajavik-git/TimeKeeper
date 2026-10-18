import { budgetPercent } from "../../../../shared/presentation/budget";
import { caseBillingModeLabels, caseStatusLabels } from "../../../../shared/presentation/catalog";
import { CaseBillingMode, CaseStatus } from "../../../../../contracts/states.generated";
import type { Case, ScreenProps } from "../../../../api/client";
import { caseMetrics } from "../../../../calculations/cases";
import { formatRoundedMinutes } from "../../../../calculations/billing";
import { money as formatMoney, rate as displayRate } from "../../../../shared/format";
import { CaseReference } from "../../../../shared/components/CaseReference/CaseReference";
import { visibleValue } from "../../lib/casePresentation";
export function CaseTile({
  item,
  catalogState,
  workspaceState,
  onOpen,
}: Pick<ScreenProps, "catalogState" | "workspaceState"> & {
  item: Case;
  onOpen: (item: Case) => void;
}) {
  const money = (cents: number) => formatMoney(cents, catalogState.settings.currency ?? "USD");
  const formatRate = (cents: number) => displayRate(cents, catalogState.settings.currency ?? "USD");
  const m = caseMetrics(catalogState, workspaceState, item);
  return (
    <button
      className="card card-padded case-tile"
      key={item.id}
      title={`${item.title} · ${item.reference}`}
      onClick={() => onOpen(item)}
    >
      <div className="case-tile-top">
        <span>
          <strong>{item.title}</strong>
          <CaseReference value={item.reference} />
        </span>
        <span className={`st ${item.status === CaseStatus.Active ? "ok" : ""}`}>
          <i />
          {caseStatusLabels[item.status]}
        </span>
      </div>
      <p>
        {item.category}
        {visibleValue(item.opposingParty) ? ` · v ${item.opposingParty}` : ""}
      </p>
      <dl className="case-tile-facts">
        <div>
          <dt>Pricing</dt>
          <dd>
            {item.mode === CaseBillingMode.FlatFee
              ? `${caseBillingModeLabels[item.mode]} ${money(item.flatFeeCents ?? 0)}`
              : formatRate(m.rate.rateCents)}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{`${formatRoundedMinutes(m.time)}${m.complete ? "" : " · partial"}`}</dd>
        </div>
        <div>
          <dt>To bill</dt>
          <dd className="case-to-bill-value">
            {item.mode === CaseBillingMode.FlatFee
              ? caseBillingModeLabels[CaseBillingMode.FlatFee]
              : money(m.toBill)}
          </dd>
        </div>
        <div>
          <dt>{item.mode === CaseBillingMode.FlatFee ? "Estimated work / flat fee" : "Budget"}</dt>
          <dd
            title={
              item.mode === CaseBillingMode.FlatFee
                ? "Estimated hourly work value at the current client or base rate, compared with the agreed flat fee. This is not the invoiced fraction."
                : undefined
            }
          >
            {m.budgetPercent === null
              ? m.budget !== null && !m.budgetComplete
                ? "Unavailable"
                : "—"
              : budgetPercent(m.budgetPercent)}
          </dd>
        </div>
      </dl>
      {m.budgetPercent !== null && (
        <div className="bar">
          <span style={{ width: `${Math.min(m.budgetPercent, 100)}%` }} />
        </div>
      )}
    </button>
  );
}
