import { useState } from "react";
import { api, sameId, type EntityId, type Case, type ScreenProps } from "../../api/client";
import { Modal } from "../../shared/components/Modal";

type Props = Pick<ScreenProps, "catalogState" | "action"> & {
  open: boolean;
  close: () => void;
  onCreated: (caseItem: Case) => void;
  showNotice: (message: string) => void;
};
export function NewCaseDialog({ catalogState, action, open, close, onCreated, showNotice }: Props) {
  const [name, setName] = useState("");
  const [adverse, setAdverse] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);
  const [newClientId, setNewClientId] = useState<EntityId | null>(null);
  const selectedNewClient =
    catalogState.clients.find((client) => sameId(client.id, newClientId))?.id ??
    catalogState.clients[0]?.id;
  if (!open) return null;
  return (
    <Modal
      className="case-modal-back"
      close={() => {
        if (!creatingCase) close();
      }}
      label="New case"
    >
      <form
        className="modal glass pad col"
        onSubmit={async (event) => {
          event.preventDefault();
          if (selectedNewClient === undefined) return;
          setCreatingCase(true);
          showNotice("Creating case…");
          try {
            const created = await action(
              api.POST("/api/catalog/cases", {
                body: { clientId: selectedNewClient, title: name, opposingParty: adverse },
              }),
            );
            if (created) {
              close();
              setName("");
              setAdverse("");
              onCreated(created);
              showNotice("Case created");
            } else showNotice("Could not create case.");
          } catch {
            showNotice("Could not create case.");
          } finally {
            setCreatingCase(false);
          }
        }}
      >
        <h2>New case</h2>
        <label>
          Client{" "}
          <select
            className="field"
            value={selectedNewClient ?? ""}
            disabled={selectedNewClient === undefined}
            onChange={(event) => setNewClientId(event.target.value)}
          >
            {selectedNewClient === undefined && <option value="">Add a client first</option>}
            {catalogState.clients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title{" "}
          <input
            className="field"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Opposing party{" "}
          <input
            className="field"
            value={adverse}
            onChange={(event) => setAdverse(event.target.value)}
          />
        </label>
        <div className="row">
          <button
            className="btn primary"
            disabled={creatingCase || selectedNewClient === undefined}
          >
            {creatingCase ? "Creating…" : "Create"}
          </button>
          <button type="button" className="btn" disabled={creatingCase} onClick={() => close()}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
