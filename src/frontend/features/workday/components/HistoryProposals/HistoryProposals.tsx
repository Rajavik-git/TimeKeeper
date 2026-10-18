import { useState, type FormEvent } from "react";
import { type CoreState, type State } from "../../../../api/client";
import { historyApi } from "../../../../api/history";
import { useHistoryProposals } from "./hooks/useHistoryProposals";
import { localDateTime } from "./lib/dates";
import { ProposalEditor } from "./HistoryProposalEditor/HistoryProposalEditor";
import "./HistoryProposals.css";

type Props = { workspaceState: CoreState; catalogState: State; refresh: () => Promise<void> };
export function HistoryProposals(props: Props) {
  const sessions = [...props.workspaceState.sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const initial = props.workspaceState.activeSession?.id ?? sessions[0]?.id ?? "";
  const [selected, setSelected] = useState(initial);
  const session = sessions.find((item) => item.id === selected) ?? sessions[0];
  return (
    <section className="card history-proposals" aria-labelledby="history-proposals-title">
      <div className="card-h">
        <div className="t">
          <h2 id="history-proposals-title">Work periods from history</h2>
          <p>
            Review proposed case assignments and descriptions from imported Screenpipe evidence.
          </p>
        </div>
      </div>
      <div className="history-proposals-body">
        <p>
          Observation windows are tentative. Confirm the worked duration before accepting each
          proposal. Acceptance creates a finished, unvalidated work period.
        </p>
        {!session ? (
          <p>No session is available. Start a session and import Screenpipe sources first.</p>
        ) : (
          <>
            <label>
              Session
              <select
                className="select"
                value={session.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {sessions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {new Date(item.startedAt).toLocaleString()}
                    {item.endedAt ? "" : " · Active"}
                  </option>
                ))}
              </select>
            </label>
            <SessionProposals key={session.id} {...props} session={session} />
          </>
        )}
      </div>
    </section>
  );
}
function SessionProposals({
  session,
  catalogState,
  workspaceState,
  refresh,
}: Props & { session: CoreState["sessions"][number] }) {
  const [bounds, setBounds] = useState(() => {
    const end = Math.min(Date.now(), session.endedAt ? Date.parse(session.endedAt) : Date.now());
    return {
      start: localDateTime(
        new Date(Math.max(Date.parse(session.startedAt), end - 600000)).toISOString(),
      ),
      end: localDateTime(new Date(end).toISOString()),
    };
  });
  const [formError, setFormError] = useState("");
  const { state, pending, notice, run, reload } = useHistoryProposals(session.id, refresh);
  const start = new Date(bounds.start).getTime();
  const end = new Date(bounds.end).getTime();
  const validRange =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end - start <= 3600000 &&
    start >= Date.parse(session.startedAt) &&
    end <= (session.endedAt ? Date.parse(session.endedAt) : Date.now());
  function generate(event: FormEvent) {
    event.preventDefault();
    if (!validRange) {
      setFormError(
        "Choose a range inside this session, longer than zero and no more than one hour.",
      );
      return;
    }
    setFormError("");
    void run(() =>
      historyApi.generate({
        sessionId: session.id,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
      }),
    );
  }
  const activeJob = state.data?.jobs.some((job) =>
    ["dispatching", "dispatched", "running", "dispatch-unconfirmed"].includes(job.status),
  );
  return (
    <>
      <form onSubmit={generate} className="history-generation-form">
        <label>
          From, local time
          <input
            className="input"
            type="datetime-local"
            step="0.001"
            value={bounds.start}
            required
            onChange={(event) => setBounds({ ...bounds, start: event.target.value })}
          />
        </label>
        <label>
          To, local time
          <input
            className="input"
            type="datetime-local"
            step="0.001"
            value={bounds.end}
            required
            onChange={(event) => setBounds({ ...bounds, end: event.target.value })}
          />
        </label>
        <button
          className="btn primary"
          disabled={pending || state.isLoading || !state.data?.configured || activeJob}
        >
          Generate work periods from history
        </button>
      </form>
      <p className="history-help">
        Start with ten minutes of already imported sources. You can extend the range up to one hour.
        Generating proposals sends the permitted evidence to the configured JEV workflow. It does
        not create worked time.
      </p>
      {formError && <p role="alert">{formError}</p>}
      {state.isLoading && !state.data && <p role="status">Loading history proposals…</p>}
      {state.error && (
        <p role="alert">
          Could not load proposals.{" "}
          <button className="btn" onClick={() => void reload()}>
            Retry loading proposals
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {state.data && (
        <>
          {!state.data.configured && (
            <p role="status">
              History generation is not configured. Configure the Screenpipe history workflow, then
              refresh proposals.
            </p>
          )}
          <button className="btn" disabled={pending} onClick={() => void reload()}>
            Refresh proposals
          </button>
          {state.data.jobs.map((job) => (
            <article key={job.id} className="history-job">
              <strong>{jobLabels[job.status] ?? job.status}</strong>
              <span>
                {new Date(job.startAt).toLocaleString()} to {new Date(job.endAt).toLocaleString()}
              </span>
              <span>
                {job.sourceCount} sources · {job.proposalCount} proposals
              </span>
              {job.status === "dispatch-unconfirmed" && (
                <p>
                  Delivery could not be confirmed. The workflow may still respond. No work period
                  has been created.
                </p>
              )}
              {job.error && (
                <p role="alert">
                  {jobFailureMessages[job.error] ??
                    "Generation did not complete. Check the Screenpipe workflow and retry when this request has finished or expired."}
                </p>
              )}
            </article>
          ))}
          {!state.data.proposals.length && (
            <p>No proposals yet. Import sources, choose a range, then generate proposals.</p>
          )}
          {state.data.proposals.map((proposal) => (
            <ProposalEditor
              key={proposal.id}
              proposal={proposal}
              catalogState={catalogState}
              sources={workspaceState.sources}
              pending={pending}
              run={run}
            />
          ))}
        </>
      )}
    </>
  );
}
const jobLabels: Record<string, string> = {
  dispatching: "Sending generation request",
  dispatched: "Request sent, waiting for workflow",
  "dispatch-unconfirmed": "Delivery unconfirmed",
  running: "Generating proposals",
  ready: "Proposals ready for review",
  failed: "Generation failed",
  expired: "Request expired",
};

const jobFailureMessages: Record<string, string> = {
  "dispatch-failed":
    "The history workflow could not start. Run the TimeKeeper MCP server, enable its connection in Screenpipe, and check that the manual history pipe is installed.",
  "not-configured":
    "JEV settings are missing. Configure JEV for the Screenpipe history workflow, then generate new proposals.",
  "history-too-large":
    "This range contains too much distinct activity. Select a shorter range and generate proposals again.",
};
