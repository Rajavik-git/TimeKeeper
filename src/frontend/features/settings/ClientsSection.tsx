import { useState } from "react";
import type { components } from "../../../contracts/generated";
import { api, sameId, type EntityId } from "../../api/client";
import { Icon } from "../../shared/components/Icon";
import { parseAmount } from "./amount";
import {
  AddButton,
  cardHead,
  blurOnEnter,
  useAmountFields,
  useSettingsSort,
  currencyAmount,
  type SectionProps,
} from "./shared";

export function ClientsSection({ catalogState, action, saved, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [editClient, setEditClient] = useState<EntityId | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const { fieldError, setFieldError, commitAmount } = useAmountFields();
  const { head, sorted } = useSettingsSort("clients", notify);
  const dollars = (cents: number) => currencyAmount(catalogState, cents);
  const patchClient = (id: EntityId, body: components["schemas"]["PatchCatalogClientRequest"]) =>
    saved(
      action(
        api.PATCH("/api/catalog/clients/{id}", { params: { path: { id: String(id) } }, body }),
      ),
    );
  return (
    <section className="settings-card settings-clients">
      {cardHead(
        "Clients",
        "Default hourly rate for each client.",
        <AddButton open={add} onToggle={() => setAdd(!add)} label="Add client" />,
      )}
      <div className="settings-table">
        <table>
          <thead>
            <tr>
              {head(0, "Name")}
              {head(1, "Type")}
              {head(2, "Billing")}
              {head(3, "Rate", true)}
              {head(4, "Sales tax")}
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
              client.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0,
              Number(client.vatApplicable),
            ]).map((client) => (
              <tr key={client.id}>
                <td title={client.name}>{client.name}</td>
                <td className="muted">{client.type === "company" ? "Company" : "Individual"}</td>
                <td className="muted">{client.mode === "hourly" ? "Hourly" : "Subscription"}</td>
                <td className="rate">
                  {dollars(
                    client.hourlyRateCents ?? catalogState.settings.globalHourlyRateCents ?? 0,
                  )}
                  /h
                  {client.hourlyRateCents === null && " · base rate"}
                </td>
                <td>{client.vatApplicable ? "Yes" : "None"}</td>
                <td>
                  <button
                    className="more iconbtn"
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
      {editClient && (
        <div className="settings-inline">
          <label>
            Billing{" "}
            <select
              className="select"
              value={catalogState.clients.find((item) => sameId(item.id, editClient))?.mode}
              onChange={(event) =>
                patchClient(editClient, {
                  mode: event.target.value === "hourly" ? "hourly" : "subscription",
                })
              }
            >
              <option value="hourly">Hourly</option>
              <option value="subscription">Subscription</option>
            </select>
          </label>
          <label>
            Rate {catalogState.settings.currency ?? "USD"}/h{" "}
            <input
              className="input"
              key={editClient}
              defaultValue={
                catalogState.clients.find((item) => sameId(item.id, editClient))?.hourlyRateCents ==
                null
                  ? ""
                  : catalogState.clients.find((item) => sameId(item.id, editClient))!
                      .hourlyRateCents! / 100
              }
              placeholder={`Base rate ${dollars(catalogState.settings.globalHourlyRateCents ?? 0)}/h`}
              onKeyDown={blurOnEnter}
              onBlur={(event) =>
                commitAmount(
                  `client-${editClient}-rate`,
                  event.target.value,
                  catalogState.clients.find((item) => sameId(item.id, editClient))
                    ?.hourlyRateCents ?? null,
                  (hourlyRateCents) => patchClient(editClient, { hourlyRateCents }),
                )
              }
            />
            {fieldError(`client-${editClient}-rate`)}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={
                catalogState.clients.find((item) => sameId(item.id, editClient))?.vatApplicable ??
                false
              }
              onChange={(event) =>
                patchClient(editClient, {
                  vatApplicable: event.target.checked,
                })
              }
            />{" "}
            Sales tax
          </label>
        </div>
      )}
      {add && (
        <form
          className="settings-inline"
          onSubmit={async (event) => {
            event.preventDefault();
            const rate = parseAmount(amount, false);
            if (!rate.valid || rate.cents === null) {
              setFieldError(
                "new-client-rate",
                "Enter a non-negative amount (up to two decimal places).",
              );
              return;
            }
            setFieldError("new-client-rate", "");
            const success = await saved(
              action(
                api.POST("/api/catalog/clients", {
                  body: { name, code, hourlyRateCents: rate.cents },
                }),
              ),
            );
            if (success) {
              setName("");
              setCode("");
              setAmount("");
              setAdd(false);
            }
          }}
        >
          <input
            className="input"
            aria-label="Client name"
            placeholder="Client name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="input"
            aria-label="Client code"
            placeholder="CODE"
            required
            pattern="[A-Z][A-Z0-9]*"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <input
            className="input"
            aria-label={`Rate ${catalogState.settings.currency ?? "USD"}/h`}
            placeholder={`Rate ${catalogState.settings.currency ?? "USD"}/h`}
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {fieldError("new-client-rate")}
          <button className="btn primary">Add client</button>
        </form>
      )}
    </section>
  );
}
