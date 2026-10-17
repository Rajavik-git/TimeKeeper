import { useState } from "react";
import { api, shortDate, type ScreenProps } from "../../api/client";
import { effectiveMs, formatPreciseDuration } from "../../calculations/billing";

type Scope = "invoice" | "case" | "period" | "chosen";
type Props = Pick<ScreenProps, "s" | "core" | "action"> & {
  matterId: number;
  initialPeriodId?: number;
  close: () => void;
};
export function ActivitySourcePackDialog({
  s,
  core,
  action,
  matterId,
  initialPeriodId,
  close,
}: Props) {
  const matter = s.matter.find((item) => item.id === matterId);
  const client = s.client.find((item) => item.id === matter?.client_id);
  const invoices = s.invoice.filter((item) => item.matter_id === matterId);
  const entries = s.time_entry
    .filter((item) => item.matter_id === matterId && item.block_id !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const [scope, setScope] = useState<Scope>(
    initialPeriodId ? "chosen" : invoices.length ? "invoice" : "case",
  );
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id);
  const [from, setFrom] = useState(
    entries.at(-1)?.date.replace(/-\d\d$/, "-01") ?? "",
  );
  const [to, setTo] = useState(entries[0]?.date ?? "");
  const [selected, setSelected] = useState<number[]>(
    initialPeriodId ? [initialPeriodId] : [],
  );
  const [options, setOptions] = useState<string[]>([
    "blur",
    "personal",
    "audit",
  ]);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  if (!matter) return null;
  const toggleOption = (value: string) =>
    setOptions((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  const toggleEntry = (id: number) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const create = async () => {
    setBusy(true);
    try {
      const result = await action(
        api.POST("/api/cases/{id}/source-pack", {
          params: { path: { id: matterId } },
          body: {
            scope,
            options,
            ...(scope === "invoice" ? { invoiceId } : {}),
            ...(scope === "period" ? { from, to } : {}),
            ...(scope === "chosen" ? { periodIds: selected } : {}),
          },
        }),
      );
      if (result) {
        setReceipt(result.export.sha256);
        const url = URL.createObjectURL(
          new Blob([result.payload], {
            type: "application/json;charset=utf-8",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `source-pack-${matter.reference}-${result.export.id}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } finally {
      setBusy(false);
    }
  };
  const option = (value: Scope, label: string, detail?: React.ReactNode) => (
    <label
      className={`activity-pack-option ${scope === value ? "on" : ""}`}
      key={value}
    >
      <input
        type="radio"
        name="activity-pack-scope"
        checked={scope === value}
        onChange={() => setScope(value)}
      />
      <span className="activity-pack-option-content">
        <b>{label}</b>
        {detail && <span className="muted"> · {detail}</span>}
        {scope === "chosen" && value === "chosen" && (
          <div className="activity-pack-lines">
            {entries.map((entry) => {
              const block = s.block.find((item) => item.id === entry.block_id);
              const period = core.periods.find(
                (item) => item.id === String(entry.id),
              );
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
                    {formatPreciseDuration(
                      period
                        ? effectiveMs(period)
                        : block
                          ? block.minutes * 60000
                          : entry.tenths_of_hour * 360000,
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {scope === "period" && value === "period" && (
          <div
            className="activity-pack-dates"
            onClick={(event) => event.stopPropagation()}
          >
            <label>
              From{" "}
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              To{" "}
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        )}
        {scope === "invoice" && value === "invoice" && invoices.length > 1 && (
          <select
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
      </span>
    </label>
  );
  return (
    <div
      className="modal-back"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal activity-source-pack"
        role="dialog"
        aria-modal="true"
        aria-label="Export source pack"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="card-h">
          <div className="t">
            <h2>Export source pack</h2>
            <p>
              {client?.name} · {matter.title}{" "}
              <span className="ref">{matter.reference}</span>
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
                    .map(
                      (invoice) =>
                        `${invoice.number} (${shortDate(invoice.date)})`,
                    )
                    .join(", "),
                )}
              {option(
                "case",
                "The whole case",
                `${entries.length} recorded periods`,
              )}
              {option(
                "period",
                "A period",
                `from ${shortDate(from)} to ${shortDate(to)}`,
              )}
              {option("chosen", "Lines I choose")}
            </div>
          </div>
          <div>
            <div className="activity-pack-label">Protect confidentiality</div>
            <div className="activity-pack-checks">
              {(
                [
                  ["blur", "Blur other clients visible on screen"],
                  ["personal", "Leave out personal apps"],
                  ["transcripts", "Include call transcripts"],
                  ["audit", "Include the audit trail"],
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
          {receipt && (
            <p role="status">Source pack created · SHA-256 {receipt}</p>
          )}
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
                (scope === "chosen" && !selected.length)
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
    </div>
  );
}
