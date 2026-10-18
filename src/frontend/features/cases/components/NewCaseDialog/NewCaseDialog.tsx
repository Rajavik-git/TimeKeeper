import { useState } from "react";
import { api, sameId, type EntityId, type Case, type ScreenProps } from "../../../../api/client";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { ClientEditorDialog } from "../../../clients/components/ClientEditorDialog/ClientEditorDialog";
import { DraftActions } from "../../../../shared/components/DraftActions/DraftActions";
import { useDraftDialog } from "../../../../shared/hooks/useDraftDialog";

type Props = Pick<ScreenProps, "catalogState" | "action"> & {
  initialClientId?: EntityId;
  close: () => void;
  onCreated: (caseItem: Case) => void;
  showNotice: (message: string) => void;
};
export function NewCaseDialog({
  catalogState,
  action,
  initialClientId,
  close,
  onCreated,
  showNotice,
}: Props) {
  const [name, setName] = useState("");
  const [adverse, setAdverse] = useState("");
  const [newClientId, setNewClientId] = useState<EntityId | "">(initialClientId ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const selectedClient = catalogState.clients.find((client) => sameId(client.id, newClientId));
  const form = useDraftDialog(
    close,
    Boolean(name || adverse || newClientId !== (initialClientId ?? "")),
  );
  return (
    <>
      <Modal className="case-modal-back" close={form.requestClose} label="New case">
        <form
          className="modal col catalog-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(async () => {
              if (!selectedClient) {
                form.setError("Select a client or add one first.");
                return;
              }
              if (!name.trim()) {
                form.setError("Enter a case title.");
                return;
              }
              const created = await action(
                api.POST("/api/catalog/cases", {
                  body: { clientId: selectedClient.id, title: name.trim(), opposingParty: adverse },
                }),
                form.setError,
              );
              if (created) {
                onCreated(created);
                close();
                showNotice("Case created");
              } else
                form.setError(
                  (current) =>
                    current || "Could not create case. Your changes are kept. Try again.",
                );
            });
          }}
        >
          <h2>New case</h2>
          <fieldset className="catalog-editor-fields" disabled={form.pending}>
            <label>
              Client
              <select
                className="field"
                required
                value={newClientId}
                onChange={(event) => setNewClientId(event.target.value)}
              >
                <option value="">Select a client</option>
                {catalogState.clients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => setAddingClient(true)}>
              Add client
            </button>
            <label>
              Title
              <input
                className="field"
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Opposing party
              <input
                className="field"
                value={adverse}
                onChange={(event) => setAdverse(event.target.value)}
              />
            </label>
          </fieldset>
          {form.error && (
            <p role="alert" className="settings-error">
              {form.error}
            </p>
          )}
          <DraftActions
            discarding={form.discarding}
            keepEditing={() => form.setDiscarding(false)}
            discard={close}
          />
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              disabled={form.pending}
              onClick={form.requestClose}
            >
              Cancel
            </button>
            <button className="btn primary" disabled={form.pending || !selectedClient}>
              {form.pending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
      {addingClient && (
        <ClientEditorDialog
          catalogState={catalogState}
          action={action}
          close={() => setAddingClient(false)}
          onSaved={(client) => setNewClientId(client.id)}
        />
      )}
    </>
  );
}
