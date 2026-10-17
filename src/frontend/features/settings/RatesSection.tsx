import type { components } from "../../../contracts/generated";
import { api, type EntityId } from "../../api/client";
import {
  cardHead,
  blurOnEnter,
  useAmountFields,
  currencyAmount,
  type SectionProps,
} from "./shared";

export function RatesSection({ catalogState, action, saved }: SectionProps) {
  const { fieldError, setFieldError, commitAmount } = useAmountFields();
  const dollars = (cents: number) => currencyAmount(catalogState, cents);
  const patchCase = (id: EntityId, body: components["schemas"]["PatchCatalogCaseRequest"]) =>
    saved(
      action(api.PATCH("/api/catalog/cases/{id}", { params: { path: { id: String(id) } }, body })),
    );
  const patchFirm = (body: components["schemas"]["PatchCatalogSettingsRequest"]) =>
    saved(action(api.PATCH("/api/catalog/settings", { body })));
  return (
    <>
      <section className="settings-card settings-rates">
        {cardHead("Which rate applies", "Checked in this order for every time entry.")}
        <div className="settings-table">
          <table>
            <tbody>
              <tr>
                <td className="muted" style={{ width: 40 }}>
                  1
                </td>
                <td>Case rate</td>
                <td className="muted">Set on a case. Overrides everything else.</td>
              </tr>
              <tr>
                <td className="muted">2</td>
                <td>Client rate</td>
                <td className="muted">Used when the case has no rate of its own.</td>
              </tr>
              <tr>
                <td className="muted">3</td>
                <td>Base rate</td>
                <td className="muted">
                  {dollars(catalogState.settings.globalHourlyRateCents)}/h, for work with no case.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="settings-card">
        {cardHead("Base rate", "Applies when no case is recognized.")}
        <div className="settings-form">
          <label htmlFor="base-rate">Hourly rate</label>
          <input
            className="input"
            id="base-rate"
            key={catalogState.settings.globalHourlyRateCents}
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
            onChange={(event) =>
              patchFirm({ baseUnit: event.target.value === "hour" ? "hour" : "intervention" })
            }
          >
            <option value="hour">Per hour</option>
            <option value="intervention">Per intervention</option>
          </select>
          <label htmlFor="sales-tax">Sales tax on fees</label>
          <input
            className="input"
            id="sales-tax"
            key={catalogState.settings.vatRate}
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
                setFieldError("sales-tax", "Enter a non-negative tax rate.");
                return;
              }
              setFieldError("sales-tax", "");
              if (next !== catalogState.settings.vatRate) void patchFirm({ vatRate: next });
            }}
          />
          {fieldError("sales-tax")}
        </div>
      </section>
      <section className="settings-card settings-case-rates">
        {cardHead("Cases", "Set each case's billing mode, rate, flat fee and budget.")}
        <div className="settings-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Mode</th>
                <th scope="col">Own rate {catalogState.settings.currency ?? "USD"}/h</th>
                <th scope="col">Flat fee {catalogState.settings.currency ?? "USD"}</th>
                <th scope="col">Budget {catalogState.settings.currency ?? "USD"}</th>
              </tr>
            </thead>
            <tbody>
              {catalogState.cases.map((item) => (
                <tr key={item.id}>
                  <td title={item.title}>{item.title}</td>
                  <td>
                    <select
                      className="select"
                      aria-label={`${item.title} billing mode`}
                      value={item.mode}
                      onChange={(event) =>
                        void patchCase(item.id, {
                          mode: event.target.value === "hourly" ? "hourly" : "flat_fee",
                        })
                      }
                    >
                      <option value="hourly">Hourly</option>
                      <option value="flat_fee">Flat fee</option>
                    </select>
                  </td>
                  {(["hourlyRateCents", "flatFeeCents", "budgetCents"] as const).map((field) => (
                    <td key={field}>
                      <input
                        className="input"
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
    </>
  );
}
