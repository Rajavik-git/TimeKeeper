import type { CoreState } from "../../../api/client";

export type ImportedSource = CoreState["sources"][number];

export function sourceTypeLabel(contentType: string) {
  switch (contentType) {
    case "accessibility":
      return "Accessibility";
    case "ocr":
      return "OCR";
    case "audio":
      return "Audio";
    default:
      return contentType || "Unknown type";
  }
}

export function newestSources(sources: CoreState["sources"]) {
  return [...sources].sort((left, right) => {
    const leftTime = Date.parse(left.recordedAt);
    const rightTime = Date.parse(right.recordedAt);
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (leftValid && rightValid && leftTime !== rightTime) return rightTime - leftTime;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function sourceDate(recordedAt: string) {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}
