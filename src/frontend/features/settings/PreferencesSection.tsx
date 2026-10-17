import type { components } from "../../../contracts/generated";
import { api } from "../../api/client";
import { cardHead, blurOnEnter, useAmountFields, type SectionProps } from "./shared";

export function PreferencesSection({ catalogState, workspaceState, action, saved }: SectionProps) {
  const { fieldError, setFieldError } = useAmountFields();
  const patchSetting = (body: components["schemas"]["PatchCatalogSettingsRequest"]) =>
    saved(
      action(
        api.PATCH("/api/catalog/settings", {
          body,
        }),
      ),
    );
  return (
    <>
      <section className="settings-card">
        {cardHead("Capture", "What TimeKeeper reads from screenpipe.")}
        <div className="settings-form">
          <label htmlFor="excluded">Never capture</label>
          <input
            className="input"
            id="excluded"
            key={catalogState.settings.excludedApps}
            defaultValue={catalogState.settings.excludedApps}
            onBlur={(event) => {
              if (event.target.value !== catalogState.settings.excludedApps)
                void patchSetting({ excludedApps: event.target.value });
            }}
          />
          <label htmlFor="retention">Keep captures for</label>
          <input
            className="input"
            id="retention"
            key={catalogState.settings.captureRetention}
            defaultValue={catalogState.settings.captureRetention}
            onBlur={(event) => {
              if (event.target.value !== catalogState.settings.captureRetention)
                void patchSetting({
                  captureRetention: event.target.value,
                });
            }}
          />
        </div>
      </section>
      <section className="settings-card">
        {cardHead("Invoices", "Next number must be higher than the last issued.")}
        <div className="settings-form">
          <label htmlFor="prefix">Prefix</label>
          <input
            className="input"
            id="prefix"
            key={catalogState.settings.invoicePrefix}
            defaultValue={catalogState.settings.invoicePrefix}
            onKeyDown={blurOnEnter}
            onBlur={(event) => {
              if (event.target.value !== catalogState.settings.invoicePrefix)
                void patchSetting({ invoicePrefix: event.target.value });
            }}
          />
          <label htmlFor="next">Next number</label>
          <input
            className="input"
            id="next"
            type="text"
            inputMode="numeric"
            key={catalogState.settings.nextNumber}
            defaultValue={String(catalogState.settings.nextNumber).padStart(4, "0")}
            onKeyDown={blurOnEnter}
            onBlur={(event) => {
              const value = event.target.value.trim();
              const next = /^\d+$/.test(value) ? Number(value) : NaN;
              const lastIssued = Math.max(
                0,
                ...workspaceState.billing.invoices
                  .filter((invoice) =>
                    invoice.number.startsWith(catalogState.settings.invoicePrefix),
                  )
                  .map((invoice) =>
                    Number(invoice.number.slice(catalogState.settings.invoicePrefix.length)),
                  )
                  .filter(Number.isSafeInteger),
              );
              if (!Number.isSafeInteger(next) || next <= lastIssued) {
                setFieldError("next-number", `Enter a whole number higher than ${lastIssued}.`);
                return;
              }
              setFieldError("next-number", "");
              if (next !== catalogState.settings.nextNumber)
                void patchSetting({ nextNumber: next });
            }}
          />
          {fieldError("next-number")}
        </div>
      </section>
    </>
  );
}
