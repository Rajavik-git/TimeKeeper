import { useState } from "react";
import { calendarDay, calendarTime } from "../../../shared/dates";
import { api, caseLabel, type CoreState, type ScreenProps } from "../../api/client";
import { effectiveMs, formatPreciseDuration } from "../../calculations/billing";
import { coverageProblems } from "../../calculations/coverage";
import { Modal } from "../../shared/components/Modal";
import { shortDate } from "../../shared/format";
import "./PeriodReviewDialog.css";

type Period = CoreState["periods"][number];
type Props = Pick<
  ScreenProps,
  "catalogState" | "workspaceState" | "action" | "openPeriodActivity"
> & {
  period: Period;
  close: () => void;
};

/** One reviewed snapshot supplies every precondition. Polling cannot silently approve new data. */
export function PeriodReviewDialog({
  period,
  catalogState,
  workspaceState,
  action,
  openPeriodActivity,
  close,
}: Props) {
  const [reviewed, setReviewed] = useState(period);
  const [caseId, setCaseId] = useState(period.caseId ?? "");
  const [minutes, setMinutes] = useState(
    effectiveMs(period) === null ? "" : String(effectiveMs(period)! / 60000),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const changed = period.revision > reviewed.revision;
  const invoice = workspaceState.billing.invoices.find((item) => item.id === reviewed.invoiceId);
  const invoiceLocked = reviewed.invoiceId != null;
  const billed = reviewed.billingStatus === "billed";
  const editsDisabled = busy || changed || billed || invoiceLocked;
  const assignmentDisabled = editsDisabled || reviewed.endedAt === null;
  const sources = workspaceState.sources.filter((source) => source.workPeriodId === period.id);
  const blockers = coverageProblems(reviewed, sources);
  const conflicts =
    workspaceState.reconstructionConflicts?.filter(
      (item) => item.periodId === reviewed.id && item.status === "pending",
    ) ?? [];
  const runWrite = async (
    request: Promise<{ data?: Period; error?: unknown }>,
    success: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await action(request);
      if (updated) {
        setReviewed(updated);
        setNotice(success);
        return updated;
      } else
        setError(
          "The change was not saved. Your entries are preserved. Review any conflict message before trying again.",
        );
    } catch {
      setError("Could not save. Your entries are preserved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    setReviewed(period);
    setCaseId(period.caseId ?? "");
    setMinutes(effectiveMs(period) === null ? "" : String(effectiveMs(period)! / 60000));
    setError("");
    setNotice("Latest period loaded. Review it before saving.");
  };
  return (
    <Modal
      label="Review work period"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="modal period-review">
        <div className="row between">
          <h2>Review work period</h2>
          <button
            className="btn sm"
            disabled={busy}
            onClick={close}
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
        {changed && (
          <div role="alert" className="period-review-warning">
            This period changed while you were reviewing it. Your entries are preserved.{" "}
            <button className="btn sm" disabled={busy} onClick={reload}>
              Reload latest period
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
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
                  · {conflict.sourceReferences.length} source references
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
                    origin: "lawyer",
                  },
                }),
                "Case assignment saved. Review time validation again if the effective case changed.",
              );
            }}
          >
            <label htmlFor="period-review-case-select">Assigned case</label>
            <select
              id="period-review-case-select"
              className="field"
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
            Detected: {formatPreciseDuration(reviewed.detectedDurationMs)} · Effective:{" "}
            {formatPreciseDuration(effectiveMs(reviewed))}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = minutes.trim() ? Number(minutes) : NaN;
              const durationMs = Math.round(value * 60000);
              if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
                setError("Enter a non-negative duration in minutes.");
                return;
              }
              if (editsDisabled) return;
              void runWrite(
                api.POST("/api/work-periods/{id}/duration-override", {
                  params: { path: { id: reviewed.id } },
                  body: { durationMs, expectedRevision: reviewed.revision },
                }),
                "Corrected duration saved. Review time validation again if the effective duration changed.",
              );
            }}
          >
            <label htmlFor="period-review-minutes">Corrected minutes</label>
            <input
              id="period-review-minutes"
              className="field"
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
                  api.POST("/api/work-periods/{id}/duration-override", {
                    params: { path: { id: reviewed.id } },
                    body: { durationMs: null, expectedRevision: reviewed.revision },
                  }),
                  "Duration correction removed.",
                );
                if (updated)
                  setMinutes(
                    effectiveMs(updated) === null ? "" : String(effectiveMs(updated)! / 60000),
                  );
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
            {sources.filter((source) => source.validationStatus === "validated").length}{" "}
            source-validated. Source validation is separate from time validation.
          </p>
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => {
              close();
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
          {!reviewed.caseId && <p>Assign a case before validating time.</p>}
          {effectiveMs(reviewed) === null && (
            <p>Correct the unknown duration before validating time.</p>
          )}
          <button
            className="btn sm attn"
            disabled={
              busy ||
              changed ||
              reviewed.timeValidated ||
              !reviewed.caseId ||
              effectiveMs(reviewed) === null ||
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
            {invoiceLocked ? "In issued invoice" : billed ? "Billed" : "Unbilled"}. This status is
            independent of invoice generation.
          </p>
          <button
            className="btn sm"
            disabled={
              busy ||
              changed ||
              invoiceLocked ||
              (!billed && (!reviewed.caseId || !reviewed.timeValidated))
            }
            onClick={() =>
              void runWrite(
                api.POST("/api/work-periods/{id}/billing-status", {
                  params: { path: { id: reviewed.id } },
                  body: {
                    status: billed ? "unbilled" : "billed",
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
