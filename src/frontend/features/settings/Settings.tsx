import { useState } from "react";
import { api, type ScreenProps } from "../../api/client";
import "./Settings.css";

type Tab = "clients" | "rates" | "tasks" | "rules" | "prefs" | "pill";
type SortState = { column: number; direction: 1 | -1 };
const tabs: [Tab, string][] = [
  ["clients", "Clients"],
  ["rates", "Rates"],
  ["tasks", "Tasks"],
  ["rules", "Client rules"],
  ["prefs", "Capture and invoices"],
  ["pill", "Desk pill"],
];
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const cents = (value: string) =>
  Math.round(Number(value.replaceAll(",", "")) * 100);
let rememberedSorts: Record<string, SortState> = {};
function sorted<T>(
  rows: T[],
  sort: SortState | undefined,
  values: (row: T) => (string | number)[],
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = values(a)[sort.column],
      bv = values(b)[sort.column];
    return (
      sort.direction *
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "en-US"))
    );
  });
}
export function Settings({ s, action, navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>("clients");
  const [sorts, setSorts] = useState(rememberedSorts);
  const [add, setAdd] = useState(false);
  const [editClient, setEditClient] = useState<number | null>(null);
  const [editTask, setEditTask] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [ruleClient, setRuleClient] = useState(s.client[0]?.id ?? 0);
  const [ruleType, setRuleType] = useState<
    "daily_research_cap" | "nonbillable_travel"
  >("daily_research_cap");
  const patchClient = (id: number, body: Record<string, unknown>) =>
    action(api.PATCH("/api/client/{id}", { params: { path: { id } }, body }));
  const patchTask = (id: number, body: Record<string, unknown>) =>
    action(api.PATCH("/api/task/{id}", { params: { path: { id } }, body }));
  const patchFirm = (body: Record<string, unknown>) =>
    action(
      api.PATCH("/api/firm/{id}", {
        params: { path: { id: s.firm[0].id } },
        body,
      }),
    );
  const patchSetting = (body: Record<string, unknown>) =>
    action(
      api.PATCH("/api/setting/{id}", {
        params: { path: { id: s.setting[0].id } },
        body,
      }),
    );
  const head = (
    table: string,
    column: number,
    label: string,
    numeric = false,
  ) => (
    <th
      scope="col"
      aria-sort={
        sorts[table]?.column === column
          ? sorts[table].direction === 1
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        onClick={() =>
          setSorts((old) => {
            const prior = old[table];
            const next = {
              ...old,
              [table]: {
                column,
                direction:
                  prior?.column === column
                    ? prior.direction === 1
                      ? -1
                      : 1
                    : numeric
                      ? -1
                      : 1,
              } as SortState,
            };
            rememberedSorts = next;
            return next;
          })
        }
      >
        {label}
        {sorts[table]?.column === column
          ? sorts[table].direction === 1
            ? " ↑"
            : " ↓"
          : ""}
      </button>
    </th>
  );
  const cardHead = (
    title: string,
    subtitle: string,
    button?: React.ReactNode,
  ) => (
    <div className="card-h">
      <div className="t">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {button}
    </div>
  );
  const addButton = (label: string) => (
    <button className="btn sm" onClick={() => setAdd((value) => !value)}>
      {add ? "Cancel" : `＋ ${label}`}
    </button>
  );
  return (
    <>
      <div className="settings-crumbs">
        Settings <span>›</span>{" "}
        <b>{tabs.find((item) => item[0] === tab)?.[1]}</b>
      </div>
      <div className="ph settings-head">
        <div className="t">
          <h1>Settings</h1>
          <p>Rates, tasks, client rules and capture preferences.</p>
        </div>
      </div>
      <nav className="settings-nav" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "true" : undefined}
            onClick={() => {
              setTab(id);
              setAdd(false);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {tab === "clients" && (
          <section className="settings-card settings-clients">
            {cardHead(
              "Clients",
              "Default hourly rate for each client.",
              addButton("Add client"),
            )}
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    {head("clients", 0, "Name")}
                    {head("clients", 1, "Type")}
                    {head("clients", 2, "Billing")}
                    {head("clients", 3, "Rate", true)}
                    {head("clients", 4, "Sales tax")}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sorted(s.client, sorts.clients, (client) => [
                    client.name,
                    client.type,
                    client.mode,
                    client.rate_cents,
                    Number(client.vat_applicable),
                  ]).map((client) => (
                    <tr key={client.id}>
                      <td>{client.name}</td>
                      <td className="muted">
                        {client.type === "company" ? "Company" : "Individual"}
                      </td>
                      <td className="muted">
                        {client.mode === "hourly" ? "Hourly" : "Subscription"}
                      </td>
                      <td className="rate">{dollars(client.rate_cents)}/h</td>
                      <td>{client.vat_applicable ? "Yes" : "None"}</td>
                      <td>
                        <button
                          className="more"
                          aria-label={`Edit ${client.name}`}
                          onClick={() =>
                            setEditClient(
                              editClient === client.id ? null : client.id,
                            )
                          }
                        >
                          ···
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
                    value={
                      s.client.find((item) => item.id === editClient)?.mode
                    }
                    onChange={(event) =>
                      patchClient(editClient, { mode: event.target.value })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="subscription">Subscription</option>
                  </select>
                </label>
                <label>
                  Rate $/h{" "}
                  <input
                    className="input"
                    key={editClient}
                    defaultValue={
                      (s.client.find((item) => item.id === editClient)
                        ?.rate_cents ?? 0) / 100
                    }
                    onBlur={(event) =>
                      patchClient(editClient, {
                        rate_cents: cents(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      s.client.find((item) => item.id === editClient)
                        ?.vat_applicable ?? false
                    }
                    onChange={(event) =>
                      patchClient(editClient, {
                        vat_applicable: event.target.checked,
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
                  await action(
                    api.POST("/api/clients", {
                      body: { name, code, rate_cents: cents(amount) },
                    }),
                  );
                  setName("");
                  setCode("");
                  setAmount("");
                  setAdd(false);
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
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                />
                <input
                  className="input"
                  aria-label="Rate $/h"
                  placeholder="Rate $/h"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <button className="btn primary">Add client</button>
              </form>
            )}
          </section>
        )}
        {tab === "rates" && (
          <>
            <section className="settings-card settings-rates">
              {cardHead(
                "Which rate applies",
                "Checked in this order for every time entry.",
              )}
              <div className="settings-table">
                <table>
                  <tbody>
                    <tr>
                      <td className="muted" style={{ width: 40 }}>
                        1
                      </td>
                      <td>Case rate</td>
                      <td className="muted">
                        Set on a case. Overrides everything else.
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">2</td>
                      <td>Client rate</td>
                      <td className="muted">
                        Used when the case has no rate of its own.
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">3</td>
                      <td>Base rate</td>
                      <td className="muted">
                        {dollars(s.firm[0].base_rate_cents)}/h, for work with no
                        case.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
            <section className="settings-card">
              {cardHead("Base rate", "Applies when no case is recognized.")}
              <div className="settings-form">
                <label htmlFor="base-rate">Hourly rate</label>
                <input
                  className="input"
                  id="base-rate"
                  key={s.firm[0].base_rate_cents}
                  defaultValue={(s.firm[0].base_rate_cents / 100).toFixed(2)}
                  onBlur={(event) =>
                    patchFirm({ base_rate_cents: cents(event.target.value) })
                  }
                />
                <label htmlFor="base-unit">Unit</label>
                <select
                  className="select"
                  id="base-unit"
                  value={s.firm[0].base_unit}
                  onChange={(event) =>
                    patchFirm({ base_unit: event.target.value })
                  }
                >
                  <option value="hour">Per hour</option>
                  <option value="intervention">Per intervention</option>
                </select>
                <label htmlFor="sales-tax">Sales tax on fees</label>
                <input
                  className="input"
                  id="sales-tax"
                  key={s.firm[0].vat_rate}
                  defaultValue={
                    s.firm[0].vat_rate ? String(s.firm[0].vat_rate) : "None"
                  }
                  onBlur={(event) =>
                    patchFirm({
                      vat_rate:
                        event.target.value === "None"
                          ? 0
                          : Number(event.target.value),
                    })
                  }
                />
              </div>
            </section>
          </>
        )}
        {tab === "tasks" && (
          <section className="settings-card">
            {cardHead(
              "Tasks",
              "Types of work and how they are billed by default.",
              addButton("Add task"),
            )}
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    {head("tasks", 0, "Task")}
                    {head("tasks", 1, "Billable by default")}
                    {head("tasks", 2, "Off-screen")}
                  </tr>
                </thead>
                <tbody>
                  {sorted(s.task, sorts.tasks, (task) => [
                    task.label,
                    Number(task.billable_by_default),
                    Number(task.off_screen),
                  ]).map((task) => (
                    <tr
                      key={task.id}
                      onClick={() =>
                        setEditTask(editTask === task.id ? null : task.id)
                      }
                    >
                      <td>{task.label}</td>
                      <td>
                        {task.billable_by_default ? (
                          "Yes"
                        ) : (
                          <span className="muted">No</span>
                        )}
                      </td>
                      <td>
                        {task.off_screen ? (
                          "Yes"
                        ) : (
                          <span className="muted">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editTask && (
              <div className="settings-inline">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      s.task.find((item) => item.id === editTask)
                        ?.billable_by_default ?? false
                    }
                    onChange={(event) =>
                      patchTask(editTask, {
                        billable_by_default: event.target.checked,
                      })
                    }
                  />{" "}
                  Billable by default
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      s.task.find((item) => item.id === editTask)?.off_screen ??
                      false
                    }
                    onChange={(event) =>
                      patchTask(editTask, { off_screen: event.target.checked })
                    }
                  />{" "}
                  Off-screen
                </label>
              </div>
            )}
            {add && (
              <form
                className="settings-inline"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await action(
                    api.POST("/api/tasks", {
                      body: { code: code.toUpperCase(), label: name },
                    }),
                  );
                  setCode("");
                  setName("");
                  setAdd(false);
                }}
              >
                <input
                  className="input"
                  placeholder="CODE"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="Label"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <button className="btn primary">Add task</button>
              </form>
            )}
          </section>
        )}
        {tab === "rules" && (
          <section className="settings-card settings-rules">
            {cardHead(
              "Client rules",
              "Checked on every pre-invoice before issuing.",
              addButton("Add rule"),
            )}
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    {head("rules", 0, "Client")}
                    {head("rules", 1, "Rule")}
                  </tr>
                </thead>
                <tbody>
                  {sorted(s.client_rule, sorts.rules, (rule) => [
                    s.client.find((item) => item.id === rule.client_id)?.name ??
                      "",
                    rule.label,
                  ]).map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        {
                          s.client.find((item) => item.id === rule.client_id)
                            ?.name
                        }
                      </td>
                      <td>
                        {rule.label}
                        <button
                          className="rule-delete"
                          aria-label={`Delete rule for ${s.client.find((item) => item.id === rule.client_id)?.name}`}
                          onClick={() =>
                            action(
                              api.DELETE("/api/client-rules/{id}", {
                                params: { path: { id: rule.id } },
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
            {add && (
              <div className="settings-inline">
                <select
                  className="select"
                  value={ruleClient}
                  onChange={(event) =>
                    setRuleClient(Number(event.target.value))
                  }
                >
                  {s.client.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={ruleType}
                  onChange={(event) =>
                    setRuleType(event.target.value as typeof ruleType)
                  }
                >
                  <option value="daily_research_cap">
                    Daily research cap (30m)
                  </option>
                  <option value="nonbillable_travel">
                    Non-billable travel
                  </option>
                </select>
                <button
                  className="btn primary"
                  onClick={async () => {
                    await action(
                      api.POST("/api/client-rules", {
                        body: { client_id: ruleClient, type: ruleType },
                      }),
                    );
                    setAdd(false);
                  }}
                >
                  Add rule
                </button>
              </div>
            )}
          </section>
        )}
        {tab === "pill" && (
          <>
            <section className="settings-card">
              {cardHead(
                "Desk pill",
                "The small bar at the top centre of your screen, above every application.",
              )}
              <div className="settings-form">
                <label>Show the pill</label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.setting[0].pill_always_on_top}
                    onChange={(event) =>
                      patchSetting({ pill_always_on_top: event.target.checked })
                    }
                  />{" "}
                  Always on top of other windows
                </label>
                <label htmlFor="pill-display">Show</label>
                <select
                  className="select"
                  id="pill-display"
                  value={s.setting[0].pill_display}
                  onChange={(event) =>
                    patchSetting({ pill_display: event.target.value })
                  }
                >
                  <option value="fees">Fees earned on the current case</option>
                  <option value="time">Time on the current case</option>
                  <option value="case">Current case only</option>
                </select>
                <label>Notifications</label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.setting[0].notifications}
                    onChange={(event) =>
                      patchSetting({ notifications: event.target.checked })
                    }
                  />{" "}
                  Tell me when a period needs my answer
                </label>
                <label>During calls</label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.setting[0].pill_withhold_calls}
                    onChange={(event) =>
                      patchSetting({
                        pill_withhold_calls: event.target.checked,
                      })
                    }
                  />{" "}
                  Hold notifications until the call ends
                </label>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-preview">
                <div>
                  <b>See how it looks</b>
                  <p>A preview of the pill on a sample desktop.</p>
                </div>
                <button className="btn" onClick={() => navigate("desk")}>
                  Open preview
                </button>
              </div>
            </section>
          </>
        )}
        {tab === "prefs" && (
          <>
            <section className="settings-card">
              {cardHead("Capture", "What TimeKeeper reads from screenpipe.")}
              <div className="settings-form">
                <label htmlFor="excluded">Never capture</label>
                <input
                  className="input"
                  id="excluded"
                  key={s.setting[0].excluded_apps}
                  defaultValue={s.setting[0].excluded_apps}
                  onBlur={(event) =>
                    patchSetting({ excluded_apps: event.target.value })
                  }
                />
                <label htmlFor="retention">Keep captures for</label>
                <input
                  className="input"
                  id="retention"
                  key={s.setting[0].capture_retention}
                  defaultValue={s.setting[0].capture_retention}
                  onBlur={(event) =>
                    patchSetting({ capture_retention: event.target.value })
                  }
                />
              </div>
            </section>
            <section className="settings-card">
              {cardHead(
                "Invoices",
                "Numbering is continuous and cannot be reset.",
              )}
              <div className="settings-form">
                <label htmlFor="prefix">Prefix</label>
                <input
                  className="input"
                  id="prefix"
                  key={s.setting[0].invoice_prefix}
                  defaultValue={s.setting[0].invoice_prefix}
                  onBlur={(event) =>
                    patchSetting({ invoice_prefix: event.target.value })
                  }
                />
                <label htmlFor="next">Next number</label>
                <input
                  className="input"
                  id="next"
                  type="text"
                  inputMode="numeric"
                  key={s.setting[0].next_number}
                  defaultValue={String(s.setting[0].next_number).padStart(
                    4,
                    "0",
                  )}
                  onBlur={(event) =>
                    patchSetting({ next_number: Number(event.target.value) })
                  }
                />
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
