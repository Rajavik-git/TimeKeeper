import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readScreenpipe, type LinkDeps } from "./screenpipe-link.js";
import type { SessionDeps } from "./session.js";
import { findNode, startTabDetection } from "./tab-detection.js";
import { numberSetting } from "./runtime-config.js";

/**
 * TIMEKEEPER_API_URL   API base including /api (default http://127.0.0.1:<TIMEKEEPER_PORT or 8787>/api)
 * TIMEKEEPER_LAUNCH_COMMAND  optional shell command that opens TimeKeeper when its API is not running
 * TIMEKEEPER_TAB_DETECTION   set to off to not start JEV tab detection with the session
 * TIMEKEEPER_NODE            Node executable for tab detection (default: current Node runtime)
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionDeps {
  const apiBase = (
    env.TIMEKEEPER_API_URL || `http://127.0.0.1:${env.TIMEKEEPER_PORT || 8787}/api`
  ).replace(/\/+$/, "");
  const launchCommand = env.TIMEKEEPER_LAUNCH_COMMAND?.trim();
  return {
    apiBase,
    fetch: globalThis.fetch,
    now: () => new Date(),
    newId: () => `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    startTabDetection: () =>
      startTabDetection({
        enabled: !/^(0|false|off|no)$/i.test(env.TIMEKEEPER_TAB_DETECTION ?? ""),
        node: findNode(env),
        apiBase,
        environment: env,
        // A Screenpipe pipe run kills its process tree on exit; on Windows, start the watcher outside it.
        launch:
          env.TIMEKEEPER_TAB_LAUNCH === "spawn" || process.platform !== "win32" ? "spawn" : "wmi",
      }),
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

/**
 * Screenpipe session link (server.ts --screenpipe-link):
 * SCREENPIPE_URL                   Screenpipe API (default http://localhost:3030)
 * TIMEKEEPER_LINK_GRACE_SECONDS    how long Screenpipe may stop before the session ends (default 60)
 * TIMEKEEPER_LINK_STATE            state file (default data/screenpipe-link.json in the repository)
 */
export function linkFromEnv(env: NodeJS.ProcessEnv = process.env): {
  deps: LinkDeps;
  statePath: string;
} {
  const url = (env.SCREENPIPE_URL || "http://localhost:3030").replace(/\/+$/, "");
  return {
    deps: {
      session: depsFromEnv(env),
      readScreenpipe: () => readScreenpipe(url),
      graceMs:
        numberSetting("TIMEKEEPER_LINK_GRACE_SECONDS", env.TIMEKEEPER_LINK_GRACE_SECONDS, {
          defaultValue: 60,
          min: 0,
          max: Number.MAX_SAFE_INTEGER / 1000,
        }) * 1000,
      log: (message) => console.error(`[${new Date().toISOString()}] ${message}`),
    },
    statePath: linkStatePath(env),
  };
}

export const linkStatePath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.TIMEKEEPER_LINK_STATE ||
  fileURLToPath(new URL("../../data/screenpipe-link.json", import.meta.url));
