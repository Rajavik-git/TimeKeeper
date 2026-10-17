import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SessionDeps } from './session.js';

/**
 * TIMEKEEPER_API_URL   API base including /api (default http://127.0.0.1:<TIMEKEEPER_PORT or 8787>/api)
 * TIMEKEEPER_LAUNCH_COMMAND  optional shell command that opens TimeKeeper when its API is not running
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionDeps {
  const apiBase = (env.TIMEKEEPER_API_URL || `http://127.0.0.1:${env.TIMEKEEPER_PORT || 8787}/api`).replace(/\/+$/, '');
  const launchCommand = env.TIMEKEEPER_LAUNCH_COMMAND?.trim();
  return {
    apiBase,
    fetch: globalThis.fetch,
    now: () => new Date(),
    newId: () => `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    ...(launchCommand ? {
      launch: async () => {
        spawn(launchCommand, { shell: true, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      },
    } : {}),
  };
}
