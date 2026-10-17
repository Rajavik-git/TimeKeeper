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
  const [researchMinutes, setResearchMinutes] = useState("30");
  const [error, setError] = useState("");
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
            <option value="daily_research_cap">Daily research cap</option>
            <option value="nonbillable_travel">Non-billable travel</option>
          </select>
          {ruleType === "daily_research_cap" && (
            <label>
              Research minutes per day
              <input
                className="input"
                type="number"
                min="0"
                step="6"
                aria-label="Research minutes per day"
                value={researchMinutes}
                onChange={(event) => setResearchMinutes(event.target.value)}
                aria-describedby="research-increment"
              />
              <span id="research-increment" className="muted">
                {" "}
                Use 6-minute increments.
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          <button
            className="btn primary"
            disabled={selectedRuleClient === undefined}
            onClick={async () => {
              if (selectedRuleClient === undefined) return;
              const minutes = researchMinutes.trim() ? Number(researchMinutes) : NaN;
              if (
                ruleType === "daily_research_cap" &&
                (!Number.isSafeInteger(minutes) || minutes < 0 || minutes % 6 !== 0)
              ) {
                setError("Enter a non-negative number of minutes in 6-minute increments.");
                return;
              }
              setError("");
              if (
                await saved(
                  action(
                    api.POST("/api/catalog/client-rules", {
                      body: {
                        clientId: selectedRuleClient,
                        type: ruleType,
                        ...(ruleType === "daily_research_cap" ? { value: minutes / 6 } : {}),
                      },
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
