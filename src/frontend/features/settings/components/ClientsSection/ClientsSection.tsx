import { configuredClientRate } from "../../../../calculations/billing";
import { clientBillingModeLabels, clientTypeLabels } from "../../../../shared/presentation/catalog";
import { useState } from "react";
import { sameId, type EntityId } from "../../../../api/client";
import { Icon } from "../../../../shared/components/Icon/Icon";
import { ClientEditorDialog } from "../../../clients/components/ClientEditorDialog/ClientEditorDialog";
import { AddButton } from "../AddButton/AddButton";
import { cardHead, currencyAmount } from "../../lib/sectionPresentation";
import { useSettingsSort } from "../../hooks/useSettingsSort";
import { type SectionProps } from "../../types";

export function ClientsSection({ catalogState, action, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [editClient, setEditClient] = useState<EntityId | null>(null);
  const { head, sorted } = useSettingsSort("clients", notify);
  const formatMoney = (cents: number) => currencyAmount(catalogState, cents);
  const selectedClient = catalogState.clients.find((client) => sameId(client.id, editClient));
  return (
    <section className="card settings-card settings-clients">
      {cardHead(
        "Clients",
        "Default hourly rate for each client.",
        <AddButton open={false} onToggle={() => setAdd(!add)} label="Add client" />,
      )}
      <div className="settings-table">
        <table className="data-table">
          <thead>
            <tr>
              {head(0, "Name")}
              {head(1, "Type")}
              {head(2, "Billing")}
              {head(3, "Rate", true)}
              {head(4, "VAT")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {catalogState.clients.length === 0 && (
              <tr>
                <td className="settings-empty" colSpan={6}>
                  No clients yet.{" "}
                  <button className="link" onClick={() => setAdd(true)}>
                    Add a client
                  </button>
                </td>
              </tr>
            )}
            {sorted(catalogState.clients, (client) => [
              client.name,
              client.type,
              client.mode,
              configuredClientRate(catalogState, client),
              Number(client.vatApplicable),
            ]).map((client) => (
              <tr key={client.id}>
                <td title={client.name}>{client.name}</td>
                <td className="muted">{clientTypeLabels[client.type]}</td>
                <td className="muted">{clientBillingModeLabels[client.mode]}</td>
                <td className="rate">
                  {formatMoney(configuredClientRate(catalogState, client))}
                  /h
                  {client.hourlyRateCents === null && " · base rate"}
                </td>
                <td>{client.vatApplicable ? "Yes" : "No"}</td>
                <td>
                  <button
                    className="more iconbtn sm"
                    aria-label={`Edit ${client.name}`}
                    onClick={() => setEditClient(editClient === client.id ? null : client.id)}
                  >
                    <Icon name="more" small />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(add || selectedClient) && (
        <ClientEditorDialog
          catalogState={catalogState}
          action={action}
          client={selectedClient}
          close={() => {
            setAdd(false);
            setEditClient(null);
          }}
          onSaved={() => notify("Client saved")}
        />
      )}
    </section>
  );
}
