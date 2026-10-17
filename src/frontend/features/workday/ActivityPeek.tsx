import { shortDate, type State } from "../../api/client";

type Block = State["block"][number];
type Source = State["source"][number];

const seconds = (value: string) => {
  const [hours, minutes, remainder = 0] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + remainder;
};
const hms = (value: number) => {
  const rounded = Math.round(value);
  return [
    Math.floor(rounded / 3600),
    Math.floor((rounded % 3600) / 60),
    rounded % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
};
const highlighted = (excerpt: string, marker: string) => {
  const index = marker ? excerpt.indexOf(marker) : -1;
  return index < 0 ? (
    excerpt
  ) : (
    <>
      {excerpt.slice(0, index)}
      <mark>{marker}</mark>
      {excerpt.slice(index + marker.length)}
    </>
  );
};

export function ActivityPeek({
  block,
  sources,
  fraction,
  x,
  y,
}: {
  block: Block;
  sources: Source[];
  fraction: number;
  x: number;
  y: number;
}) {
  const start = seconds(block.start_time);
  const end = seconds(block.end_time ?? new Date().toTimeString().slice(0, 8));
  const timestamp = start + fraction * (end - start);
  const nearest = sources.reduce<Source | undefined>(
    (current, source) =>
      !current ||
      Math.abs(seconds(source.timestamp) - timestamp) <
        Math.abs(seconds(current.timestamp) - timestamp)
        ? source
        : current,
    undefined,
  );
  const audio =
    nearest?.type === "audio" &&
    Math.abs(seconds(nearest.timestamp) - timestamp) < 300;
  return (
    <div
      className="activity-peek"
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      <div className="ph2">
        <b>{hms(timestamp)}</b>
        <span className="muted">
          {shortDate(block.date)} · {block.app}
        </span>
      </div>
      {audio ? (
        <div className="scr">
          <div className="wave">
            {Array.from({ length: 48 }, (_, index) => {
              const height = Math.round(
                (Math.abs(
                  Math.sin(index * 1.7 + timestamp / 7) * Math.cos(index * 0.6),
                ) *
                  0.85 +
                  0.15) *
                  100,
              );
              return <span key={index} style={{ height: `${height}%` }} />;
            })}
          </div>
          <div className="tr">
            {nearest && highlighted(nearest.excerpt, nearest.detected_marker)}
          </div>
        </div>
      ) : (
        <div className="scr">
          <div className="wbar">
            <i />
            <i />
            <i />
            {block.app} · {block.window_title}
          </div>
          <div className="pg">
            <div className="gl" style={{ width: "70%" }} />
            {nearest ? (
              highlighted(nearest.excerpt, nearest.detected_marker)
            ) : (
              <span className="empty">No text captured at this moment.</span>
            )}
            <div className="gl" />
            <div className="gl" style={{ width: "85%" }} />
            <div className="gl" style={{ width: "60%" }} />
          </div>
        </div>
      )}
      <div className="ft">
        <div className="prog">
          <i style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <div className="meta">
          <span />
          <span>
            {audio ? "Audio" : "Screen"} · {block.start_time}–
            {block.end_time ?? "now"}
          </span>
        </div>
      </div>
    </div>
  );
}
