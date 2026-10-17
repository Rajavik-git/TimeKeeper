import { calendarDay } from "../../../shared/dates";
import type { SourcePackScope, SourcePackOption } from "../../api/source-pack";
import { useSourcePackExport } from "../hooks/useSourcePackExport";
import { Modal } from "./Modal";
import { useState } from "react";
import { type EntityId, type ScreenProps } from "../../api/client";
import { shortDate } from "../format";

type Scope = SourcePackScope;
export function SourcePackDialog({
  catalogState,
  workspaceState,
  caseId,
  close,
  action,
  initialPeriodId,
}: Pick<ScreenProps, "catalogState" | "workspaceState" | "action"> & {
  caseId: EntityId;
  close: () => void;
  initialPeriodId?: number | string;
}) {
  const item = catalogState.cases.find((m) => String(m.id) === String(caseId));
  const owner = catalogState.clients.find((c) => String(c.id) === String(item?.clientId));
  const entries = workspaceState.periods
    .filter((period) => period.caseId === String(caseId))
    .map((period) => ({ id: period.id, date: calendarDay(period.startedAt), label: period.label }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const invoices = workspaceState.billing.invoices.filter(
    (invoice) => invoice.caseId === String(caseId),
  );
  const [scope, setScope] = useState<Scope>(initialPeriodId ? "selectedPeriods" : "case");
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id);
  const [from, setFrom] = useState(entries[0]?.date ?? "");
  const [to, setTo] = useState(entries.at(-1)?.date ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPeriodId ? [String(initialPeriodId)] : [],
  );
  const [options, setOptions] = useState<SourcePackOption[]>(["blur", "personal", "audit"]);
  const {
    receipt,
    busy,
    create: exportPack,
  } = useSourcePackExport(action, caseId, item?.reference ?? "");
  if (!item) return null;
  const toggle = (value: SourcePackOption) =>
    setOptions((current) =>
      current.includes(value) ? current.filter((x) => x !== value) : [...current, value],
    );
  const create = () =>
    exportPack({
      scope,
      options,
      ...(scope === "invoice" ? { invoiceId } : {}),
      ...(scope === "dateRange" ? { from, to } : {}),
      ...(scope === "selectedPeriods" ? { periodIds: selected } : {}),
    });
  return (
    <Modal close={close} label="Export source pack">
      <div className="modal source-pack-dialog" aria-label="Export source pack">
        <div className="row between">
          <div>
            <h2>Export source pack</h2>
            <p>
              {owner?.name} · {item.title}{" "}
              <span className="matter-reference">{item.reference}</span>
            </p>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <h3>What should it cover?</h3>
        <div className="col">
          {(
            [
              ["invoice", "An invoice"],
              ["case", `The whole case (${entries.length} periods recorded)`],
              ["dateRange", "A date range"],
              ["selectedPeriods", "Lines I choose"],
            ] as [Scope, string][]
          ).map(([value, label]) => (
            <label className="row" key={value}>
              <input
                type="radio"
                name="pack-scope"
                checked={scope === value}
                onChange={() => setScope(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {scope === "invoice" && (
          <select
            className="field"
            value={invoiceId}
            onChange={(event) => setInvoiceId(Number(event.target.value))}
          >
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}
              </option>
            ))}
          </select>
        )}
        {scope === "dateRange" && (
          <div className="row">
            <label>
              From{" "}
              <input
                className="field"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              To{" "}
              <input
                className="field"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        )}
        {scope === "selectedPeriods" && (
          <div className="source-pack-lines">
            {entries.map((e) => (
              <label className="row" key={e.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(e.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(e.id)
                        ? current.filter((x) => x !== e.id)
                        : [...current, e.id],
                    )
                  }
                />
                {shortDate(e.date)} · {e.label}
              </label>
            ))}
          </div>
        )}
        <h3>Export contents</h3>
        <p className="muted">
          Other client names are redacted from exported text. Application filters apply where an app
          name is recorded. Media files are not included.
        </p>
        <div className="col">
          {(
            [
              ["personal", "Exclude configured applications"],
              ["audio", "Include stored audio text"],
              ["audit", "Include audit history"],
            ] as const
          ).map(([value, label]) => (
            <label className="row" key={value}>
              <input
                type="checkbox"
                checked={options.includes(value)}
                onChange={() => toggle(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {receipt && (
          <p role="status" className="small">
            Source pack created · SHA-256 {receipt}
          </p>
        )}
        <div className="row end">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => void create()}
            disabled={
              busy ||
              (scope === "invoice" && !invoiceId) ||
              (scope === "selectedPeriods" && !selected.length)
            }
          >
            {busy ? "Creating…" : "Create source pack"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
