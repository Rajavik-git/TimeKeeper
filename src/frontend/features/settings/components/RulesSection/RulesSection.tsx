import {
  DEFAULT_DAILY_RESEARCH_CAP_MINUTES,
  RESEARCH_CAP_MINUTES_PER_UNIT,
  researchCapUnits,
} from "../../../../../shared/client-rule-policy";
import { clientRuleTypeLabels } from "../../../../shared/presentation/catalog";
import { ClientRuleType } from "../../../../../contracts/states.generated";
import { useState } from "react";
import { api, sameId, type EntityId } from "../../../../api/client";
import { AddButton } from "../AddButton/AddButton";
import { cardHead } from "../../lib/sectionPresentation";
import { useSettingsSort } from "../../hooks/useSettingsSort";
import { type SectionProps } from "../../types";

export function RulesSection({ catalogState, action, saved, notify }: SectionProps) {
  const [add, setAdd] = useState(false);
  const [ruleClient, setRuleClient] = useState<EntityId | null>(null);
  const selectedRuleClient =
    catalogState.clients.find((client) => sameId(client.id, ruleClient))?.id ??
    catalogState.clients[0]?.id;
  const [ruleType, setRuleType] = useState<ClientRuleType>(ClientRuleType.DailyResearchCap);
  const [researchMinutes, setResearchMinutes] = useState(
    String(DEFAULT_DAILY_RESEARCH_CAP_MINUTES),
  );
  const [error, setError] = useState("");
  const { head, sorted } = useSettingsSort("rules", notify);
  return (
    <section className="card settings-card settings-rules">
      {cardHead(
        "Client rules",
        "Checked on every pre-invoice before issuing.",
        <AddButton open={add} onToggle={() => setAdd(!add)} label="Add rule" />,
      )}
      <div className="settings-table">
        <table className="data-table">
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
            onChange={(event) => {
              const type = Object.values(ClientRuleType).find(
                (value) => value === event.target.value,
              );
              if (type !== undefined) setRuleType(type);
            }}
          >
            {Object.entries(clientRuleTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {ruleType === ClientRuleType.DailyResearchCap && (
            <label>
              Research minutes per day
              <input
                className="input"
                type="number"
                min="0"
                step={RESEARCH_CAP_MINUTES_PER_UNIT}
                aria-label="Research minutes per day"
                value={researchMinutes}
                onChange={(event) => setResearchMinutes(event.target.value)}
                aria-describedby="research-increment"
              />
              <span id="research-increment" className="muted">
                {" "}
                Use {RESEARCH_CAP_MINUTES_PER_UNIT}-minute increments.
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
                ruleType === ClientRuleType.DailyResearchCap &&
                (!Number.isSafeInteger(minutes) ||
                  minutes < 0 ||
                  minutes % RESEARCH_CAP_MINUTES_PER_UNIT !== 0)
              ) {
                setError(
                  `Enter a non-negative number of minutes in ${RESEARCH_CAP_MINUTES_PER_UNIT}-minute increments.`,
                );
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
                        ...(ruleType === ClientRuleType.DailyResearchCap
                          ? { value: researchCapUnits(minutes) }
                          : {}),
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
