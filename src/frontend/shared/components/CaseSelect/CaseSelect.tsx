import type { State, EntityId } from "../../../api/client";
import { caseLabel } from "../../../api/client";
export function CaseSelect({
  catalogState,
  value,
  onChange,
  allowEmpty = false,
}: {
  catalogState: State;
  value: EntityId | null;
  onChange: (id: EntityId | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select
      className="field"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      aria-label="Case"
    >
      {allowEmpty && <option value="">Choose a case…</option>}
      {catalogState.cases.map((d) => (
        <option key={d.id} value={d.id}>
          {caseLabel(catalogState, d.id)}
        </option>
      ))}
    </select>
  );
}
