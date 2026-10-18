import { calendarDay, calendarTime, systemTimeZone } from "../../../../../shared/dates";
import { shortDate, type CoreState } from "../../../../api/client";

/** Preview only evidence linked to this period; observations do not prove continuous duration. */
export function ActivityPeek({
  period,
  sources,
  fraction,
  x,
  y,
}: {
  period: CoreState["periods"][number];
  sources: CoreState["sources"];
  fraction: number;
  x: number;
  y: number;
}) {
  const start = Date.parse(period.startedAt);
  const end = period.endedAt ? Date.parse(period.endedAt) : start;
  const timestamp = start + fraction * Math.max(0, end - start);
  const nearest = sources.reduce<CoreState["sources"][number] | undefined>(
    (current, source) =>
      !current ||
      Math.abs(Date.parse(source.recordedAt) - timestamp) <
        Math.abs(Date.parse(current.recordedAt) - timestamp)
        ? source
        : current,
    undefined,
  );
  return (
    <div className="activity-peek" style={{ left: x, top: y }} aria-hidden="true">
      <div className="ph2">
        <b>{calendarTime(timestamp, systemTimeZone(), true)}</b>
        <span className="muted">
          {shortDate(calendarDay(timestamp))} · {period.demoApp ?? "Activity"}
        </span>
      </div>
      <div className="scr">
        <div className="pg">
          {nearest ? (
            <>
              <b>
                {calendarTime(nearest.recordedAt)} ·{" "}
                {nearest.contentType === "audio" ? "Audio observation" : "Screen observation"}
              </b>
              <p>
                {nearest.excerpt ??
                  "Observation metadata available. No media preview has been loaded."}
              </p>
            </>
          ) : (
            <span className="empty">No evidence is linked to this period.</span>
          )}
        </div>
      </div>
      <div className="ft">
        <div className="meta">
          <span>
            {calendarTime(period.startedAt)}–{period.endedAt ? calendarTime(period.endedAt) : "now"}
          </span>
        </div>
      </div>
    </div>
  );
}
