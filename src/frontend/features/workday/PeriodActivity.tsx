import { useToday } from "../../shared/hooks/useToday";
import { calendarDay, calendarTime, systemTimeZone } from "../../../shared/dates";
import {
  activityPeriods,
  selectActivityPeriod,
  activityTimeline,
} from "../../calculations/activity";
import { money } from "../../shared/format";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, shortDate, type ScreenProps } from "../../api/client";
import { ActivitySourcePackDialog } from "./ActivitySourcePackDialog";
import { ActivityPeek } from "./ActivityPeek";
import {
  effectiveMs,
  formatPreciseDuration,
  dayFees,
  summarizeWork,
} from "../../calculations/billing";
import "./Activity.css";

type Props = ScreenProps & { selected: string };
export function PeriodActivity({
  catalogState,
  workspaceState,
  selected,
  action,
  navigate,
}: Props) {
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("");

  const [picked, setPicked] = useState<{ id: string; requestedId: string } | null>(null);
  const [pack, setPack] = useState(false);
  const [notice, setNotice] = useState("");
  const [validatingSource, setValidatingSource] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    periodId: string;
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
  const activity = catalogState;
  useEffect(() => {
    const hidePreview = () => setPreview(null);
    window.addEventListener("scroll", hidePreview, true);
    return () => {
      window.removeEventListener("scroll", hidePreview, true);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);
  const entries = activityPeriods(activity, workspaceState, clientId, caseId);
  const byDate = Object.entries(
    entries.reduce<Record<string, typeof entries>>((groups, entry) => {
      (groups[entry.date] ??= []).push(entry);
      return groups;
    }, {}),
  )
    .sort(([a], [b]) => b.localeCompare(a))
    .map(
      ([date, rows]) =>
        [
          date,
          [...rows].sort((a, b) => {
            const startA = a.period.startedAt;
            const startB = b.period.startedAt;
            return Date.parse(startA) - Date.parse(startB) || a.id.localeCompare(b.id);
          }),
        ] as const,
    );
  const selectedEntry = selectActivityPeriod(
    entries,
    selected,
    picked?.requestedId === selected ? picked.id : undefined,
  );
  const block = selectedEntry?.period;
  const caseItem = activity.cases.find((item) => String(item.id) === String(selectedEntry?.caseId));
  const owner = activity.clients.find((item) => String(item.id) === String(caseItem?.clientId));
  const period = workspaceState.periods.find((item) => item.id === String(selectedEntry?.id));
  const sources = workspaceState.sources
    .filter((source) => source.workPeriodId === period?.id)
    .map((source) => {
      return {
        id: source.id,
        timestamp: calendarTime(source.recordedAt, systemTimeZone(), true),
        excerpt:
          source.excerpt ?? "Observation metadata available. No media preview has been loaded.",
        detectedMarker: source.detectedMarker ?? "",
        type: source.contentType,
        available: source.availabilityStatus === "available",
        canonical: source,
      };
    });
  const audit = workspaceState.auditEvents.filter((item) => item.periodId === selectedEntry?.id);
  const firstMarker = activity.markers.find(
    (item) =>
      String(item.caseId) === String(caseItem?.id) &&
      sources.some((source) => source.detectedMarker === item.value),
  );
  const markerSource = sources.find((source) => source.detectedMarker === firstMarker?.value);
  const recognized =
    caseItem && block && firstMarker ? (
      <>
        Recognized from <b>{block.demoWindowTitle}</b> (window title) and <b>{firstMarker.value}</b>{" "}
        (screen {markerSource?.timestamp ?? "—"}).
      </>
    ) : null;
  const days = Math.max(1, byDate.length);
  const peekPeriod = workspaceState.periods.find((item) => item.id === preview?.periodId);
  const activitySummary = summarizeWork(
    workspaceState.periods.filter((item) => entries.some((entry) => String(entry.id) === item.id)),
    workspaceState.sources,
  );
  const recordedMs = activitySummary.preciseDurationMs;
  const timeline = activityTimeline(entries.map((entry) => entry.period));
  const toValidate = entries.filter((entry) => {
    const canonical = workspaceState.periods.find((item) => item.id === String(entry.id));
    return entry.billable && !canonical?.timeValidated && entry.reviewStatus !== "approved";
  }).length;
  const today = useToday();
  const time = period ? formatPreciseDuration(effectiveMs(period)) : "";
  const status =
    selectedEntry && (period?.timeValidated || selectedEntry.reviewStatus === "approved")
      ? "Validated"
      : "To validate";
  return (
    <>
      {selected && !selectedEntry && (
        <p role="status">This period is not available in the current activity filters.</p>
      )}
      {!activitySummary.complete && (
        <p role="status">Partial activity total · some durations or sources are unavailable.</p>
      )}
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
          <p>Everything that was recorded, and where each billed minute comes from.</p>
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
            {catalogState.clients.map((client) => (
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
            <option value="">{clientId ? "All their cases" : "All cases"}</option>
            {clientId &&
              catalogState.cases
                .filter((item) => String(item.clientId) === clientId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
          </select>
          <button className="btn" disabled={!caseItem} onClick={() => setPack(true)}>
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
              Elapsed hours since local midnight. Click a period to inspect its observations.
              Screenpipe media previews are not available yet.
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
            {byDate.length} {byDate.length === 1 ? "day" : "days"} ·{" "}
            {formatPreciseDuration(recordedMs)} recorded · {toValidate} to validate
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
              <div className="activity-axis" aria-label="Elapsed hours since midnight">
                {timeline.ticks.map((hour) => (
                  <span
                    key={hour}
                    style={{ left: `${((hour * 3600000) / timeline.spanMs) * 100}%` }}
                  >
                    {hour}h
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
                    style={
                      {
                        "--timeline-step": `${((timeline.ticks[1]! * 3600000) / timeline.spanMs) * 100}%`,
                      } as React.CSSProperties
                    }
                    key={`${date}-track`}
                    onMouseMove={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      const fraction = Math.max(
                        0,
                        Math.min(1, (event.clientX - box.left) / box.width),
                      );
                      const position = timeline.positions.get(rows[0]!.id)!;
                      const instant = position.midnight + fraction * timeline.spanMs;
                      const cursorDay = calendarDay(instant);
                      setCursor({
                        fraction,
                        time: `${calendarTime(instant)}${cursorDay !== date ? ` (${shortDate(cursorDay)})` : ""}`,
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
                      const recorded = {
                        startTime: calendarTime(entry.period.startedAt, systemTimeZone(), true),
                        endTime: entry.period.endedAt
                          ? `${calendarTime(entry.period.endedAt, systemTimeZone(), true)}${calendarDay(entry.period.endedAt) !== date ? ` (${shortDate(calendarDay(entry.period.endedAt))})` : ""}`
                          : null,
                      };
                      const caseItem = activity.cases.find(
                        (item) => String(item.id) === String(entry.caseId),
                      );
                      const client = activity.clients.find(
                        (item) => String(item.id) === String(caseItem?.clientId),
                      );
                      const position = timeline.positions.get(entry.id)!;
                      const start = (position.startMs / timeline.spanMs) * 100;
                      const width = Math.max(
                        ((position.endMs - position.startMs) / timeline.spanMs) * 100,
                        0.72,
                      );
                      const short =
                        client?.name
                          .replace(/ (Inc\.|LLC)$/, "")
                          .split(" ")
                          .at(-1) ?? "";
                      const full = caseItem?.title.toLowerCase().includes(short.toLowerCase())
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
                      const canonical = workspaceState.periods.find(
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
                          periodId: entry.id,
                          fraction,
                        });
                      };
                      return (
                        <button
                          key={entry.id}
                          className={`activity-segment ${!entry.caseId ? "unassigned" : !entry.billable ? "nonbill" : canonical?.timeValidated || entry.reviewStatus === "approved" ? "ok" : "pending"} `}
                          style={{ left: `${start}%`, width: `${width}%` }}
                          aria-pressed={entry.id === selectedEntry?.id}
                          aria-label={`${client?.name ?? "No case"} · ${caseItem?.title ?? "Unassigned"}, ${recorded.startTime} to ${recorded.endTime ?? "now"}. Click to inspect`}
                          onMouseMove={(event) => {
                            const box = event.currentTarget.getBoundingClientRect();
                            show(
                              event.clientX,
                              event.clientY,
                              Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
                            );
                          }}
                          onMouseLeave={() => setPreview(null)}
                          onFocus={(event) => {
                            const box = event.currentTarget.getBoundingClientRect();
                            show(box.left + box.width / 2, box.top + box.height / 2, 0.5);
                          }}
                          onBlur={() => setPreview(null)}
                          onKeyDown={(event) => {
                            if (
                              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                                event.key,
                              )
                            )
                              return;
                            const all = [
                              ...event.currentTarget
                                .closest(".activity-grid")!
                                .querySelectorAll<HTMLButtonElement>(".activity-segment"),
                            ];
                            const current = all.indexOf(event.currentTarget);
                            const track = event.currentTarget.parentElement;
                            const sameDay = all.filter((item) => item.parentElement === track);
                            const sameIndex = sameDay.indexOf(event.currentTarget);
                            const target =
                              event.key === "ArrowLeft"
                                ? sameDay[sameIndex - 1]
                                : event.key === "ArrowRight"
                                  ? sameDay[sameIndex + 1]
                                  : event.key === "ArrowUp"
                                    ? all
                                        .slice(0, current)
                                        .reverse()
                                        .find((item) => item.parentElement !== track)
                                    : all
                                        .slice(current + 1)
                                        .find((item) => item.parentElement !== track);
                            if (target) {
                              event.preventDefault();
                              target.focus();
                            }
                          }}
                          onClick={() => {
                            setPicked({ id: entry.id, requestedId: selected });
                            setPreview(null);
                            setFlash(false);
                            if (flashTimer.current !== null)
                              window.clearTimeout(flashTimer.current);
                            window.requestAnimationFrame(() => setFlash(true));
                            flashTimer.current = window.setTimeout(() => setFlash(false), 300);
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
      {preview && peekPeriod && (
        <ActivityPeek
          period={peekPeriod}
          sources={workspaceState.sources.filter((item) => item.workPeriodId === peekPeriod.id)}
          fraction={preview.fraction}
          x={preview.x}
          y={preview.y}
        />
      )}
      <div className="activity-lower">
        <section className={`activity-detail ${flash ? "flash" : ""}`} ref={detailRef}>
          <div className="card-h">
            <div className="t">
              <h2>{selectedEntry?.label ?? "No activity recorded"}</h2>
              <p>
                {owner?.name ?? "No case"} · {caseItem?.title ?? "Unassigned"} ·{" "}
                {caseItem?.reference ?? ""} · {selectedEntry ? shortDate(selectedEntry.date) : ""}
                {block
                  ? `, ${calendarTime(block.startedAt)}–${block.endedAt ? calendarTime(block.endedAt) : "now"}`
                  : ""}
              </p>
            </div>
            <div className="activity-summary">
              <span className={status === "Validated" ? "ok" : "pending"}>
                <i aria-hidden="true" />
                {status}
              </span>
              <b>
                {time}
                {selectedEntry?.billable && caseItem && caseItem.mode !== "flat_fee"
                  ? period && effectiveMs(period) !== null
                    ? ` · ${money(dayFees(catalogState, workspaceState, [period]), period.appliedCurrency ?? catalogState.settings.currency ?? "USD")}`
                    : " · Fee unknown"
                  : ""}
              </b>
            </div>
          </div>
          {recognized && <div className="recognized-strip">{recognized}</div>}
          <div className="activity-sources">
            {sources.length ? (
              sources.map((item) => {
                const canonical = item.canonical;
                const before = item.excerpt.indexOf(item.detectedMarker ?? "\0");
                return (
                  <div className="activity-source-row" key={item.id}>
                    <span className="num muted">{item.timestamp}</span>
                    <div>
                      <div>
                        {before >= 0 ? (
                          <>
                            {item.excerpt.slice(0, before)}
                            <mark>{item.detectedMarker}</mark>
                            {item.excerpt.slice(before + item.detectedMarker.length)}
                          </>
                        ) : (
                          item.excerpt
                        )}
                      </div>
                      <span className="meta">
                        {item.type === "audio" ? "Audio" : "Screen"} · {block?.demoApp}
                      </span>
                      <div className="activity-source-actions">
                        <span className="activity-source-status">
                          <i aria-hidden="true" />
                          {canonical.availabilityStatus === "available"
                            ? "Available"
                            : canonical.availabilityStatus === "unavailable"
                              ? "Unavailable in Screenpipe"
                              : "Availability not checked"}
                        </span>
                        <label>
                          <input
                            type="checkbox"
                            checked={canonical?.validationStatus === "validated"}
                            disabled={!canonical || validatingSource === item.id}
                            aria-disabled={canonical?.validationStatus === "validated"}
                            onChange={async () => {
                              if (canonical && canonical.validationStatus !== "validated") {
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
                                if (result !== undefined) setNotice("Source validated");
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
                  ? "No evidence is linked to this period. Its duration and source coverage require separate review."
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
                        {item.actor === "TimeKeepr" ? "TimeKeeper" : item.actor} ·{" "}
                        {shortDate(calendarDay(item.timestamp))}, {calendarTime(item.timestamp)}
                        {item.after && !/confidence|probability/i.test(item.after)
                          ? ` · ${item.after.replace(/(?:frame_id|chunk_id)\s*\d+/gi, "").trim()}`
                          : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No events yet · Actions on this entry will be listed here.</p>
            )}
          </div>
        </section>
      </div>
      {pack && caseItem && (
        <ActivitySourcePackDialog
          catalogState={catalogState}
          workspaceState={workspaceState}
          caseId={caseItem.id}
          initialPeriodId={period?.id}
          action={action}
          close={() => setPack(false)}
        />
      )}
    </>
  );
}
