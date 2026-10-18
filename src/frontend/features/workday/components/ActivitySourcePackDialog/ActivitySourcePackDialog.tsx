import { SourcePackScope, SourcePackOption } from "../../../../../contracts/states.generated";
import { calendarDay } from "../../../../../shared/dates";
import {
  defaultSourcePackOptions,
  selectableSourcePackOptions,
  sourcePackOptionLabels,
  sourcePackScopeLabels,
} from "../../../../shared/presentation/source-pack";
import { useSourcePackExport } from "../../../../shared/hooks/useSourcePackExport";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { useState } from "react";
import { shortDate, type EntityId, type ScreenProps } from "../../../../api/client";
import { effectiveMs, formatNearestMinuteDuration } from "../../../../calculations/billing";

type Scope = SourcePackScope;
type Props = Pick<ScreenProps, "catalogState" | "workspaceState" | "action"> & {
  caseId: EntityId;
  initialPeriodId?: number | string;
  close: () => void;
};
export function ActivitySourcePackDialog({
  catalogState,
  workspaceState,
  action,
  caseId,
  initialPeriodId,
  close,
}: Props) {
  const caseItem = catalogState.cases.find((item) => String(item.id) === String(caseId));
  const client = catalogState.clients.find(
    (item) => String(item.id) === String(caseItem?.clientId),
  );
  const invoices = workspaceState.billing.invoices.filter(
    (invoice) => invoice.caseId === String(caseId),
  );
  const entries = workspaceState.periods
    .filter((period) => period.caseId === String(caseId))
    .map((period) => ({ id: period.id, date: calendarDay(period.startedAt), label: period.label }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const [scope, setScope] = useState<Scope>(
    initialPeriodId
      ? SourcePackScope.SelectedPeriods
      : invoices.length
        ? SourcePackScope.Invoice
        : SourcePackScope.Case,
  );
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id);
  const [from, setFrom] = useState(entries.at(-1)?.date.replace(/-\d\d$/, "-01") ?? "");
  const [to, setTo] = useState(entries[0]?.date ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPeriodId ? [String(initialPeriodId)] : [],
  );
  const [options, setOptions] = useState<SourcePackOption[]>(defaultSourcePackOptions);
  const {
    receipt,
    busy,
    error,
    create: exportPack,
  } = useSourcePackExport(action, caseId, caseItem?.reference ?? "");
  if (!caseItem) return null;
  const toggleOption = (value: SourcePackOption) =>
    setOptions((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  const toggleEntry = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const create = () =>
    exportPack({
      scope,
      options,
      ...(scope === SourcePackScope.Invoice ? { invoiceId } : {}),
      ...(scope === SourcePackScope.DateRange ? { from, to } : {}),
      ...(scope === SourcePackScope.SelectedPeriods ? { periodIds: selected } : {}),
    });
  const option = (value: Scope, label: string, detail?: React.ReactNode) => (
    <div
      className={`activity-pack-option ${scope === value ? "on" : ""}`}
      key={value}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("input, select, button, label")) setScope(value);
      }}
    >
      <input
        type="radio"
        id={`activity-pack-scope-${value}`}
        name="activity-pack-scope"
        checked={scope === value}
        onChange={() => setScope(value)}
      />
      <div className="activity-pack-option-content">
        <label htmlFor={`activity-pack-scope-${value}`}>
          <b>{label}</b>
          {detail && <span className="muted"> · {detail}</span>}
        </label>
        {scope === SourcePackScope.SelectedPeriods && value === SourcePackScope.SelectedPeriods && (
          <div className="activity-pack-lines">
            {entries.map((entry) => {
              const period = workspaceState.periods.find((item) => item.id === String(entry.id));
              return (
                <label
                  className="activity-pack-line"
                  key={entry.id}
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    onChange={() => toggleEntry(entry.id)}
                  />
                  <span>
                    {shortDate(entry.date)} · {entry.label}
                  </span>
                  <span className="muted">
                    {formatNearestMinuteDuration(period ? effectiveMs(period) : null)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {scope === SourcePackScope.DateRange && value === SourcePackScope.DateRange && (
          <div className="activity-pack-dates" onClick={(event) => event.stopPropagation()}>
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
        {scope === SourcePackScope.Invoice &&
          value === SourcePackScope.Invoice &&
          invoices.length > 1 && (
            <select
              className="select"
              value={invoiceId}
              onChange={(event) => setInvoiceId(Number(event.target.value))}
            >
              {invoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.number}
                </option>
              ))}
            </select>
          )}
      </div>
    </div>
  );
  return (
    <Modal close={close} label="Export source pack">
      <div
        className="modal modal-flush source-pack-dialog activity-source-pack"
        aria-label="Export source pack"
      >
        <div className="card-h">
          <div className="t">
            <h2>Export source pack</h2>
            <p>
              {client?.name} · {caseItem.title} <span className="ref">{caseItem.reference}</span>
            </p>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="card-b activity-pack-body">
          <div>
            <div className="activity-pack-label">What should it cover?</div>
            <div className="activity-pack-options">
              {invoices.length > 0 &&
                option(
                  SourcePackScope.Invoice,
                  sourcePackScopeLabels[SourcePackScope.Invoice],
                  invoices
                    .map((invoice) => `${invoice.number} (${shortDate(invoice.date)})`)
                    .join(", "),
                )}
              {option(
                SourcePackScope.Case,
                sourcePackScopeLabels[SourcePackScope.Case],
                `${entries.length} work ${entries.length === 1 ? "period" : "periods"}`,
              )}
              {option(
                SourcePackScope.DateRange,
                sourcePackScopeLabels[SourcePackScope.DateRange],
                from && to
                  ? `from ${shortDate(from)} to ${shortDate(to)}`
                  : "Choose start and end dates",
              )}
              {option(
                SourcePackScope.SelectedPeriods,
                sourcePackScopeLabels[SourcePackScope.SelectedPeriods],
              )}
            </div>
          </div>
          <div>
            <div className="activity-pack-label">Export contents</div>
            <p className="muted">
              Other client names are redacted from exported text. Application filters apply where an
              app name is recorded. Media files are not included.
            </p>
            <div className="activity-pack-checks">
              {selectableSourcePackOptions.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={options.includes(value)}
                    onChange={() => toggleOption(value)}
                  />{" "}
                  {sourcePackOptionLabels[value]}
                </label>
              ))}
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          {receipt && <p role="status">Source pack created · SHA-256 {receipt}</p>}
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
              <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
              </svg>
              {busy ? "Creating…" : "Create source pack"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
