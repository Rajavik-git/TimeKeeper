import type { components } from "../../../../../contracts/generated";
import { api } from "../../../../api/client";
import { cardHead, blurOnEnter } from "../../lib/sectionPresentation";
import { useAmountFields } from "../../hooks/useAmountFields";
import { type SectionProps } from "../../types";

export function PreferencesSection({ catalogState, action, saved }: SectionProps) {
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
      <section className="card settings-card">
        {cardHead("Capture", "Screenpipe owns recording and capture retention.")}
        <p className="settings-provider-note" id="capture-unavailable">
          Manage excluded applications and retention in Screenpipe. TimeKeeper cannot enforce these
          controls. Previously saved preferences below are inactive.
        </p>
        <div className="settings-form">
          <label htmlFor="excluded">Never capture</label>
          <input
            className="input"
            id="excluded"
            value={catalogState.settings.excludedApps}
            disabled
            aria-describedby="capture-unavailable"
          />
          <label htmlFor="retention">Keep captures for</label>
          <input
            className="input"
            id="retention"
            value={catalogState.settings.captureRetention}
            disabled
            aria-describedby="capture-unavailable"
          />
        </div>
      </section>
      <section className="card settings-card">
        {cardHead(
          "Invoices",
          "The next invoice number must be higher than the last issued number.",
        )}
        <div className="settings-form">
          <label htmlFor="prefix">Prefix</label>
          <input
            className="input"
            id="prefix"
            key={`invoice-prefix:${catalogState.settings.invoicePrefix}`}
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
            key={`invoice-next:${catalogState.settings.nextNumber}`}
            defaultValue={String(catalogState.settings.nextNumber).padStart(4, "0")}
            onKeyDown={blurOnEnter}
            onBlur={(event) => {
              const value = event.target.value.trim();
              const next = /^\d+$/.test(value) ? Number(value) : NaN;
              if (!Number.isSafeInteger(next) || next < 1) {
                setFieldError(
                  "next-number",
                  "Enter a positive whole number. Existing invoice numbers are checked when saving.",
                );
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
