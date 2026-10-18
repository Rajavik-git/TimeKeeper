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
  }): void {
    this.repo.transaction(() => {
      assertTime(input.recordedAt);
      const old = this.repo.sourceByIdentity(input.instanceId, input.contentType, input.externalId);
      if (
        old &&
        input.periodId &&
        old.recordedAt === input.recordedAt &&
        this.repo.sourceRelocatedFrom(old.id, input.periodId)
      )
        return;
      if (input.periodId) {
        const p = this.repo.period(input.periodId);
        if (!p) throw new AppError("not-found", "period not found");
        const s = this.session(p.sessionId);
        if (
          Date.parse(input.recordedAt) < Date.parse(s.startedAt) ||
          (s.endedAt !== null && Date.parse(input.recordedAt) > Date.parse(s.endedAt))
        )
          throw new AppError("conflict", "source outside session");
        if (
          Date.parse(input.recordedAt) < Date.parse(p.startedAt) ||
          (p.endedAt !== null &&
            (Date.parse(input.recordedAt) > Date.parse(p.endedAt) ||
              (Date.parse(input.recordedAt) === Date.parse(p.endedAt) && p.endedAt !== s.endedAt)))
        )
          throw new AppError("conflict", "source outside period");
      }
      if (old) {
        if (old.workPeriodId !== input.periodId || old.recordedAt !== input.recordedAt)
          throw new AppError("conflict", "source identity changed");
        return;
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
    });
  }
  validateSource(instanceId: string, contentType: string, externalId: string): void {
    this.repo.transaction(() => {
      const s = this.repo.sourceByIdentity(instanceId, contentType, externalId);
      if (!s) throw new AppError("not-found", "source not found");
      this.repo.saveSource({
        ...s,
        validationStatus: ValidationStatus.Validated,
        validatedAt: s.validatedAt ?? this.clock.now(),
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
        throw new AppError("pending", "automatic reconstruction rule is open");
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
