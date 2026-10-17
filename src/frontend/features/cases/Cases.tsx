import { geometryClass } from "../../shared/geometry";
import { useState } from "react";
import {
  api,
  client,
  money,
  shortDate,
  type ScreenProps,
} from "../../api/client";
import { configuredRate, effectiveMs, formatPreciseDuration, formatRoundedMinutes, summarizeWork } from '../../calculations/billing';
import { MatterReference } from "../../shared/components/MatterReference";
import { Icon } from "../../shared/components/Icon";

export function Cases({ s, core, action, navigate, source }: ScreenProps) {
  const [selected, setSelected] = useState(s.matter[0]?.id ?? 0);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [adverse, setAdverse] = useState("");
  const [clientId, setClientId] = useState(s.client[0]?.id ?? 0);
  const [rep, setRep] = useState("");
  const [markerType, setMarkerType] = useState<
    "case_number" | "opposing_party" | "file" | "email" | "domain" | "keyword"
  >("keyword");
  const [caseTab, setCaseTab] = useState<"entries" | "markers">("entries");
  const d = s.matter.find((x) => x.id === selected) ?? s.matter[0];
  if (!d) return null;
  const c = client(s, d.id)!;
  const lines = core.periods.filter(p=>p.caseId===String(d.id) && !p.excluded).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const rate = configuredRate(s,d.id);
  const priced = (periods:typeof lines) => rate.origin==='flat_fee' ? 0 :
    Math.round(summarizeWork(periods,core.sources).roundedMinutes*rate.rateCents/60);
  const issuedInvoiceIds=new Set(core.billing.invoices.filter(invoice=>invoice.caseId===String(d.id)).map(invoice=>invoice.id));
  const issuedWorkCents=core.billing.lines.filter(line=>
    (line.origin==='work_period'||line.origin==='flat_fee') && issuedInvoiceIds.has(line.invoiceId))
    .reduce((total,line)=>total+line.amountCents,0);
  const spent = issuedWorkCents + priced(lines.filter(p=>p.billable && p.billingStatus==='unbilled'));
  const budget = d.mode === "flat_fee" ? d.flat_fee_cents : d.budget_cents;
  const total = summarizeWork(lines,core.sources).roundedMinutes;
  const toBill = priced(lines.filter(p=>p.billable && p.billingStatus==='unbilled'));
  const non = summarizeWork(lines.filter(p=>!p.billable),core.sources).roundedMinutes;
  const markers = s.marker.filter((r) => r.matter_id === d.id);
  return (
    <>
      <div className="ph">
        <div className="t">
          <h1>Cases</h1>
          <p>
            {s.client.length} clients and{" "}
            {s.matter.filter((x) => x.status === "open").length} open cases.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" small />
            New case
          </button>
        </div>
      </div>
      <div className="split cases-layout">
        <aside className="card list">
          <label className="mini-search">
            <Icon name="search" small />
            <input
              placeholder="Filter cases"
              aria-label="Filter cases"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {s.client.map((cl) => {
            const cases = s.matter.filter(
              (x) =>
                x.client_id === cl.id &&
                (x.title + cl.name + x.reference)
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
            );
            return cases.length ? (
              <div key={cl.id}>
                <div className="grp">
                  {cl.name} · <span className="ref">{cl.code}</span>
                </div>
                <div className="list-items">
                  {cases.map((x) => (
                    <button
                      className="item"
                      key={x.id}
                      aria-current={selected === x.id}
                      onClick={() => setSelected(x.id)}
                    >
                      <span className="t">
                        {x.title}
                        <span className="ref">{x.reference}</span>
                      </span>
                      <span className="num muted">
                        {formatRoundedMinutes(summarizeWork(core.periods.filter(p=>p.caseId===String(x.id) && !p.excluded),core.sources).roundedMinutes)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null;
          })}
        </aside>
        <div className="stack">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2>
                  {d.title} <span className="ref b">{d.reference}</span>
                </h2>
                <p>
                  {c.name} · {d.category}
                </p>
              </div>
              <button
                className="btn"
                onClick={() => navigate("preInvoices", d.id)}
              >
                Pre-invoice
              </button>
            </div>
            <dl className="facts case-facts">
              <div>
                <dt>Pricing</dt>
                <dd>
                  {d.mode === "flat_fee"
                    ? `Flat fee ${money(d.flat_fee_cents ?? 0)}`
                    : `${money(rate.rateCents)}/h`}
                </dd>
              </div>
              <div>
                <dt>Time recorded</dt>
                <dd className="num">{formatRoundedMinutes(total)}</dd>
              </div>
              <div>
                <dt>To bill</dt>
                <dd className="num">
                  {d.mode === "flat_fee" ? "Flat fee" : money(toBill)}
                </dd>
              </div>
              <div>
                <dt>Not billable</dt>
                <dd className="num">{formatRoundedMinutes(non)}</dd>
              </div>
              <div>
                <dt>Opposing party</dt>
                <dd>{d.opposing_party || "—"}</dd>
              </div>
              <div>
                <dt>Case number</dt>
                <dd>{d.case_number || "—"}</dd>
              </div>
              <div>
                <dt>Opened</dt>
                <dd>
                  {shortDate(d.opened_on)} {d.opened_on.slice(0, 4)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{d.status}</dd>
              </div>
            </dl>
            {budget && (
              <div className="card-b budget">
                <div className="row between">
                  <span>
                    {d.mode === "flat_fee" ? "Flat fee used" : "Budget used"}
                  </span>
                  <span className="num">
                    {money(spent)}{" "}
                    <span className="muted">of {money(budget)}</span> ·{" "}
                    {Math.round((spent / budget) * 100)}%
                  </span>
                </div>
                <div className="bar">
                  <span
                    className={geometryClass({
                      width: `${Math.min(100, (spent / budget) * 100)}%`,
                    })}
                  />
                </div>
                {spent / budget >= 0.85 && (
                  <span className="flag">
                    <Icon name="alert" small />
                    Above 85%. Let the client know.
                  </span>
                )}
              </div>
            )}
          </section>
          <section className="card">
            <div className="toolbar">
              <div className="tabs" role="tablist" aria-label="Case sections">
                <button
                  role="tab"
                  aria-selected={caseTab === "entries"}
                  onClick={() => setCaseTab("entries")}
                >
                  Time entries ({lines.length})
                </button>
                <button
                  role="tab"
                  aria-selected={caseTab === "markers"}
                  onClick={() => setCaseTab("markers")}
                >
                  Markers ({markers.length + 2})
                </button>
              </div>
            </div>
            {caseTab === "entries" ? (
              <div className="tbl">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Work performed</th>
                      <th className="r">Hours</th>
                      <th className="r">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr
                        key={l.id}
                        className={core.sources.some(record=>record.workPeriodId===l.id) ? "click" : ""}
                        onClick={() => {
                          if (core.sources.some(record=>record.workPeriodId===l.id)) source(l.id);
                        }}
                      >
                        <td className="num">{shortDate(l.startedAt.slice(0,10))}</td>
                        <td className="wrap">
                          {l.label}
                          <span className="sub">{s.task.find(t=>t.id===l.taskTypeId)?.label ?? 'Work period'}</span>
                        </td>
                        <td className="r num">{formatPreciseDuration(effectiveMs(l))}</td>
                        <td className="r num">
                          {l.billingStatus==='billed' ? 'In invoice' : d.mode === "flat_fee"
                            ? "Flat fee"
                            : l.billable && effectiveMs(l)!==null
                              ? money(Math.round(effectiveMs(l)!*rate.rateCents/3600000))
                              : "—"}
                        </td>
                        <td>
                          {l.timeValidated?'Time validated':'Time to validate'} · {l.billingStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="card-b muted marker-intro">
                  TimeKeeper looks for these markers in window titles, on screen
                  and in calls. Each one found adds to the match score. From{" "}
                  {Math.round(s.setting[0].confidence_threshold * 100)}%, work
                  is assigned automatically.
                </div>
                <div className="tbl">
                  <table>
                    <thead>
                      <tr>
                        <th>Marker</th>
                        <th>Type</th>
                        <th className="r">Weight</th>
                        <th>Origin</th>
                        <th className="r">Seen</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {markers.map((r) => (
                        <tr key={r.id}>
                          <td>{r.value}</td>
                          <td className="muted">{r.type}</td>
                          <td className="r num">
                            {Math.round(r.weight * 100)}%
                          </td>
                          <td className="muted">
                            {r.learned ? "Learned" : "Set by you"}
                          </td>
                          <td className="r num">{r.hits || "—"}</td>
                          <td>
                            <button
                              className="iconbtn"
                              aria-label={`Remove ${r.value}`}
                              onClick={() =>
                                action(
                                  api.DELETE("/api/markers/{id}", {
                                    params: { path: { id: r.id } },
                                  }),
                                )
                              }
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-b row">
                  <select
                    className="field"
                    aria-label="Marker type"
                    value={markerType}
                    onChange={(e) =>
                      setMarkerType(e.target.value as typeof markerType)
                    }
                  >
                    {(
                      [
                        "case_number",
                        "opposing_party",
                        "file",
                        "email",
                        "domain",
                        "keyword",
                      ] as const
                    ).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field grow"
                    aria-label="New marker"
                    placeholder="Name, file, keyword…"
                    value={rep}
                    onChange={(e) => setRep(e.target.value)}
                  />
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (rep.trim()) {
                        await action(
                          api.POST("/api/markers", {
                            body: {
                              matter_id: d.id,
                              type: markerType,
                              value: rep.trim(),
                            },
                          }),
                        );
                        setRep("");
                      }
                    }}
                  >
                    Add marker
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      {adding && (
        <div className="modal-back">
          <form
            className="modal glass pad col"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action(
                api.POST("/api/matters", {
                  body: {
                    client_id: clientId,
                    title: name,
                    opposing_party: adverse,
                  },
                }),
              );
              if (result) {
                setSelected(result.id);
                setAdding(false);
              }
            }}
          >
            <h2>New case</h2>
            <label>
              Client{" "}
              <select
                className="field"
                value={clientId}
                onChange={(e) => setClientId(Number(e.target.value))}
              >
                {s.client.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Opposing party{" "}
              <input
                className="field"
                value={adverse}
                onChange={(e) => setAdverse(e.target.value)}
              />
            </label>
            <div className="row">
              <button className="btn primary">Create</button>
              <button
                type="button"
                className="btn"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
