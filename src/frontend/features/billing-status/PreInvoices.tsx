import { geometryClass } from "../../shared/geometry";
import { useState } from "react";
import {
  api,
  client,
  shortDate,
  money,
  hours,
  label,
  price,
  today,
  type ScreenProps,
} from "../../api/client";
import { Card } from "../../shared/components/Card";
import { MatterSelect } from "../../shared/components/MatterSelect";
import { Kpi } from "../../shared/components/Kpi";
import { Pill } from "../../shared/components/Pill";
import { Status } from "../../shared/components/Status";
import { MatterReference } from "../../shared/components/MatterReference";
export function PreInvoices({ s, action, source, selectedCase }: ScreenProps) {
  const [selected, setSelected] = useState(
      selectedCase ?? s.matter[0]?.id ?? 0,
    ),
    [tab, setTab] = useState<"all" | "bill" | "non">("all"),
    [type, setType] = useState<"final" | "deposit">("final"),
    [expenseLabel, setExpenseLabel] = useState(""),
    [expenseType, setExpenseType] = useState<"expense" | "disbursement">(
      "expense",
    ),
    [expenseAmount, setExpenseAmount] = useState(""),
    [csv, setCsv] = useState("");
  const d = s.matter.find((x) => x.id === selected) ?? s.matter[0];
  if (!d) return null;
  const c = client(s, d.id)!;
  const lines = s.time_entry
    .filter((l) => l.matter_id === d.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const invoices = s.invoice.filter((f) => f.matter_id === d.id);
  const expenses = s.expense.filter(
    (f) => f.matter_id === d.id && !f.invoice_id,
  );
  const paid = lines.filter((l) => l.billable && l.billing_status === "billed"),
    bill = lines.filter((l) => l.billable && l.billing_status !== "billed"),
    non = lines.filter((l) => !l.billable),
    pending = bill.filter((l) => l.review_status !== "approved");
  const preview = s.invoice_previews[String(d.id)][type];
  const flat_fee = d.mode === "flat_fee";
  const flatFeeDue = preview.flat_fee_due;
  const fees = preview.fees_cents;
  const expense = preview.expenses_cents;
  const disbursements = preview.disbursements_cents;
  const vat = preview.vat_cents;
  const total = preview.total_cents;
  const rate = preview.rate_cents;
  const alert = s.alerts[String(d.id)] ?? [];
  const item = (l: (typeof lines)[number]) => (
    <div className="line" key={l.id}>
      <span className="num small muted">{shortDate(l.date)}</span>
      <span>
        <b>{l.label}</b>
        <small>
          <button
            className="link"
            disabled={l.billing_status === "billed"}
            onClick={() =>
              action(
                api.PATCH("/api/time-entries/{id}", {
                  params: { path: { id: l.id } },
                  body: {
                    billable: !l.billable,
                    reason: l.billable ? "offered" : null,
                  },
                }),
              )
            }
          >
            {l.billable ? "Do not bill" : "Bill"}
          </button>{" "}
          ·{" "}
          {l.block_id ? (
            <button className="link" onClick={() => source(l.id)}>
              source
            </button>
          ) : (
            "added manually"
          )}
        </small>
      </span>
      <span className="num">{hours(l.tenths_of_hour)}</span>
      <span className="num hide-s">
        {l.billable
          ? flat_fee
            ? "flat fee"
            : money(l.amount_cents)
          : `value ${money(price(s, l.id).value_cents)}`}
      </span>
      <span className="hide-s">
        <Status
          review_status={l.review_status}
          billing_status={l.billing_status}
          billable={l.billable}
          reason={l.reason}
        />
      </span>
    </div>
  );
  return (
    <>
      <div className="row between">
        <div>
          <span className="eyebrow">
            Pre-invoice · {s.setting[0].invoice_prefix}
            {String(s.setting[0].next_number).padStart(4, "0")} (next number)
          </span>
          <h1>Pre-invoices</h1>
        </div>
        <label className="col">
          Case{" "}
          <MatterSelect
            s={s}
            value={d.id}
            onChange={(v) => v && setSelected(v)}
          />
        </label>
      </div>
      <div className="grid4">
        <Kpi
          title="Already billed"
          value={money(paid.reduce((n, l) => n + l.amount_cents, 0))}
          detail={hours(paid.reduce((n, l) => n + l.tenths_of_hour, 0))}
        />
        <Kpi
          title="To bill"
          value={money(bill.reduce((n, l) => n + l.amount_cents, 0))}
          detail={`${hours(bill.reduce((n, l) => n + l.tenths_of_hour, 0))} · excl. VAT`}
        />
        <Kpi
          title="Not billable"
          value={hours(non.reduce((n, l) => n + l.tenths_of_hour, 0))}
          detail={`Value ${money(non.reduce((n, l) => n + price(s, l.id).value_cents, 0))}`}
        />
        <Kpi
          title="To review"
          value={pending.length}
          detail={pending.length ? "Approve before issuing" : "Ready to issue"}
        />
      </div>
      <Card className="pre-progress">
        <h3>
          Time worked: {hours(lines.reduce((n, l) => n + l.tenths_of_hour, 0))}
        </h3>
        <div className="bar">
          <span
            className={`bar-billed ${geometryClass({
              width: `${
                (paid.reduce((n, l) => n + l.tenths_of_hour, 0) /
                  Math.max(
                    lines.reduce((n, l) => n + l.tenths_of_hour, 0),
                    1,
                  )) *
                100
              }%`,
            })}`}
          />
          <span
            className={`bar-to-bill ${geometryClass({
              width: `${
                (bill.reduce((n, l) => n + l.tenths_of_hour, 0) /
                  Math.max(
                    lines.reduce((n, l) => n + l.tenths_of_hour, 0),
                    1,
                  )) *
                100
              }%`,
            })}`}
          />
          <span
            className={`bar-nonbillable ${geometryClass({
              width: `${
                (non.reduce((n, l) => n + l.tenths_of_hour, 0) /
                  Math.max(
                    lines.reduce((n, l) => n + l.tenths_of_hour, 0),
                    1,
                  )) *
                100
              }%`,
            })}`}
          />
        </div>
        <div className="row small">
          <span>
            Billed {hours(paid.reduce((n, l) => n + l.tenths_of_hour, 0))} ·{" "}
            {money(paid.reduce((n, l) => n + l.amount_cents, 0))}
          </span>
          <span>
            To bill {hours(bill.reduce((n, l) => n + l.tenths_of_hour, 0))} ·{" "}
            {flat_fee
              ? "flat fee"
              : money(bill.reduce((n, l) => n + l.amount_cents, 0))}
          </span>
          <span>
            Non-billable {hours(non.reduce((n, l) => n + l.tenths_of_hour, 0))}{" "}
            · value{" "}
            {money(non.reduce((n, l) => n + price(s, l.id).value_cents, 0))}
          </span>
        </div>
      </Card>
      {alert.map((a) => (
        <div className="card-l warn" key={a}>
          <b>Client rule</b> {a}
        </div>
      ))}
      <div className="pre-layout">
        <div className="stack">
          <div className="tabs">
            {(
              [
                ["all", "All"],
                ["bill", "Billable"],
                ["non", "Non-billable"],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {text}
              </button>
            ))}
          </div>
          {tab !== "non" && (
            <Card>
              <div className="row between">
                <h3>Billable</h3>
                <button
                  className="btn small"
                  onClick={() =>
                    action(
                      api.POST("/api/matters/{id}/approve", {
                        params: { path: { id: d.id } },
                      }),
                    )
                  }
                >
                  Approve all
                </button>
              </div>
              <div className="line line-head">
                <span>Date</span>
                <span>Work performed</span>
                <span>Duration</span>
                <span className="hide-s">Amount excluding VAT</span>
                <span className="hide-s">Status</span>
              </div>
              {lines.filter((l) => l.billable).map(item)}
              {flat_fee && (
                <div className="line">
                  <span />
                  <b>
                    Agreed flat fee {flatFeeDue ? "to bill" : "already billed"}
                  </b>
                  <span />
                  <span>{money(d.flat_fee_cents ?? 0)}</span>
                </div>
              )}
            </Card>
          )}
          {tab !== "bill" && (
            <Card>
              <h3>Non-billable</h3>
              {non.length ? (
                non.map(item)
              ) : (
                <span className="muted">
                  All time on this case is billable.
                </span>
              )}
            </Card>
          )}
          <Card>
            <div className="row between">
              <h3>Expenses and disbursements</h3>
              <span className="tiny muted">
                Disbursements are charged without VAT
              </span>
            </div>
            {expenses.map((f) => (
              <div className="row between line-row" key={f.id}>
                <span>
                  {shortDate(f.date)} · {f.label} <Pill>{f.type}</Pill>
                </span>
                <span>
                  {money(f.amount_cents)}{" "}
                  <button
                    className="btn small"
                    onClick={() =>
                      action(
                        api.DELETE("/api/expenses/{id}", {
                          params: { path: { id: f.id } },
                        }),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                await action(
                  api.POST("/api/expenses", {
                    body: {
                      matter_id: d.id,
                      date: today,
                      label: expenseLabel,
                      type: expenseType,
                      amount_cents: Math.round(
                        Number(expenseAmount.replace(",", ".")) * 100,
                      ),
                    },
                  }),
                );
                setExpenseLabel("");
                setExpenseAmount("");
              }}
            >
              <input
                className="field grow"
                placeholder="Label"
                aria-label="Expense label"
                required
                value={expenseLabel}
                onChange={(e) => setExpenseLabel(e.target.value)}
              />
              <select
                className="field"
                value={expenseType}
                onChange={(e) =>
                  setExpenseType(e.target.value as typeof expenseType)
                }
              >
                <option>expense</option>
                <option>disbursement</option>
              </select>
              <input
                className="field num"
                placeholder="0,00"
                aria-label="Amount en euros"
                required
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
              <button className="btn small">Add</button>
            </form>
          </Card>
          <div className="pre-tail">
            <Card className="main">
              <h3>Issued invoices</h3>
              {invoices.length ? (
                invoices.map((f) => (
                  <div className="col line-row" key={f.id}>
                    <div className="row between">
                      <b>
                        {f.number} · <MatterReference value={d.reference} />{" "}
                        {d.title}
                      </b>
                      <span>
                        {f.type} · {money(f.subtotal_cents)} ex VAT{" "}
                        <button
                          className="btn small"
                          onClick={async () => {
                            const r = await action(
                              api.GET("/api/invoices/{id}/csv", {
                                params: { path: { id: f.id } },
                              }),
                            );
                            if (r) setCsv(r.csv);
                          }}
                        >
                          CSV
                        </button>
                      </span>
                    </div>
                    {s.invoice_line
                      .filter((l) => l.invoice_id === f.id)
                      .map((l) => (
                        <div className="row between tiny muted" key={l.id}>
                          <span>{l.label}</span>
                          <span>{money(l.amount_cents)}</span>
                        </div>
                      ))}
                  </div>
                ))
              ) : (
                <span className="muted">No invoice for this case.</span>
              )}
            </Card>
          </div>
        </div>
        <Card className="side pre-summary">
          <div className="row between">
            <span>Fees to bill</span>
            <b>{money(fees)}</b>
          </div>
          <div className="row between">
            <span>Expenses</span>
            <b>{money(expense)}</b>
          </div>
          <div className="row between">
            <span>VAT</span>
            <b>{money(vat)}</b>
          </div>
          <div className="row between">
            <span>Disbursements</span>
            <b>{money(disbursements)}</b>
          </div>
          <div className="row between total">
            <span>Total including VAT</span>
            <b>{money(total)}</b>
          </div>
          <span className="small">
            Entries to approve: {pending.length || "none"}
          </span>
          <label className="col">
            Invoice type{" "}
            <select
              className="field"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="final">final</option>
              <option value="deposit">deposit</option>
            </select>
          </label>
          <button
            className="btn primary"
            disabled={pending.length > 0 || total === 0}
            onClick={() =>
              action(
                api.POST("/api/invoices", { body: { matter_id: d.id, type } }),
              )
            }
          >
            {pending.length
              ? `Approve ${pending.length} entries before issuing`
              : total === 0
                ? "Nothing to invoice"
                : "Issue invoice"}
          </button>
          <span className="tiny muted">Issued invoices are frozen.</span>
        </Card>
      </div>
      {csv && (
        <div className="modal-back">
          <div className="modal glass pad col">
            <h2>CSV export</h2>
            <textarea className="field csv" readOnly value={csv} />
            <div className="row">
              <button
                className="btn primary"
                onClick={() => navigator.clipboard.writeText(csv)}
              >
                Copy
              </button>
              <button className="btn" onClick={() => setCsv("")}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
