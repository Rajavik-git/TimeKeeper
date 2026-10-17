import { Fragment, useEffect, useRef, useState } from "react";
import { api, shortDate, type ScreenProps, type State } from "../../api/client";
import { ActivitySourcePackDialog } from "./ActivitySourcePackDialog";
import { effectiveMs, formatPreciseDuration } from "../../calculations/billing";
import "./Activity.css";

type Props = ScreenProps & { selected: string };
const clock = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export function Source({ s, core, selected, action }: Props) {
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [activity, setActivity] = useState<State>(s);
  const [picked, setPicked] = useState<number | null>(null);
  const [pack, setPack] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    time: string;
    excerpt: string;
    kind: string;
    caseName: string;
    duration: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .GET("/api/state", {
        params: {
          query: {
            clientId: clientId || undefined,
            caseId: caseId || undefined,
          },
        },
      })
      .then((result) => {
        if (live && result.data) setActivity(result.data);
      });
    return () => {
      live = false;
    };
  }, [s, clientId, caseId]);
  const entries = activity.time_entry.filter(
    (entry) => entry.block_id !== null,
  );
  const byDate = Object.entries(
    entries.reduce<Record<string, typeof entries>>((groups, entry) => {
      (groups[entry.date] ??= []).push(entry);
      return groups;
    }, {}),
  ).sort(([a], [b]) => b.localeCompare(a));
  const selectedEntry =
    entries.find((entry) => entry.id === picked) ??
    entries.find((entry) => String(entry.id) === selected) ??
    entries.find((entry) => entry.id === 14) ??
    entries[0];
  const block = activity.block.find(
    (item) => item.id === selectedEntry?.block_id,
  );
  const matter = activity.matter.find(
    (item) => item.id === selectedEntry?.matter_id,
  );
  const owner = activity.client.find((item) => item.id === matter?.client_id);
  const period = core.periods.find(
    (item) => item.id === String(selectedEntry?.id),
  );
  const sources = activity.source.filter((item) => item.block_id === block?.id);
  const audit = activity.audit_event.filter(
    (item) => item.time_entry_id === selectedEntry?.id,
  );
  const firstMarker = activity.marker.find(
    (item) =>
      item.matter_id === matter?.id &&
      sources.some((source) => source.detected_marker === item.value),
  );
  const recognized =
    matter && block && firstMarker ? (
      <>
        Recognized from <b>{matter.reference.slice(0, 8)}</b> (window title) and{" "}
        <b>{firstMarker.value}</b> (screen {sources[0]?.timestamp ?? "—"}).
      </>
    ) : null;
  const days = Math.max(1, byDate.length);
  const recordedMs = entries.reduce((sum, entry) => {
    const recorded = activity.block.find((item) => item.id === entry.block_id);
    return sum + (recorded?.minutes ?? 0) * 60000;
  }, 0);
  const toValidate = entries.filter((entry) => {
    const canonical = core.periods.find((item) => item.id === String(entry.id));
    return entry.billable && !canonical?.timeValidated && entry.review_status !== "approved";
  }).length;
  const today = new Date().toLocaleDateString("sv-SE");
  const time =
    selectedEntry && block
      ? formatPreciseDuration(
          period ? effectiveMs(period) : selectedEntry.tenths_of_hour * 360000,
        )
      : "";
  const status =
    selectedEntry &&
    (period?.timeValidated || selectedEntry.review_status === "approved")
      ? "Validated"
      : "To validate";
  return (
    <>
      <div className="activity-crumbs">
        Activity <span>›</span> <b>{selectedEntry?.label ?? "Activity"}</b>
      </div>
      <div className="ph activity-head">
        <div className="t">
          <h1>Activity</h1>
          <p>
            Everything that was recorded, and where each billed minute comes
            from.
          </p>
        </div>
        <div className="actions activity-filters">
          <select
            className="select"
            aria-label="Client"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setCaseId("");
            }}
          >
            <option value="">All clients</option>
            {s.client.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Case"
            disabled={!clientId}
            value={caseId}
            onChange={(event) => {
              setCaseId(event.target.value);
            }}
          >
            <option value="">
              {clientId ? "All their cases" : "All cases"}
            </option>
            {clientId &&
              s.matter
                .filter((item) => String(item.client_id) === clientId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
          </select>
          <button
            className="btn"
            disabled={!matter}
            onClick={() => setPack(true)}
          >
            <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
            </svg>
            Export source pack
          </button>
        </div>
      </div>
      <section
        className="activity-timeline"
        style={{ height: `clamp(260px, ${116 + days * 30}px, 56vh)` }}
      >
        <div className="card-h">
          <div className="t">
            <h2>Timeline</h2>
            <p>
              Hover a block to preview the recording second by second. Click it
              to inspect.
            </p>
          </div>
          <div className="activity-legend">
            <span>
              <i className="ok" />
              Validated
            </span>
            <span>
              <i className="pending" />
              To validate
            </span>
            <span>
              <i className="nonbill" />
              Not billable
            </span>
            <span>
              <i className="unassigned" />
              No case
            </span>
          </div>
        </div>
        <div className="activity-timeline-body">
          <div className="activity-timeline-count" aria-live="polite">
            {byDate.length} {byDate.length === 1 ? "day" : "days"} · {formatPreciseDuration(recordedMs)} recorded · {toValidate} to validate
          </div>
          {entries.length === 0 ? (
            <div className="activity-empty">
              <p>No recorded activity matches these filters.</p>
              <button className="btn sm" onClick={() => { setClientId(""); setCaseId(""); }}>
                Clear filters
              </button>
            </div>
          ) : (
          <div
            className="activity-grid"
            style={{ gridTemplateRows: `16px repeat(${days}, minmax(22px,1fr))` }}
          >
            <span />
            <div className="activity-axis">
              {[8, 10, 12, 14, 16, 18].map((hour) => (
                <span
                  key={hour}
                  style={{ left: `${((hour - 8) / 11) * 100}%` }}
                >
                  {hour}:00
                </span>
              ))}
            </div>
            {byDate.map(([date, rows]) => (
              <Fragment key={date}>
                <span className={`activity-date ${date === today ? "today" : ""}`} key={`${date}-date`}>
                  {dayLabel(date)}{date === today && <em>Today</em>}
                </span>
                <div className="activity-track" key={`${date}-track`}>
                  {rows.map((entry) => {
                    const recorded = activity.block.find(
                      (item) => item.id === entry.block_id,
                    );
                    if (!recorded) return null;
                    const caseItem = activity.matter.find(
                      (item) => item.id === entry.matter_id,
                    );
                    const client = activity.client.find(
                      (item) => item.id === caseItem?.client_id,
                    );
                    const start =
                      ((clock(recorded.start_time) - 480) / 660) * 100;
                    const width = Math.max(
                      ((clock(recorded.end_time ?? recorded.start_time) -
                        clock(recorded.start_time)) /
                        660) *
                        100,
                      0.48,
                    );
                    const short =
                      client?.name
                        .replace(/ (Inc\.|LLC)$/, "")
                        .split(" ")
                        .at(-1) ?? "";
                    const full = `${short} · ${caseItem?.title ?? ""}`;
                    const pixels = width * 12.4;
                    const label =
                      !caseItem || days > 14
                        ? ""
                        : pixels >= full.length * 7.2 + 14
                          ? full
                          : pixels >= caseItem.title.length * 7.2 + 14
                            ? caseItem.title
                            : pixels >= short.length * 7.2 + 14
                              ? short
                              : pixels >= 60
                                ? caseItem.reference.slice(0, 8)
                                : "";
                    const canonical = core.periods.find(
                      (item) => item.id === String(entry.id),
                    );
                    const show = (x: number, y: number) => {
                      const first = activity.source.find(
                        (item) => item.block_id === entry.block_id,
                      );
                      setPreview({
                        x: Math.max(
                          8,
                          Math.min(window.innerWidth - 320, x - 140),
                        ),
                        y: Math.max(8, y - 188),
                        time: `${recorded.start_time}–${recorded.end_time}`,
                        excerpt: first?.excerpt ?? recorded.window_title,
                        kind:
                          first?.type === "audio"
                            ? "Call transcript"
                            : "Screen capture",
                        caseName: caseItem ? `${client?.name ?? ""} · ${caseItem.title}` : "No case",
                        duration: formatPreciseDuration(recorded.minutes * 60000),
                        status: !entry.matter_id ? "No case" : !entry.billable ? "Not billable" : canonical?.timeValidated || entry.review_status === "approved" ? "Validated" : "To validate",
                      });
                    };
                    return (
                      <button
                        key={entry.id}
                        className={`activity-segment ${!entry.matter_id ? "unassigned" : !entry.billable ? "nonbill" : canonical?.timeValidated || entry.review_status === "approved" ? "ok" : "pending"} ${recorded.overlaps_block_id ? "overlap" : ""}`}
                        style={{ left: `${start}%`, width: `${width}%` }}
                        aria-pressed={entry.id === selectedEntry?.id}
                        aria-label={`${client?.name ?? "No case"} · ${caseItem?.title ?? "Unassigned"}, ${recorded.start_time} to ${recorded.end_time}. Click to inspect`}
                        onMouseMove={(event) =>
                          show(event.clientX, event.clientY)
                        }
                        onMouseLeave={() => setPreview(null)}
                        onFocus={(event) => {
                          const box =
                            event.currentTarget.getBoundingClientRect();
                          show(box.left + box.width / 2, box.top);
                        }}
                        onBlur={() => setPreview(null)}
                        onClick={() => {
                          setPicked(entry.id);
                          setPreview(null);
                          detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Fragment>
            ))}
          </div>
          )}
        </div>
      </section>
      {preview && (
        <div
          className="activity-preview glass"
          style={{ left: preview.x, top: preview.y }}
          aria-hidden="true"
        >
          <strong>{preview.caseName}</strong>
          <b>
            {preview.time} · {preview.duration} · {preview.status}
          </b>
          <p>{preview.kind}: {preview.excerpt}</p>
          <small>Click to inspect</small>
        </div>
      )}
      <div className="activity-lower">
        <section className="activity-detail" ref={detailRef}>
          <div className="card-h">
            <div className="t">
              <h2>{selectedEntry?.label ?? "No activity recorded"}</h2>
              <p>
                {owner?.name ?? "No case"} · {matter?.title ?? "Unassigned"} ·{" "}
                {matter?.reference ?? ""} ·{" "}
                {selectedEntry ? shortDate(selectedEntry.date) : ""}
                {block ? `, ${block.start_time}–${block.end_time}` : ""}
              </p>
            </div>
            <div className="activity-summary">
              <span className={status === "Validated" ? "ok" : "pending"}>
                <i aria-hidden="true" />
                {status}
              </span>
              <b>
                {time}
                {selectedEntry?.billable && matter && matter.mode !== "flat_fee"
                  ? ` · ${dollars(selectedEntry.amount_cents || Math.round((selectedEntry.tenths_of_hour * (matter.own_rate_cents ?? owner?.rate_cents ?? s.firm[0].base_rate_cents)) / 10))}`
                  : ""}
              </b>
            </div>
          </div>
          {recognized && <div className="recognized-strip">{recognized}</div>}
          <div className="activity-sources">
            {sources.length ? (
              sources.map((item) => {
                const canonical = core.sources.find(
                  (source) => source.id === String(item.id),
                );
                const before = item.excerpt.indexOf(
                  item.detected_marker ?? "\0",
                );
                return (
                  <div className="activity-source-row" key={item.id}>
                    <span className="num muted">{item.timestamp}</span>
                    <div>
                      <div>
                        {before >= 0 ? (
                          <>
                            {item.excerpt.slice(0, before)}
                            <mark>{item.detected_marker}</mark>
                            {item.excerpt.slice(
                              before + item.detected_marker.length,
                            )}
                          </>
                        ) : (
                          item.excerpt
                        )}
                      </div>
                      <span className="meta">
                        {item.type === "audio" ? "Audio" : "Screen"} ·{" "}
                        {block?.app}
                      </span>
                      <div className="activity-source-actions">
                        <span className="activity-source-status">
                          <i aria-hidden="true" />
                          {item.available
                            ? "Available"
                            : "Unavailable in screenpipe"}
                        </span>
                        <label>
                          <input
                            type="checkbox"
                            checked={
                              canonical?.validationStatus === "validated"
                            }
                            disabled={!canonical}
                            aria-disabled={
                              canonical?.validationStatus === "validated"
                            }
                            onChange={() => {
                              if (
                                canonical &&
                                canonical.validationStatus !== "validated"
                              )
                                void action(
                                  api.POST(
                                    "/api/sources/{instanceId}/{contentType}/{externalId}/validate",
                                    {
                                      params: {
                                        path: {
                                          instanceId: canonical.instanceId,
                                          contentType: canonical.contentType,
                                          externalId: canonical.externalId,
                                        },
                                      },
                                      body: {},
                                    },
                                  ),
                                );
                            }}
                          />{" "}
                          Source validated
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted">
                {selectedEntry
                  ? "Entered by hand · Off-screen time has no capture."
                  : "Choose another client or case."}
              </p>
            )}
          </div>
        </section>
        <section className="activity-audit">
          <div className="card-h">
            <div className="t">
              <h2>Audit trail</h2>
              <p>Every action on this entry, in order.</p>
            </div>
          </div>
          <div className="activity-audit-body">
            {audit.length ? (
              <ol>
                {audit.map((item) => (
                  <li key={item.id}>
                    <span className="dot" />
                    <div>
                      <b>{item.action}</b>
                      <div className="meta">
                        {item.actor === "TimeKeepr" ? "TimeKeeper" : item.actor}{" "}
                        · {item.timestamp}
                        {item.after &&
                        !/confidence|probability/i.test(item.after)
                          ? ` · ${item.after.replace(/(?:frame_id|chunk_id)\s*\d+/gi, "").trim()}`
                          : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                No events yet · Actions on this entry will be listed here.
              </p>
            )}
          </div>
        </section>
      </div>
      {pack && matter && (
        <ActivitySourcePackDialog
          s={s}
          core={core}
          matterId={matter.id}
          initialPeriodId={selectedEntry.id}
          action={action}
          close={() => setPack(false)}
        />
      )}
    </>
  );
}
