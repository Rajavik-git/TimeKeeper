import { useState } from "react";
import { api, sameId, type EntityId } from "../../api/client";
import { AddButton, cardHead, useSettingsSort, type SectionProps } from "./shared";

export function RulesSection({ catalogState, action, saved, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [ruleClient, setRuleClient] = useState<EntityId | null>(null);
  const selectedRuleClient =
    catalogState.clients.find((client) => sameId(client.id, ruleClient))?.id ??
    catalogState.clients[0]?.id;
  const [ruleType, setRuleType] = useState<"daily_research_cap" | "nonbillable_travel">(
    "daily_research_cap",
  );
  const { head, sorted } = useSettingsSort("rules", notify);
  return (
    <section className="settings-card settings-rules">
      {cardHead(
        "Client rules",
        "Checked on every pre-invoice before issuing.",
        <AddButton open={add} onToggle={() => setAdd(!add)} label="Add rule" />,
      )}
      <div className="settings-table">
        <table>
          <thead>
            <tr>
              {head(0, "Client")}
              {head(1, "Rule")}
            </tr>
          </thead>
          <tbody>
            {catalogState.clientRules.length === 0 && (
              <tr>
                <td className="settings-empty" colSpan={2}>
                  No client rules yet.{" "}
                  <button className="link" onClick={() => setAdd(true)}>
                    Add a rule
                  </button>
                </td>
              </tr>
            )}
            {sorted(catalogState.clientRules, (rule) => [
              catalogState.clients.find((item) => sameId(item.id, rule.clientId))?.name ?? "",
              rule.label,
            ]).map((rule) => (
              <tr key={rule.id}>
                <td>{catalogState.clients.find((item) => sameId(item.id, rule.clientId))?.name}</td>
                <td title={rule.label}>
                  {rule.label}
                  <button
                    className="rule-delete"
                    aria-label={`Delete rule for ${catalogState.clients.find((item) => sameId(item.id, rule.clientId))?.name}`}
                    onClick={() =>
                      void saved(
                        action(
                          api.DELETE("/api/catalog/client-rules/{id}", {
                            params: { path: { id: rule.id } },
                          }),
                        ),
                      )
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {add && (
        <div className="settings-inline">
          <select
            className="select"
            aria-label="Client"
            value={selectedRuleClient ?? ""}
            disabled={selectedRuleClient === undefined}
            onChange={(event) => setRuleClient(event.target.value)}
          >
            {selectedRuleClient === undefined && <option value="">Add a client first</option>}
            {catalogState.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Rule"
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value as typeof ruleType)}
          >
            <option value="daily_research_cap">Daily research cap (30m)</option>
            <option value="nonbillable_travel">Non-billable travel</option>
          </select>
          <button
            className="btn primary"
            disabled={selectedRuleClient === undefined}
            onClick={async () => {
              if (selectedRuleClient === undefined) return;
              if (
                await saved(
                  action(
                    api.POST("/api/catalog/client-rules", {
                      body: { clientId: selectedRuleClient, type: ruleType },
                    }),
                  ),
                )
              )
                setAdd(false);
            }}
          >
            Add rule
          </button>
        </div>
      )}
    </section>
  );
}
