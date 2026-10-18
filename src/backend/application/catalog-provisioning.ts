import { assertId } from "./assertions.js";
import { AppError } from "./errors.js";
import { resolveRate } from "../domain/rules.js";
import type { Clock } from "../ports/index.js";
import type { Repository } from "../ports/repository.js";
type ProvisioningRepository = Pick<
  Repository,
  "transaction" | "createClient" | "createCase" | "setGlobalRate" | "rateForCase"
>;
/** Compatibility provisioning commands share validation without owning period transitions. */
export class CatalogProvisioningService {
  constructor(
    private readonly repo: ProvisioningRepository,
    private readonly clock: Clock,
  ) {}
  createClient(id: string, name: string): void {
    assertId(id);
    if (!name.trim()) throw new AppError("invalid-request", "client name required");
    this.repo.transaction(() => this.repo.createClient(id, name, this.clock.now()));
  }
  createCase(
    id: string,
    clientId: string,
    reference: string,
    title: string,
    hourlyRateCents: number | null,
  ): void {
    assertId(id);
    assertId(clientId);
    if (
      !reference.trim() ||
      !title.trim() ||
      (hourlyRateCents !== null && (!Number.isSafeInteger(hourlyRateCents) || hourlyRateCents < 0))
    )
      throw new AppError("invalid-request", "invalid case");
    this.repo.transaction(() =>
      this.repo.createCase(id, clientId, reference, title, hourlyRateCents, this.clock.now()),
    );
  }
  setGlobalRate(rateCents: number, currency: string, workspaceId: string): void {
    if (!Number.isSafeInteger(rateCents) || rateCents < 0 || !/^[A-Z]{3}$/.test(currency))
      throw new AppError("invalid-request", "invalid rate or currency");
    assertId(workspaceId);
    this.repo.transaction(() =>
      this.repo.setGlobalRate(rateCents, currency, workspaceId, this.clock.now()),
    );
  }
  currentRateForCase(id: string): number {
    const rates = this.repo.rateForCase(id);
    if (!rates) throw new AppError("not-found", "case or global rate not found");
    const rate = resolveRate(
      rates.caseRateCents,
      rates.globalRateCents,
      rates.clientRateCents ?? null,
    );
    if (rate === null) throw new AppError("conflict", "global hourly rate is not configured");
    return rate;
  }
}
