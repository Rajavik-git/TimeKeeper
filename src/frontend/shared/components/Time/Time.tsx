import { formatTenthsOfHour } from "../../../api/client";
export function Time({ value }: { value: number }) {
  return <span className="num">{formatTenthsOfHour(value)}</span>;
}
