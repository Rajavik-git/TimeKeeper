import { SourcePackScope, SourcePackOption } from "../../../../contracts/states.generated";
import { calendarDay } from "../../../../shared/dates";
import {
  defaultSourcePackOptions,
  selectableSourcePackOptions,
  sourcePackOptionLabels,
  sourcePackScopeLabels,
} from "../../presentation/source-pack";
import { useSourcePackExport } from "../../hooks/useSourcePackExport";
import { Modal } from "../Modal/Modal";
import { useState } from "react";
import { type EntityId, type ScreenProps } from "../../../api/client";
import { shortDate } from "../../format";

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
  const [scope, setScope] = useState<Scope>(
    initialPeriodId ? SourcePackScope.SelectedPeriods : SourcePackScope.Case,
  );
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id);
  const [from, setFrom] = useState(entries[0]?.date ?? "");
  const [to, setTo] = useState(entries.at(-1)?.date ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPeriodId ? [String(initialPeriodId)] : [],
  );
  const [options, setOptions] = useState<SourcePackOption[]>(defaultSourcePackOptions);
  const {
    receipt,
    busy,
    error,
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
      ...(scope === SourcePackScope.Invoice ? { invoiceId } : {}),
      ...(scope === SourcePackScope.DateRange ? { from, to } : {}),
      ...(scope === SourcePackScope.SelectedPeriods ? { periodIds: selected } : {}),
    });
  return (
    <Modal close={close} label="Export source pack">
      <div className="modal modal-flush source-pack-dialog" aria-label="Export source pack">
        <div className="card-h">
          <div className="t">
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
        <div className="card-b source-pack-body">
          <h3>What should it cover?</h3>
          <div className="col">
            {(
              [
                [SourcePackScope.Invoice, sourcePackScopeLabels[SourcePackScope.Invoice]],
                [
                  SourcePackScope.Case,
                  `${sourcePackScopeLabels[SourcePackScope.Case]} (${entries.length} period${entries.length === 1 ? "" : "s"} recorded)`,
                ],
                [SourcePackScope.DateRange, sourcePackScopeLabels[SourcePackScope.DateRange]],
                [
                  SourcePackScope.SelectedPeriods,
                  sourcePackScopeLabels[SourcePackScope.SelectedPeriods],
                ],
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
          {scope === SourcePackScope.Invoice && (
            <select
              className="field"
              aria-label="Invoice"
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
          {scope === SourcePackScope.DateRange && (
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
          {scope === SourcePackScope.SelectedPeriods && (
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
            Other client names are redacted from exported text. Application filters apply where an
            app name is recorded. Media files are not included.
          </p>
          <div className="col">
            {selectableSourcePackOptions.map((value) => (
              <label className="row" key={value}>
                <input
                  type="checkbox"
                  checked={options.includes(value)}
                  onChange={() => toggle(value)}
                />
                {sourcePackOptionLabels[value]}
              </label>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          {receipt && (
            <p role="status" className="small">
              Source pack created · SHA-256 {receipt}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void create()}
              disabled={
                busy ||
                (scope === SourcePackScope.Invoice && !invoiceId) ||
                (scope === SourcePackScope.SelectedPeriods && !selected.length)
              }
            >
              {busy ? "Creating…" : "Create source pack"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
