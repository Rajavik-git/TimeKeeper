import type { ApplicationServices } from "./bootstrap.js";
import { ScreenpipeIntegrationCoordinator } from "./application/screenpipe-integration.js";
import { RetrievalService } from "./application/retrieval.js";
import { httpScreenpipe } from "./adapters/screenpipe/http.js";
import { retrievalStore } from "./adapters/sqlite/retrieval.js";
import type { DatabaseSync } from "node:sqlite";
import {
  catchUpRecordings,
  CATCH_UP_DEFAULTS,
  type CatchUpResult,
} from "./workers/recording-catchup.js";
import {
  screenpipeFailure,
  type ScreenpipeIntegrationStatus,
  type ScreenpipeSyncError,
} from "./ports/screenpipe-integration.js";

/** Restrict credential-bearing requests to an HTTP loopback origin. */
export function screenpipeConfiguration(env: NodeJS.ProcessEnv) {
  let issue: ScreenpipeIntegrationStatus["configurationIssue"] = null;
  let baseUrl: string | undefined;
  try {
    const input = env.SCREENPIPE_URL?.trim() || "http://localhost:3030";
    const url = new URL(input);
    if (
      !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(input) ||
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("invalid-url");
    baseUrl = url.origin;
  } catch {
    issue = "invalid-url";
  }
  const apiKey = env.SCREENPIPE_API_KEY?.trim();
  if (!issue && !apiKey) issue = "missing-api-key";
  return { issue, baseUrl, apiKey, instanceId: env.SCREENPIPE_INSTANCE_ID || "local" };
}

/** Constructs adapters once; neither construction nor status reads start network work. */
export function createScreenpipeIntegration(
  services: ApplicationServices,
  db: DatabaseSync,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = globalThis.fetch,
): ScreenpipeIntegrationCoordinator {
  const config = screenpipeConfiguration(env);
  if (config.issue || !config.baseUrl || !config.apiKey)
    return new ScreenpipeIntegrationCoordinator(config.issue, undefined, services.clock);
  const retrieval = new RetrievalService(
    services.repository,
    retrievalStore(db),
    services.core,
    services.clock,
  );
  const client = (signal: AbortSignal) =>
    httpScreenpipe({
      baseUrl: config.baseUrl!,
      apiKey: config.apiKey,
      instanceId: config.instanceId,
      fetch: fetcher,
      signal,
    });
  return new ScreenpipeIntegrationCoordinator(
    null,
    {
      hasSessions: () => services.core.listSessions().length > 0,
      verifyAccess: (signal) => client(signal).verifyAccess(),
      run: async (now, signal) => {
        let counts: CatchUpResult = { windows: 0, imported: 0, unchanged: 0, skipped: 0 };
        let error: ScreenpipeSyncError | null = null;
        try {
          counts = await catchUpRecordings(client(signal), retrieval, config.instanceId, now, {
            ...CATCH_UP_DEFAULTS,
            signal,
            onProgress: (progress) => {
              counts = progress;
            },
          });
          error = counts.failureCode ?? (counts.stoppedBy ? "internal" : null);
        } catch (failure) {
          error = screenpipeFailure(failure);
        }
        return {
          windows: counts.windows,
          imported: counts.imported,
          updated: counts.updated ?? 0,
          unchanged: counts.unchanged,
          preserved: counts.skipped,
          error,
        };
      },
    },
    services.clock,
  );
}
