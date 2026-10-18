import { AssignmentOrigin, AvailabilityStatus, ValidationStatus } from "../domain/states.js";
import type { Repository } from "../ports/repository.js";
import type { Clock } from "../ports/index.js";
import { timeIsValidated } from "../domain/rules.js";
import { AppError } from "./errors.js";
import { assertTime } from "./assertions.js";
type EvidenceRepository = Pick<
  Repository,
  | "transaction"
  | "session"
  | "period"
  | "sourceByIdentity"
  | "sourceRelocatedFrom"
  | "insertSource"
  | "saveSource"
  | "insertConflict"
>;
/** Imports observations and records protected reconstruction proposals without deriving duration. */
export class EvidenceService {
  constructor(
    private readonly repo: EvidenceRepository,
    private readonly clock: Clock,
  ) {}
  private session(id: string) {
    const session = this.repo.session(id);
    if (!session) throw new AppError("not-found", "session not found");
    return session;
  }
  importSource(input: {
    id: string;
    periodId: string | null;
    instanceId: string;
    contentType: string;
    externalId: string;
    recordedAt: string;
  }): { id: string; status: "imported" | "unchanged" } {
    return this.repo.transaction(() => {
      assertTime(input.recordedAt);
      const old = this.repo.sourceByIdentity(input.instanceId, input.contentType, input.externalId);
      if (
        old &&
        input.periodId &&
        old.recordedAt === input.recordedAt &&
        this.repo.sourceRelocatedFrom(old.id, input.periodId)
      )
        return { id: old.id, status: "unchanged" as const };
      if (input.periodId) this.assertSourcePeriod(input.periodId, input.recordedAt);
      if (old) {
        if (old.workPeriodId !== input.periodId || old.recordedAt !== input.recordedAt)
          throw new AppError("conflict", "source identity changed");
        return { id: old.id, status: "unchanged" as const };
      }
      this.repo.insertSource({
        id: input.id,
        workPeriodId: input.periodId,
        instanceId: input.instanceId,
        contentType: input.contentType,
        externalId: input.externalId,
        recordedAt: input.recordedAt,
        ingestedAt: this.clock.now(),
        validationStatus: ValidationStatus.Unvalidated,
        validatedAt: null,
        availabilityStatus: AvailabilityStatus.Unknown,
        availabilityCheckedAt: null,
      });
      return { id: input.id, status: "imported" as const };
    });
  }
  /** Internal retrieval path. Identity and existing attachments remain immutable. */
  importRetrievedSource(
    input: Parameters<EvidenceService["importSource"]>[0] & {
      excerpt?: string;
      appName?: string;
      windowName?: string;
    },
  ): { id: string; status: "imported" | "unchanged" | "updated" } {
    return this.repo.transaction(() => {
      const old = this.repo.sourceByIdentity(input.instanceId, input.contentType, input.externalId);
      if (!old) {
        const result = this.importSource(input);
        const created = this.repo.sourceByIdentity(
          input.instanceId,
          input.contentType,
          input.externalId,
        )!;
        this.repo.saveSource({ ...created, ...this.missingContext(created, input) });
        return result;
      }
      if (Date.parse(old.recordedAt) !== Date.parse(input.recordedAt))
        throw new AppError("conflict", "source identity changed");
      let workPeriodId = old.workPeriodId;
      if (
        workPeriodId === null &&
        input.periodId &&
        !this.repo.sourceRelocatedFrom(old.id, input.periodId)
      ) {
        // Reuse the ordinary import boundary checks without allowing its identity mutation.
        this.assertSourcePeriod(input.periodId, input.recordedAt);
        workPeriodId = input.periodId;
      }
      const context = this.missingContext(old, input);
      if (workPeriodId === old.workPeriodId && Object.keys(context).length === 0)
        return { id: old.id, status: "unchanged" as const };
      this.repo.saveSource({ ...old, ...context, workPeriodId });
      return { id: old.id, status: "updated" as const };
    });
  }
  private missingContext(
    old: { excerpt?: string | null; appName?: string | null; windowName?: string | null },
    input: { excerpt?: string; appName?: string; windowName?: string },
  ) {
    const changes: { excerpt?: string; appName?: string; windowName?: string } = {};
    for (const [field, limit] of [
      ["excerpt", 1000],
      ["appName", 300],
      ["windowName", 300],
    ] as const) {
      const value = input[field];
      if (!old[field]?.trim() && typeof value === "string" && value.trim())
        changes[field] = value.slice(0, limit);
    }
    return changes;
  }
  private assertSourcePeriod(periodId: string, recordedAt: string): void {
    const p = this.repo.period(periodId);
    if (!p) throw new AppError("not-found", "period not found");
    const s = this.session(p.sessionId);
    const at = Date.parse(recordedAt);
    const sessionEnd = s.endedAt === null ? null : Date.parse(s.endedAt);
    const periodEnd = p.endedAt === null ? null : Date.parse(p.endedAt);
    if (at < Date.parse(s.startedAt) || (sessionEnd !== null && at > sessionEnd))
      throw new AppError("conflict", "source outside session");
    if (
      at < Date.parse(p.startedAt) ||
      (periodEnd !== null && (at > periodEnd || (at === periodEnd && periodEnd !== sessionEnd)))
    )
      throw new AppError("conflict", "source outside period");
  }
  importSources(inputs: Parameters<EvidenceService["importSource"]>[0][]) {
    if (inputs.length < 1 || inputs.length > 500)
      throw new AppError("invalid-request", "expected 1 to 500 sources");
    return this.repo.transaction(() => inputs.map((input) => this.importSource(input)));
  }
  validateSource(
    instanceId: string,
    contentType: string,
    externalId: string,
    validated = true,
  ): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId, contentType, externalId);
      if (!s) throw new AppError("not-found", "source not found");
      if ((s.validationStatus === ValidationStatus.Validated) === validated) return;
      this.repo.saveSource({
        ...s,
        validationStatus: validated ? ValidationStatus.Validated : ValidationStatus.Unvalidated,
        validatedAt: validated ? this.clock.now() : null,
      });
    });
  }
  setSourceAvailability(
    instanceId: string,
    contentType: string,
    externalId: string,
    availability: Exclude<AvailabilityStatus, typeof AvailabilityStatus.Unknown>,
  ): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId, contentType, externalId);
      if (!s) throw new AppError("not-found", "source not found");
      this.repo.saveSource({
        ...s,
        availabilityStatus: availability,
        availabilityCheckedAt: this.clock.now(),
      });
    });
  }
  proposeReconstruction(input: {
    id: string;
    periodId: string;
    expectedRevision: number;
    startedAt: string;
    endedAt: string | null;
    sourceReferences: string[];
  }): void {
    this.repo.transaction(() => {
      const p = this.repo.period(input.periodId);
      if (!p) throw new AppError("not-found", "period not found");
      if (p.revision !== input.expectedRevision)
        throw new AppError("conflict", "stale period revision");
      if (
        p.assignmentOrigin !== AssignmentOrigin.Lawyer &&
        p.durationOverrideMs === null &&
        !timeIsValidated(p)
      )
        throw new AppError("rule-not-decided", "automatic reconstruction rule is open");
      this.repo.insertConflict(
        input.id,
        p.id,
        p.revision,
        input.startedAt,
        input.endedAt,
        JSON.stringify(input.sourceReferences),
      );
    });
  }
}
