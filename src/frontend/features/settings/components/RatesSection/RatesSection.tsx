import { baseUnitLabels, caseBillingModeLabels } from "../../../../shared/presentation/catalog";
import { rateOriginLabels } from "../../../../shared/presentation/billing";
import { BaseUnit, CaseBillingMode, RateOrigin } from "../../../../../contracts/states.generated";
import type { components } from "../../../../../contracts/generated";
import { api, type EntityId } from "../../../../api/client";
import { cardHead, blurOnEnter, currencyAmount } from "../../lib/sectionPresentation";
import { useAmountFields } from "../../hooks/useAmountFields";
import { useSettingsSort } from "../../hooks/useSettingsSort";
import { type SectionProps } from "../../types";

export function RatesSection({ catalogState, action, saved, notify }: SectionProps) {
  const { fieldError, setFieldError, commitAmount } = useAmountFields();
  const { head, sorted } = useSettingsSort("caseRates", notify);
  const currency = catalogState.settings.currency;
  const formatMoney = (cents: number) => currencyAmount(catalogState, cents);
  const patchCase = (id: EntityId, body: components["schemas"]["PatchCatalogCaseRequest"]) =>
    saved(
      action(api.PATCH("/api/catalog/cases/{id}", { params: { path: { id: String(id) } }, body })),
    );
  const patchFirm = (body: components["schemas"]["PatchCatalogSettingsRequest"]) =>
    saved(action(api.PATCH("/api/catalog/settings", { body })));
  return (
    <div className="settings-rates-bento">
      <section className="card settings-card settings-rates">
        {cardHead("Which rate applies", "Checked in this order for each work period.")}
        <div className="settings-table">
          <table className="data-table">
            <tbody>
              <tr>
                <td className="muted" style={{ width: 40 }}>
                  1
                </td>
                <td>{rateOriginLabels[RateOrigin.Case]}</td>
                <td className="muted">Set on a case. Overrides everything else.</td>
              </tr>
              <tr>
                <td className="muted">2</td>
                <td>{rateOriginLabels[RateOrigin.Client]}</td>
                <td className="muted">Used when the case has no rate of its own.</td>
              </tr>
              <tr>
                <td className="muted">3</td>
                <td>{rateOriginLabels[RateOrigin.Base]}</td>
                <td className="muted">
                  {formatMoney(catalogState.settings.globalHourlyRateCents)}/h, when neither the
                  case nor the client has a rate.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="card settings-card">
        {cardHead(
          rateOriginLabels[RateOrigin.Base],
          "Applies when neither the case nor the client has a rate.",
        )}
        <div className="settings-form">
          <label htmlFor="base-rate">Hourly rate</label>
          <input
            className="input"
            id="base-rate"
            key={`hourly-rate:${catalogState.settings.globalHourlyRateCents}`}
            defaultValue={(catalogState.settings.globalHourlyRateCents / 100).toFixed(2)}
            onKeyDown={blurOnEnter}
            onBlur={(event) =>
              commitAmount(
                "base-rate",
                event.target.value,
                catalogState.settings.globalHourlyRateCents,
                (globalHourlyRateCents) =>
                  globalHourlyRateCents === null
                    ? Promise.resolve(false)
                    : patchFirm({ globalHourlyRateCents }),
                false,
              )
            }
          />
          {fieldError("base-rate")}
          <label htmlFor="base-unit">Unit</label>
          <select
            className="select"
            id="base-unit"
            value={catalogState.settings.baseUnit}
            onChange={(event) => {
              const baseUnit = Object.values(BaseUnit).find(
                (value) => value === event.target.value,
              );
              if (baseUnit !== undefined) void patchFirm({ baseUnit });
            }}
          >
            {Object.entries(baseUnitLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="sales-tax">VAT on fees (%)</label>
          <input
            className="input"
            id="sales-tax"
            key={`vat-rate:${catalogState.settings.vatRate}`}
            defaultValue={
              catalogState.settings.vatRate ? String(catalogState.settings.vatRate) : "None"
            }
            onBlur={(event) => {
              const value = event.target.value.trim();
              const normalized = value.replace(",", ".");
              const next =
                value.toLowerCase() === "none"
                  ? 0
                  : /^\d+(?:\.\d+)?$/.test(normalized)
                    ? Number(normalized)
                    : NaN;
              if (!value || !Number.isFinite(next) || next < 0) {
                setFieldError("sales-tax", "Enter a non-negative VAT rate.");
                return;
              }
              setFieldError("sales-tax", "");
              if (next !== catalogState.settings.vatRate) void patchFirm({ vatRate: next });
            }}
          />
          {fieldError("sales-tax")}
        </div>
      </section>
      <section className="card settings-card settings-case-rates">
        {cardHead("Cases", "Set each case's billing mode, rate, flat fee and budget.")}
        <div className="settings-table">
          <table className="data-table">
            <thead>
              <tr>
                {head(0, "Case")}
                {head(1, "Mode")}
                {head(2, `Own rate ${currency}/h`, true)}
                {head(3, `Flat fee ${currency}`, true)}
                {head(4, `Budget ${currency}`, true)}
              </tr>
            </thead>
            <tbody>
              {sorted(catalogState.cases, (item) => [
                item.title,
                caseBillingModeLabels[item.mode],
                // Empty amounts sort after every set amount when sorting from highest.
                item.hourlyRateCents ?? -1,
                item.flatFeeCents ?? -1,
                item.budgetCents ?? -1,
              ]).map((item) => (
                <tr key={item.id}>
                  <td title={item.title}>{item.title}</td>
                  <td>
                    <select
                      className="select sm"
                      aria-label={`${item.title} billing mode`}
                      value={item.mode}
                      onChange={(event) => {
                        const mode = Object.values(CaseBillingMode).find(
                          (value) => value === event.target.value,
                        );
                        if (mode !== undefined) void patchCase(item.id, { mode });
                      }}
                    >
                      {Object.entries(caseBillingModeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(["hourlyRateCents", "flatFeeCents", "budgetCents"] as const).map((field) => (
                    <td key={field}>
                      <input
                        className="input sm"
                        aria-label={`${item.title} ${{ hourlyRateCents: "own rate", flatFeeCents: "flat fee", budgetCents: "budget" }[field]} ${catalogState.settings.currency}${field === "hourlyRateCents" ? "/h" : ""}`}
                        key={`${item.id}-${field}-${item[field]}`}
                        defaultValue={item[field] === null ? "" : (item[field] / 100).toFixed(2)}
                        placeholder="—"
                        inputMode="decimal"
                        onKeyDown={blurOnEnter}
                        onBlur={(event) => {
                          if (!event.target.value.trim() && item[field] === null) return;
                          commitAmount(
                            `${item.id}-${field}`,
                            event.target.value,
                            item[field],
                            (value) => patchCase(item.id, { [field]: value }),
                          );
                        }}
                      />
                      {fieldError(`${item.id}-${field}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
