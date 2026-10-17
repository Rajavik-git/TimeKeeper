import { useEffect, useState } from "react";
import { api, type ScreenProps } from "../../api/client";
import { Icon } from "../../shared/components/Icon";
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
const parseAmount = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const result = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(result) ? result : null;
};
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
  const [toast, setToast] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setFieldError = (key: string, message: string) =>
    setFieldErrors((old) => ({ ...old, [key]: message }));
  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="settings-error" role="alert">
        {fieldErrors[key]}
      </span>
    ) : null;
  const commitAmount = (
    key: string,
    value: string,
    current: number | null,
    patch: (next: number) => Promise<boolean>,
  ) => {
    const parsed = parseAmount(value);
    if (parsed === null) {
      setFieldError(
        key,
        "Enter a non-negative amount (up to two decimal places).",
      );
      return;
    }
    setFieldError(key, "");
    if (parsed !== current) void patch(parsed);
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const saved = async (operation: Promise<unknown>) => {
    setToast("Saving…");
    const success = (await operation) !== undefined;
    setToast(success ? "Saved" : "");
    return success;
  };
  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };
  const [ruleClient, setRuleClient] = useState(s.client[0]?.id ?? 0);
  const [ruleType, setRuleType] = useState<
    "daily_research_cap" | "nonbillable_travel"
  >("daily_research_cap");
  const patchClient = (id: number, body: Record<string, unknown>) =>
    saved(
      action(api.PATCH("/api/client/{id}", { params: { path: { id } }, body })),
    );
  const patchMatter = (id: number, body: Record<string, unknown>) =>
    saved(
      action(api.PATCH("/api/matter/{id}", { params: { path: { id } }, body })),
    );
  const patchTask = (id: number, body: Record<string, unknown>) =>
    saved(
      action(api.PATCH("/api/task/{id}", { params: { path: { id } }, body })),
    );
  const patchFirm = (body: Record<string, unknown>) =>
    saved(
      action(
        api.PATCH("/api/firm/{id}", {
          params: { path: { id: s.firm[0].id } },
          body,
        }),
      ),
    );
  const patchSetting = (body: Record<string, unknown>) =>
    saved(
      action(
        api.PATCH("/api/setting/{id}", {
          params: { path: { id: s.setting[0].id } },
          body,
        }),
      ),
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
        onClick={() => {
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
          });
          setToast(`Sorted by ${label}`);
        }}
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
      {add ? (
        "Cancel"
      ) : (
        <>
          <Icon name="plus" small />
          {label}
        </>
      )}
    </button>
  );
  return (
    <>
      {toast && (
        <div className="settings-toast" role="status">
          {toast}
        </div>
      )}
      <div className="settings-crumbs">
        Settings{" "}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5 3 4 4-4 4" />
        </svg>{" "}
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
                  {s.client.length === 0 && (
                    <tr>
                      <td className="settings-empty" colSpan={6}>
                        No clients yet.{" "}
                        <button className="link" onClick={() => setAdd(true)}>
                          Add a client
                        </button>
                      </td>
                    </tr>
                  )}
                  {sorted(s.client, sorts.clients, (client) => [
                    client.name,
                    client.type,
                    client.mode,
                    client.rate_cents,
                    Number(client.vat_applicable),
                  ]).map((client) => (
                    <tr key={client.id}>
                      <td title={client.name}>{client.name}</td>
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
                          className="more iconbtn"
                          aria-label={`Edit ${client.name}`}
                          onClick={() =>
                            setEditClient(
                              editClient === client.id ? null : client.id,
                            )
                          }
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
                    onKeyDown={blurOnEnter}
                    onBlur={(event) =>
                      commitAmount(
                        `client-${editClient}-rate`,
                        event.target.value,
                        s.client.find((item) => item.id === editClient)
                          ?.rate_cents ?? null,
                        (rate_cents) => patchClient(editClient, { rate_cents }),
                      )
                    }
                  />
                  {fieldError(`client-${editClient}-rate`)}
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
                  const rate = parseAmount(amount);
                  if (rate === null) {
                    setFieldError(
                      "new-client-rate",
                      "Enter a non-negative amount (up to two decimal places).",
                    );
                    return;
                  }
                  setFieldError("new-client-rate", "");
                  const success = await saved(
                    action(
                      api.POST("/api/clients", {
                        body: { name, code, rate_cents: rate },
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
                {fieldError("new-client-rate")}
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
                  onKeyDown={blurOnEnter}
                  onBlur={(event) =>
                    commitAmount(
                      "base-rate",
                      event.target.value,
                      s.firm[0].base_rate_cents,
                      (base_rate_cents) => patchFirm({ base_rate_cents }),
                    )
                  }
                />
                {fieldError("base-rate")}
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
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    const normalized = value.replace(",", ".");
                    const next = value.toLowerCase() === "none"
                      ? 0 : /^\d+(?:\.\d+)?$/.test(normalized)
                        ? Number(normalized) : NaN;
                    if (!value || !Number.isFinite(next) || next < 0) {
                      setFieldError(
                        "sales-tax",
                        "Enter a non-negative tax rate.",
                      );
                      return;
                    }
                    setFieldError("sales-tax", "");
                    if (next !== s.firm[0].vat_rate)
                      void patchFirm({ vat_rate: next });
                  }}
                />
                {fieldError("sales-tax")}
              </div>
            </section>
            <section className="settings-card settings-case-rates">
              {cardHead(
                "Cases",
                "Set each case's billing mode, rate, flat fee and budget.",
              )}
              <div className="settings-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Mode</th>
                      <th scope="col">Own rate $/h</th>
                      <th scope="col">Flat fee $</th>
                      <th scope="col">Budget $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.matter.map((item) => (
                      <tr key={item.id}>
                        <td title={item.title}>{item.title}</td>
                        <td>
                          <select
                            className="select"
                            aria-label={`${item.title} billing mode`}
                            value={item.mode}
                            onChange={(event) =>
                              void patchMatter(item.id, {
                                mode: event.target.value,
                              })
                            }
                          >
                            <option value="hourly">Hourly</option>
                            <option value="flat_fee">Flat fee</option>
                          </select>
                        </td>
                        {(
                          [
                            "own_rate_cents",
                            "flat_fee_cents",
                            "budget_cents",
                          ] as const
                        ).map((field) => (
                          <td key={field}>
                            <input
                              className="input"
                              aria-label={`${item.title} ${field.replaceAll("_", " ")}`}
                              key={`${item.id}-${field}-${item[field]}`}
                              defaultValue={
                                item[field] === null
                                  ? ""
                                  : (item[field] / 100).toFixed(2)
                              }
                              placeholder="—"
                              inputMode="decimal"
                              onKeyDown={blurOnEnter}
                              onBlur={(event) => {
                                if (
                                  !event.target.value.trim() &&
                                  item[field] === null
                                )
                                  return;
                                commitAmount(
                                  `${item.id}-${field}`,
                                  event.target.value,
                                  item[field],
                                  (value) =>
                                    patchMatter(item.id, { [field]: value }),
                                );
                              }}
                            />
                            {fieldError(`${item.id}-${field}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  {s.task.length === 0 && (
                    <tr>
                      <td className="settings-empty" colSpan={3}>
                        No tasks yet.{" "}
                        <button className="link" onClick={() => setAdd(true)}>
                          Add a task
                        </button>
                      </td>
                    </tr>
                  )}
                  {sorted(s.task, sorts.tasks, (task) => [
                    task.label,
                    Number(task.billable_by_default),
                    Number(task.off_screen),
                  ]).map((task) => (
                    <tr key={task.id} data-editing={editTask === task.id}>
                      <td title={task.label}>
                        <button
                          className="settings-task-edit"
                          aria-expanded={editTask === task.id}
                          onClick={() =>
                            setEditTask(editTask === task.id ? null : task.id)
                          }
                        >
                          {task.label}
                        </button>
                      </td>
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
                  const success = await saved(
                    action(
                      api.POST("/api/tasks", {
                        body: { code: code.toUpperCase(), label: name },
                      }),
                    ),
                  );
                  if (success) {
                    setCode("");
                    setName("");
                    setAdd(false);
                  }
                }}
              >
                <input
                  className="input"
                  placeholder="CODE"
                  aria-label="Task code"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="Label"
                  aria-label="Task label"
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
                  {s.client_rule.length === 0 && (
                    <tr>
                      <td className="settings-empty" colSpan={2}>
                        No client rules yet.{" "}
                        <button className="link" onClick={() => setAdd(true)}>
                          Add a rule
                        </button>
                      </td>
                    </tr>
                  )}
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
                      <td title={rule.label}>
                        {rule.label}
                        <button
                          className="rule-delete"
                          aria-label={`Delete rule for ${s.client.find((item) => item.id === rule.client_id)?.name}`}
                          onClick={() =>
                            void saved(
                              action(
                                api.DELETE("/api/client-rules/{id}", {
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
                  aria-label="Rule"
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
                    if (
                      await saved(
                        action(
                          api.POST("/api/client-rules", {
                            body: { client_id: ruleClient, type: ruleType },
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
        )}
        {tab === "pill" && (
          <>
            <section className="settings-card">
              {cardHead(
                "Desk pill",
                "The small bar at the top centre of your screen, above every application.",
              )}
              <div className="settings-form">
                <label htmlFor="pill-top">Show the pill</label>
                <label className="check">
                  <input
                    type="checkbox"
                    id="pill-top"
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
                <label htmlFor="pill-notifications">Notifications</label>
                <label className="check">
                  <input
                    type="checkbox"
                    id="pill-notifications"
                    checked={s.setting[0].notifications}
                    onChange={(event) =>
                      patchSetting({ notifications: event.target.checked })
                    }
                  />{" "}
                  Tell me when a period needs my answer
                </label>
                <label htmlFor="pill-calls">During calls</label>
                <label className="check">
                  <input
                    type="checkbox"
                    id="pill-calls"
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
                  onBlur={(event) => {
                    if (event.target.value !== s.setting[0].excluded_apps)
                      void patchSetting({ excluded_apps: event.target.value });
                  }}
                />
                <label htmlFor="retention">Keep captures for</label>
                <input
                  className="input"
                  id="retention"
                  key={s.setting[0].capture_retention}
                  defaultValue={s.setting[0].capture_retention}
                  onBlur={(event) => {
                    if (event.target.value !== s.setting[0].capture_retention)
                      void patchSetting({
                        capture_retention: event.target.value,
                      });
                  }}
                />
              </div>
            </section>
            <section className="settings-card">
              {cardHead(
                "Invoices",
                "Next number must be higher than the last issued.",
              )}
              <div className="settings-form">
                <label htmlFor="prefix">Prefix</label>
                <input
                  className="input"
                  id="prefix"
                  key={s.setting[0].invoice_prefix}
                  defaultValue={s.setting[0].invoice_prefix}
                  onKeyDown={blurOnEnter}
                  onBlur={(event) => {
                    if (event.target.value !== s.setting[0].invoice_prefix)
                      void patchSetting({ invoice_prefix: event.target.value });
                  }}
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
                  onKeyDown={blurOnEnter}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    const next = /^\d+$/.test(value) ? Number(value) : NaN;
                    const lastIssued = Math.max(0, ...s.invoice
                      .filter((invoice) => invoice.number.startsWith(s.setting[0].invoice_prefix))
                      .map((invoice) => Number(invoice.number.slice(s.setting[0].invoice_prefix.length)))
                      .filter(Number.isSafeInteger));
                    if (!Number.isSafeInteger(next) || next <= lastIssued) {
                      setFieldError(
                        "next-number",
                        `Enter a whole number higher than ${lastIssued}.`,
                      );
                      return;
                    }
                    setFieldError("next-number", "");
                    if (next !== s.setting[0].next_number)
                      void patchSetting({ next_number: next });
                  }}
                />
                {fieldError("next-number")}
              </div>
            </section>
            <section className="settings-card">
              {cardHead(
                "Demo data",
                "Restore the fictional sample data.",
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (confirm("Reset the demo?"))
                      await saved(action(api.POST("/api/demo/reset")));
                  }}
                >
                  Reset demo data
                </button>,
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
