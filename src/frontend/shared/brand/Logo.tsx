import fullMark from "./timekeeper-mark.svg?raw";
import smallMark from "./timekeeper-mark-small.svg?raw";

export function Logo({
  compact = false,
  wordmark = true,
}: {
  compact?: boolean;
  wordmark?: boolean;
}) {
  return (
    <span className="brand" aria-label={wordmark ? undefined : "TimeKeeper"}>
      <span
        className="brand-mark"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: compact ? smallMark : fullMark }}
      />
      {wordmark && <span className="brand-wordmark">TimeKeeper</span>}
    </span>
  );
}
