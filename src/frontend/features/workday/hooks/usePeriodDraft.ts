import { useState } from "react";
import { durationMinutes, type EditablePeriod } from "../lib/periodEditing";

/** Drafts stay tied to the displayed snapshot, including after failed writes. */
export function usePeriodDraft(period: EditablePeriod) {
  const [reviewed, setReviewed] = useState(period);
  const [caseId, setCaseId] = useState(period.caseId ?? "");
  const [minutes, setMinutes] = useState(durationMinutes(period));
  const caseDirty = caseId !== (reviewed.caseId ?? "");
  const durationDirty = minutes !== durationMinutes(reviewed);
  const discard = (latest = reviewed) => {
    setReviewed(latest);
    setCaseId(latest.caseId ?? "");
    setMinutes(durationMinutes(latest));
  };
  return {
    reviewed,
    setReviewed,
    caseId,
    setCaseId,
    minutes,
    setMinutes,
    caseDirty,
    durationDirty,
    dirty: caseDirty || durationDirty,
    discard,
  };
}
