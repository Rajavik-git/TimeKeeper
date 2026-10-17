import { percent } from '../../shared/format';
import { useState } from "react";
import { api, money, originLabel, type ScreenProps } from "../../api/client";
import { configuredRate, effectiveMs } from '../../calculations/billing';
import { Card } from "../../shared/components/Card";
import { Pill } from "../../shared/components/Pill";
import { MatterReference } from "../../shared/components/MatterReference";
type Tab = "clients" | "matters" | "base" | "tasks" | "rules" | "preferences";
const euroInput = (s: string) => Math.round(Number(s.replace(",", ".")) * 100);
export function Settings({ s, core, action }: ScreenProps) {
  const [tab, setTab] = useState<Tab>("clients"),
    [name, setName] = useState(""),
    [clientCode, setClientCode] = useState(""),
    [amount, setAmount] = useState(""),
    [taskCode, setTaskCode] = useState(""),
    [taskName, setTaskName] = useState(""),
    [ruleClient, setRuleClient] = useState(s.client[0]?.id ?? 0),
    [ruleType, setRuleType] = useState<
      "daily_research_cap" | "nonbillable_travel"
    >("daily_research_cap");
  type PatchPath =
    | "/api/client/{id}"
    | "/api/matter/{id}"
    | "/api/task/{id}"
    | "/api/firm/{id}"
    | "/api/setting/{id}";
  const patch = (
    path: PatchPath,
    id: number,
    body: Record<string, unknown>,
  ) => {
    switch (path) {
      case "/api/client/{id}":
        return action(
          api.PATCH("/api/client/{id}", { params: { path: { id } }, body }),
        );
      case "/api/matter/{id}":
        return action(
          api.PATCH("/api/matter/{id}", { params: { path: { id } }, body }),
        );
      case "/api/task/{id}":
        return action(
          api.PATCH("/api/task/{id}", { params: { path: { id } }, body }),
        );
      case "/api/firm/{id}":
        return action(
          api.PATCH("/api/firm/{id}", { params: { path: { id } }, body }),
        );
      case "/api/setting/{id}":
        return action(
          api.PATCH("/api/setting/{id}", { params: { path: { id } }, body }),
        );
    }
  };
  return (
    <>
      <div className="ph">
        <div className="t">
          <h1>Settings</h1>
          <p>Rates, tasks, client rules and capture preferences.</p>
        </div>
      </div>
      {tab === "base" && (
        <Card>
          <div className="row">
            <Pill kind="solid">1 · Case rate</Pill> ›{" "}
            <Pill>2 · otherwise client rate</Pill> ›{" "}
            <Pill>3 · otherwise base rate</Pill>
            <span className="small muted">
              Every change recalculates unbilled amounts.
            </span>
          </div>
        </Card>
      )}
      <div className="settings-nav subnav">
        {(
          [
            ["clients", "Clients"],
            ["base", "Rates"],
            ["matters", "Cases"],
            ["tasks", "Tasks"],
            ["rules", "Client rules"],
            ["preferences", "Capture and invoices"],
          ] as [Tab, string][]
        ).map(([id, text]) => (
          <button
            key={id}
            aria-current={tab === id ? "true" : undefined}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "clients" && (
        <Card>
          <div className="scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Mode</th>
                  <th>Rate excluding VAT</th>
                  <th>VAT</th>
                  <th>Cases</th>
                </tr>
              </thead>
              <tbody>
                {s.client.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}{" "}
                      <span className="matter-reference">{c.code}</span>
                    </td>
                    <td>{c.type}</td>
                    <td>
                      <select
                        className="field"
                        value={c.mode}
                        onChange={(e) =>
                          patch("/api/client/{id}", c.id, {
                            mode: e.target.value,
                          })
                        }
                      >
                        <option value="hourly">hourly rate</option>
                        <option value="subscription">subscription</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="field num short"
                        key={`${c.id}-${c.rate_cents}`}
                        defaultValue={c.rate_cents / 100}
                        onBlur={(e) =>
                          patch("/api/client/{id}", c.id, {
                            rate_cents: euroInput(e.target.value),
                          })
                        }
                      />{" "}
                      €/h
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={c.vat_applicable}
                        onChange={(e) =>
                          patch("/api/client/{id}", c.id, {
                            vat_applicable: e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      {s.matter.filter((d) => d.client_id === c.id).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              await action(
                api.POST("/api/clients", {
                  body: {
                    name: name,
                    code: clientCode,
                    rate_cents: euroInput(amount),
                  },
                }),
              );
              setName("");
              setClientCode("");
              setAmount("");
            }}
          >
            <input
              className="field grow"
              placeholder="Client name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="field short"
              placeholder="CODE"
              aria-label="Client code"
              required
              pattern="[A-Z][A-Z0-9]*"
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value.toUpperCase())}
            />
            <input
              className="field short"
              placeholder="Rate €/h"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="btn small">+ Add client</button>
          </form>
        </Card>
      )}
      {tab === "matters" && (
        <Card>
          <div className="scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Case</th>
                  <th>Mode</th>
                  <th>Own rate</th>
                  <th>Amount</th>
                  <th>Flat fee excluding VAT</th>
                  <th>Budget excluding VAT</th>
                  <th>Applied rate</th>
                </tr>
              </thead>
              <tbody>
                {s.matter.map((d) => {
                  const c = s.client.find((x) => x.id === d.client_id)!;
                  const p = s.time_entry.find((l) => l.matter_id === d.id);
                  return (
                    <tr key={d.id}>
                      <td>
                        {c.name}{" "}
                        <span className="matter-reference">{c.code}</span>
                      </td>
                      <td>
                        <MatterReference value={d.reference} /> {d.title}
                      </td>
                      <td>
                        <select
                          className="field"
                          value={d.mode}
                          onChange={(e) =>
                            patch("/api/matter/{id}", d.id, {
                              mode: e.target.value,
                              flat_fee_cents:
                                e.target.value === "flat_fee"
                                  ? (d.flat_fee_cents ?? 100000)
                                  : d.flat_fee_cents,
                            })
                          }
                        >
                          <option value="hourly">hourly</option>
                          <option value="flat_fee">flat fee</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={d.own_rate_cents !== null}
                          onChange={(e) =>
                            patch("/api/matter/{id}", d.id, {
                              own_rate_cents: e.target.checked
                                ? c.rate_cents
                                : null,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="field short"
                          disabled={d.own_rate_cents === null}
                          key={`${d.id}-${d.own_rate_cents}`}
                          defaultValue={
                            d.own_rate_cents === null
                              ? ""
                              : d.own_rate_cents / 100
                          }
                          onBlur={(e) =>
                            patch("/api/matter/{id}", d.id, {
                              own_rate_cents: euroInput(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="field short"
                          key={`${d.id}-${d.flat_fee_cents}`}
                          defaultValue={
                            d.flat_fee_cents === null
                              ? ""
                              : d.flat_fee_cents / 100
                          }
                          onBlur={(e) =>
                            patch("/api/matter/{id}", d.id, {
                              flat_fee_cents: e.target.value
                                ? euroInput(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="field short"
                          key={`${d.id}-${d.budget_cents}`}
                          defaultValue={
                            d.budget_cents === null ? "" : d.budget_cents / 100
                          }
                          onBlur={(e) =>
                            patch("/api/matter/{id}", d.id, {
                              budget_cents: e.target.value
                                ? euroInput(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td>
                        <Pill>
                          {originLabel(configuredRate(s,d.id).origin)}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === "base" && (
        <div className="split">
          <div className="main solid pad col">
            <h2>Base rate</h2>
            <span className="small muted">
              For work not yet assigned to a client or case.
            </span>
            <label>
              Amount € ex VAT{" "}
              <input
                className="field short"
                key={s.firm[0].base_rate_cents}
                defaultValue={s.firm[0].base_rate_cents / 100}
                onBlur={(e) =>
                  patch("/api/firm/{id}", s.firm[0].id, {
                    base_rate_cents: euroInput(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Unit{" "}
              <select
                className="field"
                value={s.firm[0].base_unit}
                onChange={(e) =>
                  patch("/api/firm/{id}", s.firm[0].id, {
                    base_unit: e.target.value,
                  })
                }
              >
                <option value="hour">per hour</option>
                <option value="intervention">per intervention</option>
              </select>
            </label>
            <label>
              VAT rate{" "}
              <input
                className="field short"
                key={s.firm[0].vat_rate}
                defaultValue={s.firm[0].vat_rate}
                onBlur={(e) =>
                  patch("/api/firm/{id}", s.firm[0].id, {
                    vat_rate: Number(e.target.value.replace(",", ".")),
                  })
                }
              />
            </label>
          </div>
          <Card className="side">
            <h3>At base rate today</h3>
            {core.periods.filter(period=>!period.caseId && !period.excluded).map(period=>(
              <p key={period.id}>{period.label} · {effectiveMs(period)===null?'Unknown duration':money(Math.round(effectiveMs(period)!*(s.firm[0]?.base_rate_cents??0)/3600000))} excluding VAT, estimated</p>
            ))}
          </Card>
        </div>
      )}
      {tab === "tasks" && (
        <Card>
          <div className="scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Label</th>
                  <th>Billable by default</th>
                  <th>Off-screen</th>
                  <th>Entries</th>
                </tr>
              </thead>
              <tbody>
                {s.task.map((t) => (
                  <tr key={t.id}>
                    <td>{t.code}</td>
                    <td>{t.label}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={t.billable_by_default}
                        onChange={(e) =>
                          patch("/api/task/{id}", t.id, {
                            billable_by_default: e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={t.off_screen}
                        onChange={(e) =>
                          patch("/api/task/{id}", t.id, {
                            off_screen: e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      {s.time_entry.filter((l) => l.task_id === t.id).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              await action(
                api.POST("/api/tasks", {
                  body: { code: taskCode.toUpperCase(), label: taskName },
                }),
              );
              setTaskCode("");
              setTaskName("");
            }}
          >
            <input
              className="field short"
              placeholder="CODE"
              required
              value={taskCode}
              onChange={(e) => setTaskCode(e.target.value)}
            />
            <input
              className="field grow"
              placeholder="Label"
              required
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
            />
            <button className="btn small">+ Add task</button>
          </form>
        </Card>
      )}
      {tab === "rules" && (
        <Card>
          <div className="scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Rule</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.client_rule.map((r) => (
                  <tr key={r.id}>
                    <td>{s.client.find((c) => c.id === r.client_id)?.name}</td>
                    <td>{r.label}</td>
                    <td>
                      <button
                        className="btn small"
                        onClick={() =>
                          action(
                            api.DELETE("/api/client-rules/{id}", {
                              params: { path: { id: r.id } },
                            }),
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
          <div className="row">
            <select
              className="field"
              value={ruleClient}
              onChange={(e) => setRuleClient(Number(e.target.value))}
            >
              {s.client.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="field"
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as typeof ruleType)}
            >
              <option value="daily_research_cap">
                Daily research cap (30m)
              </option>
              <option value="nonbillable_travel">Non-billable travel</option>
            </select>
            <button
              className="btn small"
              onClick={() =>
                action(
                  api.POST("/api/client-rules", {
                    body: { client_id: ruleClient, type: ruleType },
                  }),
                )
              }
            >
              + Add rule
            </button>
          </div>
        </Card>
      )}
      {tab === "preferences" && (
        <Card className="settings">
          <label>
            Confidence threshold ·{" "}
            {percent(s.setting[0].confidence_threshold * 100)}{" "}
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={s.setting[0].confidence_threshold * 100}
              onChange={(e) =>
                patch("/api/setting/{id}", s.setting[0].id, {
                  confidence_threshold: Number(e.target.value) / 100,
                })
              }
            />
          </label>
          {(
            [
              ["excluded_apps", "Apps excluded from capture"],
              ["capture_retention", "Capture retention"],
              ["invoice_prefix", "Invoice prefix"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className="field"
                key={String(s.setting[0][key])}
                defaultValue={s.setting[0][key]}
                onBlur={(e) =>
                  patch("/api/setting/{id}", s.setting[0].id, {
                    [key]: e.target.value,
                  })
                }
              />
            </label>
          ))}
          <label>
            Next number{" "}
            <input
              className="field short"
              type="number"
              key={s.setting[0].next_number}
              defaultValue={s.setting[0].next_number}
              onBlur={(e) =>
                patch("/api/setting/{id}", s.setting[0].id, {
                  next_number: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={s.setting[0].notifications}
              onChange={(e) =>
                patch("/api/setting/{id}", s.setting[0].id, {
                  notifications: e.target.checked,
                })
              }
            />{" "}
            Pill notifications
          </label>
        </Card>
      )}
    </>
  );
}
