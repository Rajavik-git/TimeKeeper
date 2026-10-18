import { createHash, randomUUID } from "node:crypto";
import type {
  HistoryAcceptInput,
  HistoryAcceptResult,
  HistoryClaim,
  HistoryFailure,
  HistoryGenerateInput,
  HistoryJob,
  HistoryProposal,
  HistoryProposalInput,
  HistoryState,
} from "../../contracts/history.js";
import type {
  HistoryRunner,
  HistorySnapshot,
  HistoryStorage,
  StoredHistoryJob,
} from "../ports/history.js";
import type { Repository, PeriodRecord } from "../ports/repository.js";
import type { Clock } from "../ports/index.js";
import type { CatalogService } from "./catalog.js";
import { EvidenceService } from "./evidence.js";
import { periodView } from "./period-view.js";
import { AssignmentOrigin, BillingStatus, QuestionStatus } from "../domain/states.js";
import { AppError } from "./errors.js";
import { assertTime } from "./assertions.js";

const pending = new Set(["dispatching", "dispatched", "dispatch-unconfirmed", "running"]);
const failures: HistoryFailure[] = [
  "not-configured",
  "history-too-large",
  "dispatch-failed",
  "workflow-failed",
  "inference-failed",
  "stale-snapshot",
  "expired",
];
const time = (value: string) => Date.parse(value);
const overlaps = (a: string, b: string, c: string, d: string | null) =>
  time(a) < (d === null ? Infinity : time(d)) && time(c) < time(b);
const conflict = (message: string): never => {
  throw new AppError("conflict", message);
};

/** History produces review drafts. Only explicit acceptance writes finished work periods. */
export class HistoryService {
  constructor(
    private readonly storage: HistoryStorage,
    private readonly repo: Repository,
    private readonly catalog: CatalogService,
    private readonly clock: Clock,
    private readonly runner: HistoryRunner = {
      configured: false,
      dispatch: async () => "unconfirmed",
    },
  ) {
    this.expire();
  }

  private expire(): void {
    this.storage.transaction(() => {
      const now = this.clock.now();
      for (const stored of this.storage.jobs()) {
        if (!pending.has(stored.job.status)) continue;
        const running = stored.job.status === "running";
        const elapsed = time(now) - time(running ? stored.claimedAt! : stored.job.createdAt);
        if (elapsed >= (running ? 15 * 60_000 : 2 * 60_000))
          this.storage.saveJob({
            ...stored,
            job: { ...stored.job, status: "expired", error: "expired", finishedAt: now },
          });
      }
    });
  }
  state(sessionId?: string): HistoryState {
    this.expire();
    return this.storage.transaction(() => ({
      configured: this.runner.configured,
      jobs: this.storage
        .jobs()
        .map((value) => value.job)
        .filter((job) => !sessionId || job.sessionId === sessionId),
      proposals: this.storage
        .proposals()
        .map((value) => value.proposal)
        .filter((proposal) => !sessionId || proposal.sessionId === sessionId),
    }));
  }
  job(id: string): HistoryJob {
    this.expire();
    return this.requireJob(id).job;
  }
  private requireJob(id: string): StoredHistoryJob {
    const stored = this.storage.job(id);
    if (!stored) throw new AppError("not-found", "history job not found");
    return stored;
  }
  private assertNoGaps(job: Pick<HistoryJob, "sessionId" | "startAt" | "endAt">): void {
    if (
      this.repo
        .coverageGaps()
        .some(
          (gap) =>
            gap.sessionId === job.sessionId &&
            overlaps(job.startAt, job.endAt, gap.startedAt, gap.endedAt),
        )
    )
      conflict(
        "History range has pending or failed imports. Sync this range before generating or accepting proposals.",
      );
  }
  private snapshot(input: HistoryGenerateInput): HistorySnapshot {
    const session = this.repo.session(input.sessionId);
    if (!session) throw new AppError("not-found", "session not found");
    if (
      time(input.startAt) < time(session.startedAt) ||
      time(input.endAt) > time(session.endedAt ?? this.clock.now())
    )
      conflict("History range is outside the recorded session.");
    const cases = this.catalog
      .listCases()
      .map(({ id, clientId, reference, title, clientName }) => ({
        id,
        clientId,
        reference,
        title,
        clientName,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    // Sources have no session ID; select only the chosen session's recorded boundaries.
    const sources = this.repo
      .allSources()
      .filter(
        (source) =>
          time(source.recordedAt) >= time(input.startAt) &&
          time(source.recordedAt) <= time(input.endAt),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const periods = this.repo
      .listPeriods(session.id)
      .filter((period) => overlaps(input.startAt, input.endAt, period.startedAt, period.endedAt))
      .sort((a, b) => a.id.localeCompare(b.id));
    const catalogFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          cases: this.catalog.listCases().sort((a, b) => a.id.localeCompare(b.id)),
          clients: this.catalog.listClients().sort((a, b) => a.id.localeCompare(b.id)),
        }),
      )
      .digest("hex");
    return { session, cases, sources, periods, catalogFingerprint };
  }
  private assertSnapshot(stored: StoredHistoryJob): void {
    this.assertNoGaps(stored.job);
    const current = this.snapshot(stored.job);
    const accepted = this.storage
      .proposals(stored.job.id)
      .filter((value) => value.proposal.status === "accepted");
    const ownPeriods = new Set(accepted.map((value) => value.proposal.acceptedPeriodId));
    current.periods = current.periods.filter((period) => !ownPeriods.has(period.id));
    // Normalize only source links made by an unchanged acceptance from this job.
    for (const value of accepted) {
      const p = this.repo.period(value.proposal.acceptedPeriodId!);
      if (!p || p.revision !== value.acceptanceResult!.period.revision)
        conflict("An accepted history period changed. Generate new proposals.");
      for (const source of current.sources) {
        if (source.workPeriodId === p!.id) {
          const original = stored.snapshot.sources.find((item) => item.id === source.id);
          if (original?.workPeriodId === null && value.proposal.sourceIds.includes(source.id))
            source.workPeriodId = null;
        }
      }
    }
    // Validation and availability reviews do not change the observed evidence used for inference.
    const evidence = (snapshot: HistorySnapshot) => ({
      ...snapshot,
      sources: snapshot.sources.map(
        ({
          id,
          workPeriodId,
          instanceId,
          contentType,
          externalId,
          recordedAt,
          excerpt,
          appName,
          windowName,
        }) => ({
          id,
          workPeriodId,
          instanceId,
          contentType,
          externalId,
          recordedAt,
          excerpt,
          appName,
          windowName,
        }),
      ),
    });
    if (JSON.stringify(evidence(current)) !== JSON.stringify(evidence(stored.snapshot)))
      conflict(
        "History evidence, session, periods or case catalog changed. Generate new proposals.",
      );
  }
  async generate(input: HistoryGenerateInput): Promise<HistoryJob> {
    assertTime(input.startAt);
    assertTime(input.endAt);
    if (
      !(time(input.endAt) > time(input.startAt)) ||
      time(input.endAt) - time(input.startAt) > 3_600_000
    )
      throw new AppError("invalid-request", "Choose a history range of at most one hour.");
    if (!this.runner.configured)
      throw new AppError("conflict", "Screenpipe history workflow is not configured.");
    this.expire();
    const stored = this.storage.transaction(() => {
      if (this.storage.jobs().some((value) => pending.has(value.job.status)))
        conflict("A history workflow is already pending or running.");
      this.assertNoGaps(input);
      const snapshot = this.snapshot(input);
      if (!snapshot.sources.length)
        conflict("No imported evidence exists in this range. Sync sources first.");
      if (snapshot.sources.length > 10_000)
        conflict("Too many sources. Select a smaller history range.");
      const value: StoredHistoryJob = {
        job: {
          id: randomUUID(),
          ...input,
          createdAt: this.clock.now(),
          finishedAt: null,
          status: "dispatching",
          error: null,
          sourceCount: snapshot.sources.length,
          proposalCount: 0,
        },
        snapshot,
        claimId: null,
        claimedAt: null,
        completionJson: null,
      };
      this.storage.saveJob(value);
      return value;
    });
    let status: "dispatched" | "dispatch-unconfirmed" | "failed";
    try {
      status = (await this.runner.dispatch()) === "started" ? "dispatched" : "dispatch-unconfirmed";
    } catch {
      status = "failed";
    }
    return this.storage.transaction(() => {
      this.expire();
      const current = this.requireJob(stored.job.id);
      // The workflow can claim or complete while dispatch awaits its acknowledgement.
      if (current.job.status !== "dispatching") return current.job;
      current.job = {
        ...current.job,
        status,
        error: status === "failed" ? "dispatch-failed" : null,
        finishedAt: status === "failed" ? this.clock.now() : null,
      };
      this.storage.saveJob(current);
      return current.job;
    });
  }
  claim(): HistoryClaim | null {
    this.expire();
    const result = this.storage.transaction((): HistoryClaim | AppError | null => {
      const stored = this.storage
        .jobs()
        .find((value) =>
          ["dispatching", "dispatched", "dispatch-unconfirmed"].includes(value.job.status),
        );
      if (!stored) return null;
      try {
        this.assertSnapshot(stored);
      } catch (error) {
        stored.job = {
          ...stored.job,
          status: "failed",
          error: "stale-snapshot",
          finishedAt: this.clock.now(),
        };
        this.storage.saveJob(stored);
        return error instanceof AppError
          ? error
          : new AppError("conflict", "History snapshot changed.");
      }
      stored.claimId = randomUUID();
      stored.claimedAt = this.clock.now();
      stored.job.status = "running";
      this.storage.saveJob(stored);
      return {
        job: stored.job,
        claimId: stored.claimId,
        session: stored.snapshot.session,
        sources: stored.snapshot.sources,
        cases: stored.snapshot.cases,
      };
    });
    if (result instanceof AppError) throw result;
    return result;
  }
  private assertClaim(stored: StoredHistoryJob, claimId: string): void {
    if (typeof claimId !== "string" || stored.claimId !== claimId)
      conflict("Invalid history workflow claim.");
  }
  complete(id: string, claimId: string, proposals: HistoryProposalInput[]): HistoryJob {
    this.expire();
    return this.storage.transaction(() => {
      const stored = this.requireJob(id);
      this.assertClaim(stored, claimId);
      const completionJson = JSON.stringify(proposals);
      if (stored.job.status === "ready") {
        if (completionJson !== stored.completionJson)
          conflict("History completion changed on replay.");
        return stored.job;
      }
      if (stored.job.status !== "running") conflict("History job is not running.");
      this.assertSnapshot(stored);
      if (!Array.isArray(proposals) || proposals.length > 100)
        throw new AppError("invalid-request", "Expected at most 100 history proposals.");
      const ordered = [...proposals].sort((a, b) => time(a.startedAt) - time(b.startedAt));
      ordered.forEach((input, index) => {
        this.assertProposal(stored, input);
        if (
          index &&
          overlaps(
            input.startedAt,
            input.endedAt,
            ordered[index - 1].startedAt,
            ordered[index - 1].endedAt,
          )
        )
          conflict("History proposals overlap.");
        const proposal: HistoryProposal = {
          ...input,
          id: randomUUID(),
          jobId: id,
          sessionId: stored.job.sessionId,
          revision: 0,
          status: "draft",
          acceptedPeriodId: null,
        };
        this.storage.saveProposal({ proposal, acceptanceJson: null, acceptanceResult: null });
      });
      stored.completionJson = completionJson;
      stored.job = {
        ...stored.job,
        status: "ready",
        finishedAt: this.clock.now(),
        proposalCount: proposals.length,
      };
      this.storage.saveJob(stored);
      return stored.job;
    });
  }
  private assertBounds(stored: StoredHistoryJob, start: string, end: string): void {
    assertTime(start);
    assertTime(end);
    if (
      time(start) >= time(end) ||
      time(start) < time(stored.job.startAt) ||
      time(end) > time(stored.job.endAt)
    )
      conflict("Proposal boundaries must stay inside the requested history range.");
  }
  private assertProposal(stored: StoredHistoryJob, input: HistoryProposalInput): void {
    this.assertBounds(stored, input.startedAt, input.endedAt);
    if (
      typeof input.label !== "string" ||
      !input.label.trim() ||
      input.label.length > 1000 ||
      typeof input.hasGaps !== "boolean" ||
      (input.confidence !== null &&
        (typeof input.confidence !== "number" ||
          !Number.isFinite(input.confidence) ||
          input.confidence < 0 ||
          input.confidence > 1))
    )
      throw new AppError("invalid-request", "Invalid history proposal context.");
    if (input.caseId !== null && !stored.snapshot.cases.some((item) => item.id === input.caseId))
      conflict("History case is not in the selected catalog.");
    if (
      !Array.isArray(input.sourceIds) ||
      !input.sourceIds.length ||
      input.sourceIds.length > 10_000 ||
      new Set(input.sourceIds).size !== input.sourceIds.length
    )
      throw new AppError(
        "invalid-request",
        "History proposal requires distinct supporting sources.",
      );
    for (const id of input.sourceIds) {
      const source = stored.snapshot.sources.find((item) => item.id === id);
      if (
        !source ||
        time(source.recordedAt) < time(input.startedAt) ||
        time(source.recordedAt) > time(input.endedAt)
      )
        conflict("Proposal supporting source is outside its bounds or snapshot.");
    }
  }
  fail(id: string, claimId: string, error: HistoryFailure): HistoryJob {
    this.expire();
    return this.storage.transaction(() => {
      const stored = this.requireJob(id);
      this.assertClaim(stored, claimId);
      if (!failures.includes(error))
        throw new AppError("invalid-request", "Invalid history failure category.");
      if (stored.job.status === "failed" && stored.job.error === error) return stored.job;
      if (stored.job.status !== "running") conflict("History job is not running.");
      stored.job = { ...stored.job, status: "failed", error, finishedAt: this.clock.now() };
      this.storage.saveJob(stored);
      return stored.job;
    });
  }
  accept(id: string, input: HistoryAcceptInput): HistoryAcceptResult {
    return this.storage.transaction(() => {
      const value = this.storage.proposal(id);
      if (!value) throw new AppError("not-found", "history proposal not found");
      const acceptanceJson = JSON.stringify(input);
      if (value.proposal.status === "accepted") {
        if (acceptanceJson !== value.acceptanceJson)
          conflict("History acceptance changed on replay.");
        return value.acceptanceResult!;
      }
      if (value.proposal.status !== "draft" || input.expectedRevision !== value.proposal.revision)
        conflict("History proposal revision changed.");
      const stored = this.requireJob(value.proposal.jobId);
      this.assertSnapshot(stored);
      this.assertBounds(stored, input.startedAt, input.endedAt);
      if (
        !Number.isSafeInteger(input.durationMs) ||
        input.durationMs <= 0 ||
        typeof input.label !== "string" ||
        !input.label.trim() ||
        input.label.length > 1000
      )
        throw new AppError(
          "invalid-request",
          "Enter a positive whole duration in milliseconds and a description.",
        );
      if (
        input.caseId !== null &&
        !this.catalog.listCases({ status: "active" }).some((item) => item.id === input.caseId)
      )
        conflict("Choose an existing active case or leave the period unresolved.");
      if (
        this.repo
          .listPeriods(stored.job.sessionId)
          .some((period) =>
            overlaps(input.startedAt, input.endedAt, period.startedAt, period.endedAt),
          )
      )
        conflict("History period overlaps an existing period. Existing periods are preserved.");
      const period: PeriodRecord = {
        id: randomUUID(),
        sessionId: stored.job.sessionId,
        caseId: input.caseId,
        initialCaseId: input.caseId,
        initialOrigin:
          input.caseId === null ? AssignmentOrigin.Unresolved : AssignmentOrigin.Lawyer,
        assignmentOrigin:
          input.caseId === null ? AssignmentOrigin.Unresolved : AssignmentOrigin.Lawyer,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        detectedDurationMs: null,
        durationOverrideMs: input.durationMs,
        assignmentRevision: 0,
        effectiveRevision: 0,
        validatedEffectiveRevision: null,
        timeValidatedAt: null,
        billingStatus: BillingStatus.Unbilled,
        billedAt: null,
        revision: 0,
        label: input.label.trim(),
        billable: true,
        excluded: false,
      };
      this.repo.insertPeriod(period, this.clock.now());
      if (period.caseId === null)
        this.repo.saveQuestion({
          questionId: `period:${period.id}`,
          sessionId: period.sessionId,
          periodId: period.id,
          expectedAssignmentRevision: period.assignmentRevision,
          status: QuestionStatus.Pending,
          responseCommandId: null,
          responseResultJson: null,
        });
      const evidence = new EvidenceService(this.repo, this.clock);
      for (const sourceId of value.proposal.sourceIds) {
        const source = stored.snapshot.sources.find((item) => item.id === sourceId)!;
        const current = this.repo.sourceByIdentity(
          source.instanceId,
          source.contentType,
          source.externalId,
        )!;
        if (
          current.workPeriodId !== null ||
          time(source.recordedAt) < time(input.startedAt) ||
          time(source.recordedAt) > time(input.endedAt) ||
          (time(source.recordedAt) === time(input.endedAt) &&
            input.endedAt !== stored.snapshot.session.endedAt)
        )
          continue;
        evidence.importRetrievedSource({
          id: source.id,
          instanceId: source.instanceId,
          contentType: source.contentType,
          externalId: source.externalId,
          recordedAt: source.recordedAt,
          periodId: period.id,
        });
      }
      value.proposal = {
        ...value.proposal,
        caseId: input.caseId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        label: input.label.trim(),
        status: "accepted",
        revision: value.proposal.revision + 1,
        acceptedPeriodId: period.id,
      };
      value.acceptanceJson = acceptanceJson;
      value.acceptanceResult = { proposal: value.proposal, period: periodView(period) };
      this.storage.saveProposal(value);
      return value.acceptanceResult;
    });
  }
  reject(id: string, expectedRevision: number): HistoryProposal {
    return this.storage.transaction(() => {
      const value = this.storage.proposal(id);
      if (!value) throw new AppError("not-found", "history proposal not found");
      if (value.proposal.status === "rejected" && value.proposal.revision === expectedRevision + 1)
        return value.proposal;
      if (value.proposal.status !== "draft" || value.proposal.revision !== expectedRevision)
        conflict("History proposal revision changed.");
      value.proposal = {
        ...value.proposal,
        status: "rejected",
        revision: value.proposal.revision + 1,
      };
      this.storage.saveProposal(value);
      return value.proposal;
    });
  }
}
