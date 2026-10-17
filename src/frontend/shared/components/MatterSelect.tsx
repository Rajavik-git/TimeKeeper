import type { State } from "../../api/client";
import { label } from "../../api/client";
export function MatterSelect({
  s,
  value,
  onChange,
  allowEmpty = false,
}: {
  s: State;
  value: number | null;
  onChange: (id: number | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select
      className="field"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label="Case"
    >
      {allowEmpty && <option value="">Choose a case…</option>}
      {s.matter.map((d) => (
        <option key={d.id} value={d.id}>
          {label(s, d.id)}
        </option>
      ))}
    </select>
  );
}
