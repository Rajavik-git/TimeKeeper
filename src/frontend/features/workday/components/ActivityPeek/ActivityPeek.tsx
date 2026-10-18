import { useEffect, useState } from "react";
import { calendarDay, calendarTime, systemTimeZone } from "../../../../../shared/dates";
import { shortDate, type CoreState } from "../../../../api/client";
import type { FramesState } from "../../hooks/useScreenpipeFrames";
import { frameImageUrl, nearestFrame, type ScreenpipeFrame } from "../../lib/screenpipeFrames";

/** Scrubbing only swaps the screenshot once the pointer rests this long. */
const settleMs = 120;

function useSettledFrame(frame: ScreenpipeFrame | null): ScreenpipeFrame | null {
  const [settled, setSettled] = useState(frame);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(frame), settleMs);
    return () => window.clearTimeout(timer);
  }, [frame]);
  return settled;
}

/** Shows the Screenpipe capture nearest the hovered instant, else the evidence linked to the period. */
export function ActivityPeek({
  period,
  sources,
  frames,
  fraction,
  x,
  y,
}: {
  period: CoreState["periods"][number];
  sources: CoreState["sources"];
  frames: FramesState;
  fraction: number;
  x: number;
  y: number;
}) {
  const start = Date.parse(period.startedAt);
  const end = period.endedAt ? Date.parse(period.endedAt) : start;
  const timestamp = start + fraction * Math.max(0, end - start);
  const candidate = frames.status === "ok" ? nearestFrame(frames.frames, timestamp) : null;
  const frame = useSettledFrame(candidate);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const shownFrame = frame && frame.frameId !== failedFrame ? frame : null;
  const nearest = sources.reduce<CoreState["sources"][number] | undefined>(
    (current, source) =>
      !current ||
      Math.abs(Date.parse(source.recordedAt) - timestamp) <
        Math.abs(Date.parse(current.recordedAt) - timestamp)
        ? source
        : current,
    undefined,
  );
  const note =
    frames.status === "unavailable" || frames.status === "unauthorized"
      ? `Screenpipe not connected · ${frames.message}`
      : frames.status === "ok" && !candidate
        ? "No Screenpipe capture at this time"
        : null;
  return (
    <div className="activity-peek" style={{ left: x, top: y }} aria-hidden="true">
      <div className="ph2">
        <b>{calendarTime(timestamp, systemTimeZone(), true)}</b>
        <span className="muted">
          {shortDate(calendarDay(timestamp))} ·{" "}
          {shownFrame?.appName ?? period.demoApp ?? "Activity"}
        </span>
      </div>
      <div className="scr">
        {shownFrame ? (
          <img
            className="activity-peek-frame"
            src={frameImageUrl(shownFrame.frameId)}
            alt={`Screenpipe capture at ${calendarTime(shownFrame.recordedAt)}`}
            width={318}
            height={130}
            decoding="async"
            onError={() => setFailedFrame(shownFrame.frameId)}
          />
        ) : frames.status === "loading" || (candidate && candidate.frameId !== failedFrame) ? (
          <div className="activity-peek-loading" />
        ) : (
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
        )}
      </div>
      <div className="ft">
        <div className="meta">
          <span>
            {shownFrame
              ? `${calendarTime(shownFrame.recordedAt)} · ${shownFrame.windowTitle}`
              : `${calendarTime(period.startedAt)}–${period.endedAt ? calendarTime(period.endedAt) : "now"}`}
          </span>
          {note && <span className="activity-peek-note">{note}</span>}
        </div>
      </div>
    </div>
  );
}
