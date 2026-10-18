import { useState, type FormEvent } from "react";
import type { HistoryProposal } from "../../../../../../contracts/history";
import { caseLabel, type CoreState, type State } from "../../../../../api/client";
import { historyApi } from "../../../../../api/history";
import { localDateTime } from "../lib/dates";
type EditorProps = {
  proposal: HistoryProposal;
  catalogState: State;
  sources: CoreState["sources"];
  pending: boolean;
  run: (operation: () => Promise<unknown>, changesWorkspace?: boolean) => Promise<void>;
};
export function ProposalEditor({ proposal, catalogState, sources, pending, run }: EditorProps) {
  // Keep edited fields and the revision they were based on through polling and conflicts.
  const [draft, setDraft] = useState(() => ({
    revision: proposal.revision,
    caseId: proposal.caseId ?? "",
    start: localDateTime(proposal.startedAt),
    end: localDateTime(proposal.endedAt),
    label: proposal.label,
    minutes: "",
  }));
  const [error, setError] = useState("");
  const change = (field: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const availableCases = catalogState.cases.filter((item) => item.status === "active");
  const selectedUnavailable = Boolean(
    draft.caseId && !availableCases.some((item) => item.id === draft.caseId),
  );
  function accept(event: FormEvent) {
    event.preventDefault();
    const startedAt = new Date(draft.start).getTime();
    const endedAt = new Date(draft.end).getTime();
    const durationMs = Math.round(Number(draft.minutes) * 60000);
    if (
      !draft.minutes.trim() ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt <= startedAt ||
      !draft.label.trim() ||
      selectedUnavailable
    ) {
      setError("Check the case, description, observation window, and a positive worked duration.");
      return;
    }
    setError("");
    void run(
      () =>
        historyApi.accept(proposal.id, {
          expectedRevision: draft.revision,
          caseId: draft.caseId || null,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          label: draft.label.trim(),
          durationMs,
        }),
      true,
    );
  }
  return (
    <article className="history-proposal" aria-label={`History proposal ${proposal.id}`}>
      <div className="history-proposal-heading">
        <h3>
          {proposal.status === "draft"
            ? "Proposed work period"
            : proposal.status === "accepted"
              ? "Accepted work period"
              : "Rejected proposal"}
        </h3>
        {proposal.confidence !== null && (
          <span>Model confidence: {Math.round(proposal.confidence * 100)}%</span>
        )}
      </div>
      {proposal.hasGaps && (
        <p className="history-warning">
          Evidence has gaps. Review the sources and confirm the worked duration.
        </p>
      )}
      {proposal.status !== "draft" ? (
        <p>
          {proposal.label} · {caseLabel(catalogState, proposal.caseId)}
        </p>
      ) : (
        <form onSubmit={accept}>
          {proposal.revision !== draft.revision && (
            <p role="alert">
              This proposal changed. Your draft is kept. Review the latest sources before retrying.{" "}
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() =>
                  setDraft({
                    revision: proposal.revision,
                    caseId: proposal.caseId ?? "",
                    start: localDateTime(proposal.startedAt),
                    end: localDateTime(proposal.endedAt),
                    label: proposal.label,
                    minutes: "",
                  })
                }
              >
                Use latest proposal
              </button>
            </p>
          )}
          <div className="history-proposal-fields">
            <label>
              Case
              <select
                className="select"
                value={draft.caseId}
                onChange={(event) => change("caseId", event.target.value)}
              >
                <option value="">Unresolved case</option>
                {selectedUnavailable && (
                  <option value={draft.caseId}>Case unavailable. Choose an active case.</option>
                )}
                {availableCases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {caseLabel(catalogState, item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea
                className="input"
                value={draft.label}
                maxLength={1000}
                required
                onChange={(event) => change("label", event.target.value)}
              />
            </label>
            <label>
              Observation start, local time
              <input
                className="input"
                type="datetime-local"
                step="0.001"
                required
                value={draft.start}
                onChange={(event) => change("start", event.target.value)}
              />
            </label>
            <label>
              Observation end, local time
              <input
                className="input"
                type="datetime-local"
                step="0.001"
                required
                value={draft.end}
                onChange={(event) => change("end", event.target.value)}
              />
            </label>
            <label>
              Confirmed worked duration, minutes
              <input
                className="input"
                type="number"
                min="0.001"
                step="any"
                required
                placeholder="Enter worked minutes"
                value={draft.minutes}
                onChange={(event) => change("minutes", event.target.value)}
              />
            </label>
          </div>
          <p className="history-help">
            The observation window is tentative. Elapsed time is not used as worked duration.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="history-proposal-actions">
            <button
              className="btn primary"
              disabled={pending || selectedUnavailable || proposal.revision !== draft.revision}
            >
              Accept work period
            </button>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => void run(() => historyApi.reject(proposal))}
            >
              Reject proposal
            </button>
          </div>
        </form>
      )}
      <details>
        <summary>Supporting sources ({proposal.sourceIds.length})</summary>
        <ul>
          {proposal.sourceIds.map((id) => {
            const source = sources.find((item) => item.id === id);
            return (
              <li key={id}>
                {source ? (
                  <>
                    <time dateTime={source.recordedAt}>
                      {new Date(source.recordedAt).toLocaleString()}
                    </time>
                    <span>
                      {source.appName} {source.windowName}
                    </span>
                    <p>{source.excerpt || "No stored excerpt."}</p>
                  </>
                ) : (
                  <span>Source {id} is not available in this view.</span>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </article>
  );
}
