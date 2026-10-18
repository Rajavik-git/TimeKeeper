import { useState } from "react";
import { ClientBillingMode, ClientType } from "../../../../../contracts/states.generated";
import { api, type ScreenProps, type State } from "../../../../api/client";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { clientBillingModeLabels, clientTypeLabels } from "../../../../shared/presentation/catalog";
import { parseAmount } from "../../../../shared/lib/amount";
import { DraftActions } from "../../../../shared/components/DraftActions/DraftActions";
import { useDraftDialog } from "../../../../shared/hooks/useDraftDialog";

type Client = State["clients"][number];
type Props = Pick<ScreenProps, "catalogState" | "action"> & {
  client?: Client;
  close: () => void;
  onSaved?: (client: Client) => void;
};
export function ClientEditorDialog({ client, catalogState, action, close, onSaved }: Props) {
  const initial = {
    name: client?.name ?? "",
    code: client?.code ?? "",
    type: client?.type ?? ClientType.Individual,
    mode: client?.mode ?? ClientBillingMode.Hourly,
    rate: client?.hourlyRateCents == null ? "" : (client.hourlyRateCents / 100).toFixed(2),
    billingAddress: client?.billingAddress ?? "",
    vatApplicable: client?.vatApplicable ?? false,
    active: client?.active ?? true,
  };
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const form = useDraftDialog(close, dirty);
  const title = client ? `Edit ${client.name}` : "Add client";
  const change = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Modal label={title} close={form.requestClose}>
      <form
        className="modal col catalog-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit(async () => {
            const rate = parseAmount(draft.rate, true);
            if (!draft.name.trim()) {
              form.setError("Enter a client name.");
              return;
            }
            if (!rate.valid) {
              form.setError("Enter a non-negative amount (up to two decimal places).");
              return;
            }
            const body = {
              name: draft.name.trim(),
              code: draft.code.trim() || null,
              type: draft.type,
              mode: draft.mode,
              hourlyRateCents: rate.cents,
              billingAddress: draft.billingAddress,
              vatApplicable: draft.vatApplicable,
              active: draft.active,
            };
            const result = await action(
              client
                ? api.PATCH("/api/catalog/clients/{id}", {
                    params: { path: { id: String(client.id) } },
                    body,
                  })
                : api.POST("/api/catalog/clients", { body }),
              form.setError,
            );
            if (result) {
              onSaved?.(result);
              close();
            } else
              form.setError(
                (current) => current || "Could not save client. Your changes are kept. Try again.",
              );
          });
        }}
      >
        <h2>{title}</h2>
        <fieldset disabled={form.pending} className="catalog-editor-fields">
          <label>
            Client name
            <input
              className="field"
              required
              autoFocus
              value={draft.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            Client type
            <select
              className="field"
              value={draft.type}
              onChange={(e) => {
                const value = Object.values(ClientType).find((item) => item === e.target.value);
                if (value) change("type", value);
              }}
            >
              {Object.entries(clientTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Client code <span className="muted">(optional)</span>
            <input
              className="field"
              pattern="[A-Z][A-Z0-9]*"
              value={draft.code}
              onChange={(e) => change("code", e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Billing mode
            <select
              className="field"
              value={draft.mode}
              onChange={(e) => {
                const value = Object.values(ClientBillingMode).find(
                  (item) => item === e.target.value,
                );
                if (value) change("mode", value);
              }}
            >
              {Object.entries(clientBillingModeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rate {catalogState.settings.currency}/h
            <input
              className="field"
              inputMode="decimal"
              value={draft.rate}
              onChange={(e) => change("rate", e.target.value)}
            />
          </label>
          <p className="muted">
            Leave the rate blank to use the base rate. Enter 0 for an explicit zero rate.
          </p>
          <label>
            Billing address
            <textarea
              className="field"
              rows={3}
              value={draft.billingAddress}
              onChange={(e) => change("billingAddress", e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.vatApplicable}
              onChange={(e) => change("vatApplicable", e.target.checked)}
            />
            VAT applicable
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => change("active", e.target.checked)}
            />
            Active client
          </label>
        </fieldset>
        {form.error && (
          <p className="settings-error" role="alert">
            {form.error}
          </p>
        )}
        <DraftActions
          discarding={form.discarding}
          keepEditing={() => form.setDiscarding(false)}
          discard={close}
        />
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={form.pending} onClick={form.requestClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={form.pending}>
            {form.pending ? "Saving…" : client ? "Save client" : "Add client"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
