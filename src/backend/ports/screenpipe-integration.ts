import type { components } from "../../contracts/generated.js";

export type ScreenpipeIntegrationStatus = components["schemas"]["ScreenpipeIntegrationStatus"];
export type ScreenpipeSyncError = NonNullable<
  NonNullable<ScreenpipeIntegrationStatus["lastRun"]>["error"]
>;
export interface ScreenpipeSyncCounts {
  windows: number;
  imported: number;
  updated?: number;
  unchanged: number;
  preserved: number;
}
export interface ScreenpipeIntegrationOperations {
  hasSessions(): boolean;
  verifyAccess(signal: AbortSignal): Promise<void>;
  run(
    now: string,
    signal: AbortSignal,
  ): Promise<ScreenpipeSyncCounts & { error: ScreenpipeSyncError | null }>;
}
export interface ScreenpipeIntegration {
  status(): ScreenpipeIntegrationStatus;
  test(): Promise<ScreenpipeIntegrationStatus>;
  sync(): Promise<ScreenpipeIntegrationStatus>;
}
/** Stable provider failure classification. Never inspect or return provider response bodies. */
export function screenpipeFailure(error: unknown): Exclude<ScreenpipeSyncError, "not-configured"> {
  if (error instanceof Error && "kind" in error) {
    if (
      error.kind === "authentication-failed" ||
      error.kind === "unavailable" ||
      error.kind === "incomplete"
    )
      return error.kind;
  }
  return "internal";
}
