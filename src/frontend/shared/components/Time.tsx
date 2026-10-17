import { hours } from "../../api/client";
export function Time({ value }: { value: number }) {
  return <span className="num">{hours(value)}</span>;
}
