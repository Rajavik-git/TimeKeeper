import { Fragment, useEffect, useRef, useState } from "react";
import { api, shortDate, type ScreenProps, type State } from "../../api/client";
import { ActivitySourcePackDialog } from "./ActivitySourcePackDialog";
import { ActivityPeek } from "./ActivityPeek";
import { effectiveMs, formatPreciseDuration } from "../../calculations/billing";
import "./Activity.css";

type Props = ScreenProps & { selected: string };
const clock = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function Source({ s, core, selected, action, navigate }: Props) {
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [activity, setActivity] = useState<State>(s);
  const [picked, setPicked] = useState<number | null>(null);
  const [pack, setPack] = useState(false);
  const [notice, setNotice] = useState("");
  const [validatingSource, setValidatingSource] = useState<number | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    blockId: number;
    fraction: number;
  } | null>(null);
  const [cursor, setCursor] = useState<{
    fraction: number;
    time: string;
  } | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);
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
  const peekBlock = activity.block.find((item) => item.id === preview?.blockId);
  const recordedMs = entries.reduce((sum, entry) => {
    const recorded = activity.block.find((item) => item.id === entry.block_id);
    return sum + (recorded?.minutes ?? 0) * 60000;
  }, 0);
  const toValidate = entries.filter((entry) => {
    const canonical = core.periods.find((item) => item.id === String(entry.id));
    return (
      entry.billable &&
      !canonical?.timeValidated &&
      entry.review_status !== "approved"
    );
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
      {notice && (
        <div className="activity-toast" role="status">
          {notice}
        </div>
      )}
      <div className="activity-crumbs">
        {selected ? (
          <button className="activity-back" onClick={() => navigate("myDay")}>
            ← Back to My day
          </button>
        ) : (
          "Activity"
        )}{" "}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5 3 4 4-4 4" />
        </svg>{" "}
        <b>{selectedEntry?.label ?? "Activity"}</b>
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
        style={{ height: `clamp(260px, ${137 + days * 30}px, 56vh)` }}
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
            <span>
              <i className="overlap" />
              Overlap
            </span>
          </div>
        </div>
        <div className="activity-timeline-body">
          <div className="activity-timeline-count" aria-live="polite">
            {byDate.length} {byDate.length === 1 ? "day" : "days"} ·{" "}
            {formatPreciseDuration(recordedMs)} recorded · {toValidate} to
            validate
          </div>
          {entries.length === 0 ? (
            <div className="activity-empty">
              <p>No recorded activity matches these filters.</p>
              <button
                className="btn sm"
                onClick={() => {
                  setClientId("");
                  setCaseId("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              className="activity-grid"
              style={{
                gridTemplateRows: `16px repeat(${days}, minmax(22px,1fr))`,
              }}
              onMouseLeave={() => {
                setCursor(null);
                setPreview(null);
              }}
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
                {cursor && (
                  <span
                    className="activity-cursor-label"
                    style={{ left: `${cursor.fraction * 100}%` }}
                  >
                    {cursor.time}
                  </span>
                )}
              </div>
              {byDate.map(([date, rows]) => (
                <Fragment key={date}>
                  <span
                    className={`activity-date ${date === today ? "today" : ""}`}
                    key={`${date}-date`}
                  >
                    {shortDate(date)}
                    {date === today && <em>Today</em>}
                  </span>
                  <div
                    className="activity-track"
                    key={`${date}-track`}
                    onMouseMove={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      const fraction = Math.max(
                        0,
                        Math.min(1, (event.clientX - box.left) / box.width),
                      );
                      const seconds = 8 * 3600 + fraction * 11 * 3600;
                      const hours = Math.floor(seconds / 3600);
                      const minutes = Math.floor((seconds % 3600) / 60);
                      setCursor({
                        fraction,
                        time: `${hours}:${String(minutes).padStart(2, "0")}`,
                      });
                    }}
                  >
                    {cursor && (
                      <i
                        className="activity-cursor-line"
                        style={{ left: `${cursor.fraction * 100}%` }}
                        aria-hidden="true"
                      />
                    )}
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
                        0.72,
                      );
                      const short =
                        client?.name
                          .replace(/ (Inc\.|LLC)$/, "")
                          .split(" ")
                          .at(-1) ?? "";
                      const full = caseItem?.title
                        .toLowerCase()
                        .includes(short.toLowerCase())
                        ? caseItem.title
                        : `${short} · ${caseItem?.title ?? ""}`;
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
                      const show = (x: number, y: number, fraction: number) => {
                        let left = x + 16;
                        let top = y + 16;
                        if (left + 350 > window.innerWidth) left = x - 356;
                        if (top + 270 > window.innerHeight) top = y - 276;
                        setPreview({
                          x: Math.max(8, left),
                          y: Math.max(8, top),
                          blockId: recorded.id,
                          fraction,
                        });
                      };
                      return (
                        <button
                          key={entry.id}
                          className={`activity-segment ${!entry.matter_id ? "unassigned" : !entry.billable ? "nonbill" : canonical?.timeValidated || entry.review_status === "approved" ? "ok" : "pending"} ${recorded.overlaps_block_id ? "overlap" : ""}`}
                          style={{ left: `${start}%`, width: `${width}%` }}
                          aria-pressed={entry.id === selectedEntry?.id}
                          aria-label={`${client?.name ?? "No case"} · ${caseItem?.title ?? "Unassigned"}, ${recorded.start_time} to ${recorded.end_time}. Click to inspect`}
                          onMouseMove={(event) => {
                            const box =
                              event.currentTarget.getBoundingClientRect();
                            show(
                              event.clientX,
                              event.clientY,
                              Math.max(
                                0,
                                Math.min(
                                  1,
                                  (event.clientX - box.left) / box.width,
                                ),
                              ),
                            );
                          }}
                          onMouseLeave={() => setPreview(null)}
                          onKeyDown={(event) => {
                            if (
                              ![
                                "ArrowLeft",
                                "ArrowRight",
                                "ArrowUp",
                                "ArrowDown",
                              ].includes(event.key)
                            )
                              return;
                            const all = [
                              ...event.currentTarget
                                .closest(".activity-grid")!
                                .querySelectorAll<HTMLButtonElement>(
                                  ".activity-segment",
                                ),
                            ];
                            const current = all.indexOf(event.currentTarget);
                            const track = event.currentTarget.parentElement;
                            const sameDay = all.filter(
                              (item) => item.parentElement === track,
                            );
                            const sameIndex = sameDay.indexOf(
                              event.currentTarget,
                            );
                            const target =
                              event.key === "ArrowLeft"
                                ? sameDay[sameIndex - 1]
                                : event.key === "ArrowRight"
                                  ? sameDay[sameIndex + 1]
                                  : event.key === "ArrowUp"
                                    ? all
                                        .slice(0, current)
                                        .reverse()
                                        .find(
                                          (item) =>
                                            item.parentElement !== track,
                                        )
                                    : all
                                        .slice(current + 1)
                                        .find(
                                          (item) =>
                                            item.parentElement !== track,
                                        );
                            if (target) {
                              event.preventDefault();
                              target.focus();
                            }
                          }}
                          onClick={() => {
                            setPicked(entry.id);
                            setPreview(null);
                            setFlash(false);
                            if (flashTimer.current !== null)
                              window.clearTimeout(flashTimer.current);
                            window.requestAnimationFrame(() => setFlash(true));
                            flashTimer.current = window.setTimeout(
                              () => setFlash(false),
                              300,
                            );
                            detailRef.current?.scrollIntoView({
                              block: "nearest",
                              behavior: "smooth",
                            });
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
      {preview && peekBlock && (
        <ActivityPeek
          block={peekBlock}
          sources={activity.source.filter(
            (item) => item.block_id === peekBlock.id,
          )}
          fraction={preview.fraction}
          x={preview.x}
          y={preview.y}
        />
      )}
      <div className="activity-lower">
        <section
          className={`activity-detail ${flash ? "flash" : ""}`}
          ref={detailRef}
        >
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
                            disabled={
                              !canonical || validatingSource === item.id
                            }
                            aria-disabled={
                              canonical?.validationStatus === "validated"
                            }
                            onChange={async () => {
                              if (
                                canonical &&
                                canonical.validationStatus !== "validated"
                              ) {
                                setValidatingSource(item.id);
                                const result = await action(
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
                                setValidatingSource(null);
                                if (result !== undefined)
                                  setNotice("Source validated");
                              }
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
                        · {shortDate(item.timestamp.slice(0, 10))},{" "}
                        {item.timestamp.slice(11, 16)}
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
