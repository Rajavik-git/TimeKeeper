import type { Clock } from "../ports/index.js";
import {
  screenpipeFailure,
  type ScreenpipeIntegration,
  type ScreenpipeIntegrationOperations,
  type ScreenpipeIntegrationStatus,
  type ScreenpipeSyncError,
} from "../ports/screenpipe-integration.js";

const INTERVAL_SECONDS = 300;
const connectionMessages = {
  connected: "Authenticated access succeeded.",
  "authentication-failed": "Screenpipe refused the configured API key.",
  unavailable: "Screenpipe is unavailable. Check that it is running.",
  error: "The connection check failed.",
  "not-configured": "Configure a local Screenpipe API URL and API key before connecting.",
} as const;

/** One in-memory owner serializes automatic and manual evidence retrieval. */
export class ScreenpipeIntegrationCoordinator implements ScreenpipeIntegration {
  private readonly value: ScreenpipeIntegrationStatus;
  private readonly abort = new AbortController();
  private activeSync?: Promise<ScreenpipeIntegrationStatus>;
  private activeTest?: Promise<ScreenpipeIntegrationStatus>;
  private timer?: ReturnType<typeof setInterval>;
  private started = false;
  private stopped = false;
  private authenticationPaused = false;
  constructor(
    issue: ScreenpipeIntegrationStatus["configurationIssue"],
    private readonly operations?: ScreenpipeIntegrationOperations,
    private readonly clock: Clock = { now: () => new Date().toISOString() },
  ) {
    const configured = issue === null && operations !== undefined;
    this.value = {
      configured,
      configurationIssue: issue,
      automaticSync: false,
      intervalSeconds: INTERVAL_SECONDS,
      syncing: false,
      testing: false,
      connection: {
        status: configured ? "not-tested" : "not-configured",
        checkedAt: null,
        message: configured ? null : connectionMessages["not-configured"],
      },
      lastRun: null,
      lastSuccessfulSyncAt: null,
    };
  }
  status(): ScreenpipeIntegrationStatus {
    return structuredClone(this.value);
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.updateAutomaticSync();
    if (!this.value.configured) return;
    this.timer = setInterval(() => {
      if (this.value.automaticSync) void this.sync();
    }, INTERVAL_SECONDS * 1000);
    this.timer.unref();
    void this.sync();
  }
  private updateAutomaticSync(): void {
    this.value.automaticSync =
      this.started && !this.stopped && this.value.configured && !this.authenticationPaused;
  }
  private connected(): void {
    this.authenticationPaused = false;
    this.value.connection = {
      status: "connected",
      checkedAt: this.clock.now(),
      message: connectionMessages.connected,
    };
    this.updateAutomaticSync();
  }
  private failed(error: ScreenpipeSyncError): void {
    if (error === "authentication-failed") this.authenticationPaused = true;
    const status = error === "authentication-failed" || error === "unavailable" ? error : "error";
    this.value.connection = {
      status,
      checkedAt: this.clock.now(),
      message: connectionMessages[status],
    };
    this.updateAutomaticSync();
  }
  test(): Promise<ScreenpipeIntegrationStatus> {
    if (this.activeTest) return this.activeTest;
    if (this.stopped) return Promise.resolve(this.status());
    this.activeTest = this.runTest().finally(() => {
      this.activeTest = undefined;
    });
    return this.activeTest;
  }
  private async runTest(): Promise<ScreenpipeIntegrationStatus> {
    if (!this.value.configured || !this.operations) {
      this.value.connection.checkedAt = this.clock.now();
      return this.status();
    }
    this.value.testing = true;
    try {
      await this.operations.verifyAccess(this.abort.signal);
      if (!this.stopped) this.connected();
    } catch (error) {
      if (!this.stopped) this.failed(screenpipeFailure(error));
    } finally {
      this.value.testing = false;
    }
    return this.status();
  }
  sync(): Promise<ScreenpipeIntegrationStatus> {
    if (this.activeSync) return this.activeSync;
    if (this.stopped) return Promise.resolve(this.status());
    this.activeSync = this.runSync().finally(() => {
      this.activeSync = undefined;
    });
    return this.activeSync;
  }
  private async runSync(): Promise<ScreenpipeIntegrationStatus> {
    const startedAt = this.clock.now();
    const counts = { windows: 0, imported: 0, updated: 0, unchanged: 0, preserved: 0 };
    this.value.syncing = true;
    let outcome: NonNullable<ScreenpipeIntegrationStatus["lastRun"]>["outcome"] = "failed";
    let error: ScreenpipeSyncError | null = null;
    try {
      if (!this.value.configured || !this.operations) {
        outcome = "not-configured";
        error = "not-configured";
      } else if (!this.operations.hasSessions()) outcome = "no-sessions";
      else {
        const result = await this.operations.run(startedAt, this.abort.signal);
        Object.assign(counts, {
          windows: result.windows,
          imported: result.imported,
          updated: result.updated ?? 0,
          unchanged: result.unchanged,
          preserved: result.preserved,
        });
        error = result.error;
        outcome =
          error === null
            ? "succeeded"
            : counts.windows ||
                counts.imported ||
                counts.updated ||
                counts.unchanged ||
                counts.preserved
              ? "partial"
              : "failed";
        if (!this.stopped) {
          if (error) this.failed(error);
          else if (counts.windows > 0) this.connected();
        }
      }
    } catch (failure) {
      error = screenpipeFailure(failure);
      if (!this.stopped) this.failed(error);
    } finally {
      this.value.syncing = false;
    }
    if (!this.stopped) {
      const finishedAt = this.clock.now();
      this.value.lastRun = { outcome, startedAt, finishedAt, ...counts, error };
      if (outcome === "succeeded" && counts.windows > 0)
        this.value.lastSuccessfulSyncAt = finishedAt;
    }
    return this.status();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.updateAutomaticSync();
    this.abort.abort();
    await Promise.allSettled([this.activeSync, this.activeTest]);
  }
}
