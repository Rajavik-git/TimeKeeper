import { cardHead } from "../../lib/sectionPresentation";
import { useScreenpipeIntegration } from "../../hooks/useScreenpipeIntegration";
import type { ScreenpipeStatus } from "../../hooks/useScreenpipeIntegration";
import "./ScreenpipeSection.css";

function timestamp(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

const connectionLabels: Record<ScreenpipeStatus["connection"]["status"], string> = {
  "not-tested": "Connection not tested",
  "not-configured": "Connection not configured",
  connected: "Authenticated access confirmed.",
  "authentication-failed":
    "Authentication failed. Check the backend Screenpipe API token and restart TimeKeeper.",
  unavailable: "Screenpipe is unavailable. Open Screenpipe and check the backend Screenpipe URL.",
  error: "The connection test failed. Check Screenpipe and retry the test.",
};

const runLabels: Record<NonNullable<ScreenpipeStatus["lastRun"]>["outcome"], string> = {
  succeeded: "Sync completed for this batch.",
  partial:
    "Sync partially completed. Some references could not be imported. Check Screenpipe, then sync again.",
  failed: "Sync failed. Check the connection before trying again.",
  "no-sessions":
    "No TimeKeeper sessions are available to import into. Start a session through Screenpipe, then sync again.",
  "not-configured": "Sync could not run. Configure the backend connection first.",
};

export function ScreenpipeSection({ active }: { active: boolean }) {
  const { status, pending, error, refreshWarning, run } = useScreenpipeIntegration(active);
  const busy = pending !== null || status?.syncing || status?.testing;
  const blocked = Boolean(busy || !status?.configured || error);
  const lastRun = status?.lastRun;
  return (
    <section className="card settings-card screenpipe-settings" aria-labelledby="screenpipe-title">
      {cardHead("Screenpipe", "Import recording references into existing TimeKeeper sessions.")}
      <div className="screenpipe-settings-body">
        <h3 id="screenpipe-title">Connection and synchronization</h3>
        <p className="screenpipe-note">
          Screenpipe owns recording. Sync uses Screenpipe search to import references, observed app
          and window names, and source excerpts of up to 1,000 characters within existing sessions.
          It links sources when one existing work period matches their recording time. No match or
          overlapping matches leave sources unlinked. Sync does not create work periods or assign
          cases. JEV case detection is configured separately.
        </p>
        <div role="status" aria-live="polite" aria-atomic="true">
          {pending === "status" && !status && <p>Loading Screenpipe status…</p>}
          {status && (
            <>
              <p>
                {status.automaticSync
                  ? `Automatic sync runs every ${Math.round(status.intervalSeconds / 60)} minutes while the backend is running.`
                  : status.configured
                    ? "Automatic sync is paused. Test the connection or use Sync now to retry."
                    : "Automatic sync is not active. Configure the backend connection and restart TimeKeeper."}
              </p>
              {!status.configured && (
                <p className="screenpipe-warning">
                  {status.configurationIssue === "invalid-url"
                    ? "The backend Screenpipe URL is invalid. Check SCREENPIPE_URL and restart TimeKeeper."
                    : "Set SCREENPIPE_API_KEY in the backend environment and restart TimeKeeper. Check SCREENPIPE_URL if Screenpipe uses a different address. Keep the token private."}
                </p>
              )}
              <p>{connectionLabels[status.connection.status]}</p>
              <p className="screenpipe-note">
                Last connection check: {timestamp(status.connection.checkedAt)}
              </p>
              {(status.syncing || pending === "sync") && <p>Sync in progress…</p>}
              {(status.testing || pending === "test") && <p>Testing authenticated access…</p>}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="screenpipe-warning">
            {error}
          </p>
        )}
        <div className="screenpipe-actions">
          <button className="btn" disabled={blocked} onClick={() => void run("test")}>
            {pending === "test" ? "Testing…" : "Test connection"}
          </button>
          <button className="btn primary" disabled={blocked} onClick={() => void run("sync")}>
            {pending === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <button className="btn" disabled={pending !== null} onClick={() => void run("status")}>
            {pending === "status" ? "Refreshing…" : error ? "Retry status" : "Refresh status"}
          </button>
        </div>
        <p className="screenpipe-note">
          Test connection checks authenticated access. It does not import data.
        </p>
        {status && (
          <div className="screenpipe-run" role="status" aria-live="polite">
            <h3>Latest import</h3>
            <p>
              {!lastRun
                ? "No sync attempt since the backend started."
                : lastRun.outcome === "succeeded" && lastRun.windows === 0
                  ? "No recording windows are currently eligible for import."
                  : runLabels[lastRun.outcome]}
            </p>
            {lastRun?.error === "authentication-failed" && (
              <p className="screenpipe-warning">
                Screenpipe rejected the API token. Correct it and restart TimeKeeper.
              </p>
            )}
            {lastRun?.error === "unavailable" && (
              <p className="screenpipe-warning">
                Screenpipe could not be reached. Check that it is running.
              </p>
            )}
            <dl className="screenpipe-facts">
              <div>
                <dt>Last successful batch</dt>
                <dd>{timestamp(status.lastSuccessfulSyncAt)}</dd>
              </div>
              {lastRun && (
                <>
                  <div>
                    <dt>Latest attempt finished</dt>
                    <dd>{timestamp(lastRun.finishedAt)}</dd>
                  </div>
                  <div>
                    <dt>Windows checked</dt>
                    <dd>{lastRun.windows}</dd>
                  </div>
                  <div>
                    <dt>References imported</dt>
                    <dd>{lastRun.imported}</dd>
                  </div>
                  <div>
                    <dt>References updated</dt>
                    <dd>{lastRun.updated ?? 0}</dd>
                  </div>
                  <div>
                    <dt>References unchanged</dt>
                    <dd>{lastRun.unchanged}</dd>
                  </div>
                  <div>
                    <dt>References skipped or preserved</dt>
                    <dd>{lastRun.preserved}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="screenpipe-note">
              Status covers this backend run. A successful batch does not prove that all recording
              history has been imported.
            </p>
          </div>
        )}
        {refreshWarning && (
          <p role="alert" className="screenpipe-warning">
            {refreshWarning}
          </p>
        )}
      </div>
    </section>
  );
}
