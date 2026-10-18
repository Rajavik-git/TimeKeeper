import type { CheckResult } from "./check.js";
import { decideTransition } from "./decide.js";
import { transitionInput, type TransitionContext } from "./transition-input.js";

export type PreparedTransition = ReturnType<typeof transitionInput>;
export interface WatchCheckDeps {
  now(): number;
  context(): Promise<TransitionContext | null>;
  check(): Promise<CheckResult>;
  deliver(input: PreparedTransition): Promise<{ status: string }>;
  report(result: CheckResult): void;
}

/** One pending focus change. Delivery retries keep the exact pre-inference guards and payload. */
export class WatchCheck {
  private generation = 0;
  private pending = false;
  private nextAttemptAt = Infinity;
  private lastFocusAt = -Infinity;
  private failures = 0;
  private prepared: PreparedTransition | null = null;

  constructor(
    private readonly deps: WatchCheckDeps,
    private readonly stabilityMs: number,
    private readonly minConfidence: number,
    private readonly apply: boolean,
  ) {}

  observe(timestampMs: number) {
    if (timestampMs < this.lastFocusAt) return;
    this.lastFocusAt = timestampMs;
    this.generation++;
    this.pending = true;
    this.prepared = null;
    this.failures = 0;
    this.nextAttemptAt = timestampMs + this.stabilityMs;
  }

  private retry(waitMs = 0) {
    // No tight polling of hosted inference or unavailable dependencies. Keep work pending.
    const backoffMs = Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5));
    this.nextAttemptAt = this.deps.now() + Math.max(waitMs, backoffMs);
  }

  async tick(): Promise<void> {
    if (!this.pending || this.deps.now() < this.nextAttemptAt) return;
    const generation = this.generation;
    try {
      if (!this.prepared) {
        const context = this.apply ? await this.deps.context() : null;
        if (generation !== this.generation) return;
        if (this.apply && !context) return this.retry();
        if (this.apply && !context?.sessionId) {
          this.pending = false;
          return;
        }
        const result = await this.deps.check();
        if (generation !== this.generation) return;
        this.deps.report(result);
        if (
          result.status === "not_stable" ||
          result.status === "insufficient_data" ||
          (result.status === "error" && result.retryable !== false)
        )
          return this.retry(result.wait_ms);
        const decision = decideTransition(result, context?.period ?? null, this.minConfidence);
        if (!this.apply || decision.action === "none") {
          this.pending = false;
          return;
        }
        this.prepared = transitionInput(context!, decision.transitionAt, decision.caseId);
      }
      const response = await this.deps.deliver(this.prepared);
      if (generation !== this.generation) return;
      if (["applied", "no_change", "stale", "pending", "error"].includes(response.status)) {
        // Pending is a committed reconstruction proposal, not a delivery failure.
        // Explicit errors/conflicts are terminal; guards must never be refreshed to force a write.
        this.pending = false;
        this.prepared = null;
        return;
      }
      this.retry(); // Unconfirmed / unavailable / malformed response: same command next time.
    } catch {
      if (generation === this.generation) this.retry();
    }
  }
}
