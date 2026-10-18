import { BillingStatus, ReconstructionStatus } from "../../../../contracts/states.generated";
import { useEffect, useState } from "react";
import { type CoreState, type ScreenProps } from "../../../api/client";
import { coverageProblems } from "../../../calculations/coverage";
import { usePeriodDraft } from "./usePeriodDraft";

type Period = CoreState["periods"][number];

type Props = Pick<ScreenProps, "workspaceState" | "action"> & {
  period: CoreState["periods"][number];
  close: () => void;
  onDraftChange?: (dirty: boolean) => void;
};

/** Owns the reviewed snapshot and write lifecycle independently from dialog rendering. */
export function usePeriodReview({ period, workspaceState, action, close, onDraftChange }: Props) {
  const {
    reviewed,
    setReviewed,
    caseId,
    setCaseId,
    minutes,
    setMinutes,
    dirty: draftChanged,
    discard,
  } = usePeriodDraft(period);
  const [correctionFailed, setCorrectionFailed] = useState(false);
  const dirty = draftChanged || correctionFailed;
  useEffect(() => {
    onDraftChange?.(dirty);
  }, [dirty, onDraftChange]);
  const [leaveAction, setLeaveAction] = useState<"close" | "reload" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const changed = period.revision > reviewed.revision;
  const invoice = workspaceState.billing.invoices.find((item) => item.id === reviewed.invoiceId);
  const invoiceLocked = reviewed.invoiceId != null;
  const billed = reviewed.billingStatus === BillingStatus.Billed;
  const editsDisabled = busy || changed || billed || invoiceLocked;
  const assignmentDisabled = editsDisabled || reviewed.endedAt === null;
  const sources = workspaceState.sources.filter((source) => source.workPeriodId === period.id);
  const blockers = coverageProblems(reviewed, sources);
  const conflicts =
    workspaceState.reconstructionConflicts?.filter(
      (item) => item.periodId === reviewed.id && item.status === ReconstructionStatus.Pending,
    ) ?? [];
  const runWrite = async (
    request: Promise<{ data?: Period; error?: unknown }>,
    success: string,
    correction = false,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await action(request, setError);
      if (updated) {
        setReviewed(updated);
        if (correction) setCorrectionFailed(false);
        setNotice(success);
        return updated;
      } else {
        if (correction) setCorrectionFailed(true);
        setError(
          (current) =>
            current || "The change was not saved. Your entries are preserved. Try again.",
        );
      }
    } catch {
      if (correction) setCorrectionFailed(true);
      setError("Could not save. Your entries are preserved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    discard(period);
    setCorrectionFailed(false);
    setError("");
    setNotice("Latest period loaded. Review it before saving.");
    setLeaveAction(null);
  };
  const requestLeave = (kind: "close" | "reload") => {
    if (busy) return;
    if (dirty) setLeaveAction(kind);
    else if (kind === "reload") reload();
    else close();
  };
  return {
    reviewed,
    caseId,
    setCaseId,
    minutes,
    setMinutes,
    discard,
    setCorrectionFailed,
    dirty,
    leaveAction,
    setLeaveAction,
    busy,
    notice,
    error,
    setError,
    changed,
    invoice,
    invoiceLocked,
    billed,
    editsDisabled,
    assignmentDisabled,
    sources,
    blockers,
    conflicts,
    runWrite,
    reload,
    requestLeave,
  };
}
