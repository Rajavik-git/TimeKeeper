import { calendarDay } from "../../../shared/dates";
import type { SourcePackScope, SourcePackOption } from "../../api/source-pack";
import { useSourcePackExport } from "../../shared/hooks/useSourcePackExport";
import { Modal } from "../../shared/components/Modal";
import { useState } from "react";
import { shortDate, type EntityId, type ScreenProps } from "../../api/client";
import { effectiveMs, formatPreciseDuration } from "../../calculations/billing";

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
    initialPeriodId ? "selectedPeriods" : invoices.length ? "invoice" : "case",
  );
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id);
  const [from, setFrom] = useState(entries.at(-1)?.date.replace(/-\d\d$/, "-01") ?? "");
  const [to, setTo] = useState(entries[0]?.date ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPeriodId ? [String(initialPeriodId)] : [],
  );
  const [options, setOptions] = useState<SourcePackOption[]>(["blur", "personal", "audit"]);
  const {
    receipt,
    busy,
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
      ...(scope === "invoice" ? { invoiceId } : {}),
      ...(scope === "dateRange" ? { from, to } : {}),
      ...(scope === "selectedPeriods" ? { periodIds: selected } : {}),
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
        {scope === "selectedPeriods" && value === "selectedPeriods" && (
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
                    {formatPreciseDuration(period ? effectiveMs(period) : null)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {scope === "dateRange" && value === "dateRange" && (
          <div className="activity-pack-dates" onClick={(event) => event.stopPropagation()}>
            <label>
              From{" "}
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
        )}
        {scope === "invoice" && value === "invoice" && invoices.length > 1 && (
          <select value={invoiceId} onChange={(event) => setInvoiceId(Number(event.target.value))}>
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
      <div className="modal activity-source-pack" aria-label="Export source pack">
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
        <div className="activity-pack-body">
          <div>
            <div className="activity-pack-label">What should it cover?</div>
            <div className="activity-pack-options">
              {invoices.length > 0 &&
                option(
                  "invoice",
                  "An invoice",
                  invoices
                    .map((invoice) => `${invoice.number} (${shortDate(invoice.date)})`)
                    .join(", "),
                )}
              {option("case", "The whole case", `${entries.length} recorded periods`)}
              {option(
                "dateRange",
                "A date range",
                from && to
                  ? `from ${shortDate(from)} to ${shortDate(to)}`
                  : "Choose start and end dates",
              )}
              {option("selectedPeriods", "Lines I choose")}
            </div>
          </div>
          <div>
            <div className="activity-pack-label">Export contents</div>
            <p className="muted">
              Other client names are redacted from exported text. Application filters apply where an
              app name is recorded. Media files are not included.
            </p>
            <div className="activity-pack-checks">
              {(
                [
                  ["personal", "Exclude configured applications"],
                  ["audio", "Include stored audio text"],
                  ["audit", "Include audit history"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={options.includes(value)}
                    onChange={() => toggleOption(value)}
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
          </div>
          {receipt && <p role="status">Source pack created · SHA-256 {receipt}</p>}
          <div className="activity-pack-footer">
            <button className="btn ghost" onClick={close}>
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
