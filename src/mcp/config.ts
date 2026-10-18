import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { screenpipeBaseUrl } from "../backend/adapters/screenpipe/http.js";
import { readScreenpipe, type LinkDeps } from "./screenpipe-link.js";
import type { SessionDeps } from "./session.js";

/**
 * TIMEKEEPER_API_URL         API origin (default http://127.0.0.1:<TIMEKEEPER_PORT or 8787>); a trailing /api is accepted
 * TIMEKEEPER_LAUNCH_COMMAND  optional shell command that opens TimeKeeper when its API is not running
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionDeps {
  const apiOrigin = (env.TIMEKEEPER_API_URL || `http://127.0.0.1:${env.TIMEKEEPER_PORT || 8787}`)
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  const launchCommand = env.TIMEKEEPER_LAUNCH_COMMAND?.trim();
  return {
    apiOrigin,
    fetch: globalThis.fetch,
    now: () => new Date(),
    newId: () => `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    ...(launchCommand
      ? {
          launch: async () => {
            spawn(launchCommand, {
              shell: true,
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            }).unref();
          },
        }
      : {}),
  };
}

/** TIMEKEEPER_MCP_STATE, else data/screenpipe-link.json under the working directory (the repository root). */
export const linkStatePath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.TIMEKEEPER_MCP_STATE || resolve(process.cwd(), "data/screenpipe-link.json");

/**
 * SCREENPIPE_URL                 Screenpipe API (default http://127.0.0.1:3030); only /health is read
 * TIMEKEEPER_LINK_GRACE_SECONDS  how long Screenpipe may stop before the session ends (default 60)
 */
export function linkFromEnv(env: NodeJS.ProcessEnv = process.env): {
  deps: LinkDeps;
  statePath: string;
} {
  const url = screenpipeBaseUrl(env);
  return {
    deps: {
      session: depsFromEnv(env),
      readScreenpipe: () => readScreenpipe(url),
      graceMs: (Number(env.TIMEKEEPER_LINK_GRACE_SECONDS) || 60) * 1000,
      log: (message) => console.error(`[${new Date().toISOString()}] ${message}`),
    },
    statePath: linkStatePath(env),
  };
}
