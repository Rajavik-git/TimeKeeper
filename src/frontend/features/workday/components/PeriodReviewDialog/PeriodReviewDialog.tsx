import { timeValidationUnavailable } from "../../../../shared/lib/timeValidation";
import { useToday } from "../../../../shared/hooks/useToday";
import { billingStatusLabels } from "../../../../shared/presentation/work-period";
import {
  AssignmentOrigin,
  BillingStatus,
  ValidationStatus,
} from "../../../../../contracts/states.generated";
import { usePeriodReview } from "../../hooks/usePeriodReview";
import { calendarDay, calendarTime } from "../../../../../shared/dates";
import { api, caseLabel, type CoreState, type ScreenProps } from "../../../../api/client";
import { effectiveMs, formatNearestMinuteDuration } from "../../../../calculations/billing";
import { Modal } from "../../../../shared/components/Modal/Modal";
import { shortDate } from "../../../../shared/format";
import { durationMinutes, savePeriodDuration } from "../../lib/periodEditing";

type Period = CoreState["periods"][number];
type Props = Pick<
  ScreenProps,
  "catalogState" | "workspaceState" | "action" | "openPeriodActivity"
> & {
  period: Period;
  close: () => void;
  hidden?: boolean;
  refresh?: ScreenProps["refresh"];
  onDraftChange?: (dirty: boolean) => void;
};

/** One reviewed snapshot supplies every precondition. Polling cannot silently approve new data. */
export function PeriodReviewDialog({
  period,
  catalogState,
  workspaceState,
  action,
  openPeriodActivity,
  close,
  hidden = false,
  refresh,
  onDraftChange,
}: Props) {
  const today = useToday();
  const {
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
  } = usePeriodReview({ period, workspaceState, action, close, onDraftChange });
  const validationUnavailable = timeValidationUnavailable(reviewed, today);
  if (hidden) return null;
  return (
    <Modal label="Review work period" close={() => requestLeave("close")}>
      <div className="modal period-review">
        <div className="row between">
          <h2>Review work period</h2>
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => requestLeave("close")}
            aria-label="Close period review"
          >
            Close
          </button>
        </div>
        <p>
          <b>{reviewed.label}</b>
          <br />
          {shortDate(calendarDay(reviewed.startedAt))} · {calendarTime(reviewed.startedAt)}–
          {reviewed.endedAt ? calendarTime(reviewed.endedAt) : "Open period"}
        </p>
        {leaveAction && (
          <section className="period-review-warning" aria-label="Unsaved corrections">
            <p>
              Your corrections have not been saved. Keep editing or discard them before{" "}
              {leaveAction === "close" ? "closing" : "loading the latest period"}.
            </p>
            <button className="btn sm" onClick={() => setLeaveAction(null)}>
              Keep editing
            </button>{" "}
            <button
              className="btn sm"
              onClick={() => {
                if (leaveAction === "reload") reload();
                else {
                  discard();
                  setCorrectionFailed(false);
                  close();
                }
              }}
            >
              Discard corrections
            </button>
          </section>
        )}
        {dirty && (
          <p role="status">
            Save or discard corrections before validating time or changing billing status.{" "}
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => {
                discard();
                setCorrectionFailed(false);
                setError("");
              }}
            >
              Discard draft corrections
            </button>
          </p>
        )}
        {changed && (
          <div role="alert" className="period-review-warning">
            This period changed while you were reviewing it. Your entries are preserved.{" "}
            <button className="btn sm" disabled={busy} onClick={() => requestLeave("reload")}>
              Reload latest period
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {workspaceState.reconstructionUnavailable && (
          <p role="alert">
            Reconstruction proposals could not be loaded. Pending proposals are unknown.
            {refresh && (
              <button className="btn sm" onClick={() => void refresh().catch(() => undefined)}>
                Retry proposals
              </button>
            )}
          </p>
        )}
        {conflicts.length > 0 && (
          <section aria-label="Pending reconstruction proposals" className="period-review-warning">
            <h3>Late evidence proposes different boundaries</h3>
            <p>
              The existing period and its corrections are preserved. These proposals add no time to
              totals. Applying or rejecting proposals is not available yet.
            </p>
            <ul>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  {shortDate(calendarDay(conflict.proposedStartedAt))}{" "}
                  {calendarTime(conflict.proposedStartedAt)}–
                  {conflict.proposedEndedAt
                    ? `${shortDate(calendarDay(conflict.proposedEndedAt))} ${calendarTime(conflict.proposedEndedAt)}`
                    : "open boundary"}{" "}
                  · {conflict.sourceReferences.length} source reference
                  {conflict.sourceReferences.length === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </section>
        )}
        {invoiceLocked ? (
          <p className="period-review-warning">
            Included in issued invoice {invoice?.number ?? `#${reviewed.invoiceId}`}. Changes and
            unbilling are unavailable. Invoice reversal is not supported.
          </p>
        ) : billed ? (
          <p className="period-review-warning">
            Billed independently of an invoice. Mark this period unbilled before changing its case
            or duration.
          </p>
        ) : null}
        <section aria-labelledby="period-review-case">
          <h3 id="period-review-case">Case assignment</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!caseId || assignmentDisabled) return;
              void runWrite(
                api.POST("/api/work-periods/{id}/assignment", {
                  params: { path: { id: reviewed.id } },
                  body: {
                    caseId,
                    expectedAssignmentRevision: reviewed.assignmentRevision,
                    origin: AssignmentOrigin.Lawyer,
                  },
                }),
                "Case assignment saved. Review time validation again if the effective case changed.",
                true,
              );
            }}
          >
            <label htmlFor="period-review-case-select">Assigned case</label>
            <select
              id="period-review-case-select"
              className="select sm"
              value={caseId}
              disabled={assignmentDisabled}
              onChange={(event) => setCaseId(event.target.value)}
            >
              <option value="">Choose a case…</option>
              {catalogState.cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {caseLabel(catalogState, item.id)}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              disabled={assignmentDisabled || !caseId || caseId === reviewed.caseId}
            >
              Save case
            </button>
          </form>
          <p className="muted">
            {reviewed.endedAt === null
              ? "Current period assignment is managed by Screenpipe. Case corrections here are available after the period ends."
              : "This changes only this historical period. The active session's case stays unchanged."}
          </p>
        </section>
        <section aria-labelledby="period-review-duration">
          <h3 id="period-review-duration">Duration</h3>
          <p>
            Detected: {formatNearestMinuteDuration(reviewed.detectedDurationMs)} · Effective:{" "}
            {formatNearestMinuteDuration(effectiveMs(reviewed))}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editsDisabled) return;
              try {
                void runWrite(
                  savePeriodDuration(reviewed.id, reviewed.revision, minutes),
                  "Corrected duration saved. Review time validation again if the effective duration changed.",
                  true,
                ).then((updated) => {
                  if (updated) setMinutes(durationMinutes(updated));
                });
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            <label htmlFor="period-review-minutes">Corrected minutes</label>
            <input
              id="period-review-minutes"
              className="field sm"
              type="number"
              min="0"
              step="any"
              value={minutes}
              disabled={editsDisabled}
              onChange={(event) => setMinutes(event.target.value)}
            />
            <button className="btn sm" disabled={editsDisabled}>
              Save duration
            </button>
          </form>
          {reviewed.durationOverrideMs !== null && (
            <button
              className="btn sm"
              disabled={editsDisabled}
              onClick={async () => {
                const updated = await runWrite(
                  savePeriodDuration(reviewed.id, reviewed.revision, null),
                  "Duration correction removed.",
                  true,
                );
                if (updated) setMinutes(durationMinutes(updated));
              }}
            >
              Use detected duration
            </button>
          )}
        </section>
        <section aria-labelledby="period-review-evidence">
          <h3 id="period-review-evidence">Evidence and coverage</h3>
          {blockers.length ? (
            <ul>
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>No known coverage blocker.</p>
          )}
          <p>
            {sources.length} linked source{sources.length === 1 ? "" : "s"} ·{" "}
            {
              sources.filter((source) => source.validationStatus === ValidationStatus.Validated)
                .length
            }{" "}
            source-validated. Source validation is separate from time validation.
          </p>
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => {
              openPeriodActivity(reviewed.id);
            }}
          >
            Review sources
          </button>
        </section>
        <section aria-labelledby="period-review-validation">
          <h3 id="period-review-validation">Time validation</h3>
          <p>
            {reviewed.timeValidated
              ? "Validated for this effective case and duration."
              : "Not validated for this effective case and duration."}
          </p>
          {validationUnavailable && <p>{validationUnavailable}</p>}
          <button
            className="btn sm attn"
            disabled={
              busy ||
              dirty ||
              changed ||
              reviewed.timeValidated ||
              validationUnavailable !== null ||
              invoiceLocked
            }
            onClick={() =>
              void runWrite(
                api.POST("/api/work-periods/{id}/validate-time", {
                  params: { path: { id: reviewed.id } },
                  body: { expectedEffectiveRevision: reviewed.effectiveRevision },
                }),
                "Time validated for the reviewed case and duration.",
              )
            }
          >
            Validate time
          </button>
        </section>
        <section aria-labelledby="period-review-billing">
          <h3 id="period-review-billing">Billing status</h3>
          <p>
            {invoiceLocked ? "In issued invoice" : billingStatusLabels[reviewed.billingStatus]}.
            This status is independent of invoice generation.
          </p>
          <button
            className="btn sm"
            disabled={
              busy ||
              dirty ||
              changed ||
              invoiceLocked ||
              (!billed && (!reviewed.caseId || !reviewed.timeValidated))
            }
            onClick={() =>
              void runWrite(
                api.POST("/api/work-periods/{id}/billing-status", {
                  params: { path: { id: reviewed.id } },
                  body: {
                    status: billed ? BillingStatus.Unbilled : BillingStatus.Billed,
                    expectedRevision: reviewed.revision,
                  },
                }),
                billed
                  ? "Period marked unbilled."
                  : "Period marked billed independently of an invoice.",
              )
            }
          >
            {billed ? "Mark unbilled" : "Mark billed"}
          </button>
        </section>
      </div>
    </Modal>
  );
}
