import { useState } from "react";
import { api, money, originLabel, type ScreenProps } from "../../api/client";
import { configuredRate, effectiveMs } from '../../calculations/billing';
import { Card } from "../../shared/components/Card";
import { Pill } from "../../shared/components/Pill";
import { MatterReference } from "../../shared/components/MatterReference";
import { showToast } from "../../shared/components/Toast";
type Tab = "clients" | "matters" | "base" | "tasks" | "rules" | "preferences" | "pill";
type SortState={column:number;direction:1|-1};
let rememberedSorts:Record<string,SortState>={};
function ordered<T>(rows:T[], sort:SortState|undefined, values:(row:T)=>Array<string|number|boolean|null|undefined>):T[] {
  if(!sort)return rows;
  return [...rows].sort((a,b)=>{
    const left=values(a)[sort.column],right=values(b)[sort.column];
    if(left===null||left===undefined||left==='—')return right===null||right===undefined||right==='—'?0:1;
    if(right===null||right===undefined||right==='—')return -1;
    return sort.direction*(typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),'en-US'));
  });
}
const dollarInput = (s: string) => Math.round(Number(s.replaceAll(",", "")) * 100);
export function Settings({ s, core, action, navigate }: ScreenProps) {
  const [resetting, setResetting] = useState(false);
  const [tab, setTab] = useState<Tab>("clients"),
    [name, setName] = useState(""),
    [clientCode, setClientCode] = useState(""),
    [amount, setAmount] = useState(""),
    [taskCode, setTaskCode] = useState(""),
    [taskName, setTaskName] = useState(""),
    [ruleClient, setRuleClient] = useState(s.client[0]?.id ?? 0),
    [sorts,setSorts]=useState(rememberedSorts),
    [ruleType, setRuleType] = useState<
      "daily_research_cap" | "nonbillable_travel"
    >("daily_research_cap");
  const header=(table:string,column:number,label:string,numeric=false)=><th scope="col" aria-sort={sorts[table]?.column===column?sorts[table].direction===1?'ascending':'descending':undefined}><button className="sort-button" onClick={()=>setSorts(old=>{
    const current=old[table],next={...old,[table]:{column,direction:current?.column===column ? current.direction===1?-1:1 : numeric?-1:1} as SortState};
    rememberedSorts=next;return next;
  })}>{label}{sorts[table]?.column===column?(sorts[table].direction===1?' ↑':' ↓'):''}</button></th>;
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
            ["pill", "Desk pill"],
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
                  {header("clients",0,"Client")}
                  {header("clients",1,"Type")}
                  {header("clients",2,"Mode")}
                  {header("clients",3,"Hourly rate",true)}
                  {header("clients",4,"Sales tax")}
                  {header("clients",5,"Cases",true)}
                </tr>
              </thead>
              <tbody>
                {ordered(s.client,sorts.clients,c=>[c.name,c.type,c.mode,c.rate_cents,c.vat_applicable,s.matter.filter(m=>m.client_id===c.id).length]).map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}{" "}

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
                            rate_cents: dollarInput(e.target.value),
                          })
                        }
                      />{" "}
                      $/h
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
                    rate_cents: dollarInput(amount),
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
              placeholder="Rate $/h"
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
                  {header("matters",0,"Client")}
                  {header("matters",1,"Case")}
                  {header("matters",2,"Mode")}
                  {header("matters",3,"Own rate",true)}
                  {header("matters",4,"Amount",true)}
                  {header("matters",5,"Flat fee",true)}
                  {header("matters",6,"Budget",true)}
                  {header("matters",7,"Applied rate")}
                </tr>
              </thead>
              <tbody>
                {ordered(s.matter,sorts.matters,d=>[s.client.find(c=>c.id===d.client_id)?.name,d.title,d.mode,d.own_rate_cents!==null,d.own_rate_cents,d.flat_fee_cents,d.budget_cents,originLabel(configuredRate(s,d.id).origin)]).map((d) => {
                  const c = s.client.find((x) => x.id === d.client_id)!;
                  const p = s.time_entry.find((l) => l.matter_id === d.id);
                  return (
                    <tr key={d.id}>
                      <td>
                        {c.name}{" "}

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
                              own_rate_cents: dollarInput(e.target.value),
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
                                ? dollarInput(e.target.value)
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
                                ? dollarInput(e.target.value)
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
              Amount $/h{" "}
              <input
                className="field short"
                key={s.firm[0].base_rate_cents}
                defaultValue={s.firm[0].base_rate_cents / 100}
                onBlur={(e) =>
                  patch("/api/firm/{id}", s.firm[0].id, {
                    base_rate_cents: dollarInput(e.target.value),
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
              Sales tax rate{" "}
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
              <p key={period.id}>{period.label} · {effectiveMs(period)===null?'Unknown duration':money(Math.round(effectiveMs(period)!*(s.firm[0]?.base_rate_cents??0)/3600000))} before expenses, estimated</p>
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
                  {header("tasks",0,"Label")}
                  {header("tasks",1,"Billable by default")}
                  {header("tasks",2,"Off-screen")}
                  {header("tasks",3,"Entries",true)}
                </tr>
              </thead>
              <tbody>
                {ordered(s.task,sorts.tasks,t=>[t.label,t.billable_by_default,t.off_screen,s.time_entry.filter(e=>e.task_id===t.id).length]).map((t) => (
                  <tr key={t.id}>
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
                  {header("rules",0,"Client")}
                  {header("rules",1,"Rule")}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {ordered(s.client_rule,sorts.rules,r=>[s.client.find(c=>c.id===r.client_id)?.name,r.label]).map((r) => (
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
      {tab === "pill" && <Card className="settings-pill"><h2>Desk pill</h2><p>Keep the current case close while you work.</p>
        <label className="row"><input type="checkbox" checked={s.setting[0].pill_always_on_top} onChange={e=>patch('/api/setting/{id}',s.setting[0].id,{pill_always_on_top:e.target.checked})}/>Show the pill above other windows</label>
        <label className="col">What it shows <select className="field" value={s.setting[0].pill_display} onChange={e=>patch('/api/setting/{id}',s.setting[0].id,{pill_display:e.target.value})}><option value="fees">Fees for the current case</option><option value="time">Time on the current case</option><option value="case">Case name only</option></select></label>
        <label className="row"><input type="checkbox" checked={s.setting[0].notifications} onChange={e=>patch('/api/setting/{id}',s.setting[0].id,{notifications:e.target.checked})}/>Notify me when a period needs an answer</label>
        <label className="row"><input type="checkbox" checked={s.setting[0].pill_withhold_calls} onChange={e=>patch('/api/setting/{id}',s.setting[0].id,{pill_withhold_calls:e.target.checked})}/>Hold notifications during calls</label>
        <div className="solid pad col"><h3>See how it looks</h3><p>Preview the pill on a sample legal document.</p><button className="btn" onClick={()=>navigate('desk')}>Open preview</button></div>
      </Card>}
      {tab === "preferences" && (
        <Card className="settings">
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
          <div className="row"><button className="btn" disabled={resetting} aria-busy={resetting} onClick={async () => {
            if (!window.confirm('Reset all fictional demo data?')) return;
            setResetting(true);
            const result = await action(api.POST('/api/demo/reset'));
            setResetting(false);
            if (result) showToast('Demo data reset');
          }}>Reset demo data</button></div>
        </Card>
      )}
    </>
  );
}
