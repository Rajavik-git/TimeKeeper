#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, open, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const HELP = `Prepare the TimeKeeper development environment.

Usage: node install.mjs [--check] [--skip-screenpipe] [--desktop]

  --check             Check prerequisites without changing files or dependencies.
  --skip-screenpipe   Prepare the local app without checking Screenpipe.
  --desktop           Also check Rust and Cargo for Tauri development.
  --help              Show this help.

Reads .nvmrc and local .env from the repository, regardless of your working directory.
Exported SCREENPIPE_API_URL overrides .env. Default: http://127.0.0.1:3030.
Screenpipe checks use only GET /health with a five-second timeout.
Setup never starts recording, installs workflows, or opens the database.

Exit codes: 0 = selected checks passed; 1 = setup error; 2 = prerequisites incomplete.
See docs/SETUP.md for installation and recovery steps.
`;

function runCommand(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function prepareConfig(rootDir, check, log) {
  const configPath = join(rootDir, ".env");
  if (!check) {
    // Exclusive creation preserves existing files, including concurrent setup runs.
    const template = await readFile(join(rootDir, ".env.example"), "utf8");
    let config;
    try {
      config = await open(configPath, "wx", 0o600);
      await config.writeFile(template);
      log("[ok] Created .env from .env.example.");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    } finally {
      await config?.close();
    }
  }

  try {
    const config = parseEnv(await readFile(configPath, "utf8"));
    log("[ok] Local configuration found. Existing values are preserved.");
    return config;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    log("[pending] Missing .env. Run node install.mjs to create it.");
    return null;
  }
}

export function screenpipeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SCREENPIPE_API_URL must be an HTTP loopback origin.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "SCREENPIPE_API_URL must be an HTTP loopback origin without credentials or a path.",
    );
  }
  return url.origin;
}

async function checkScreenpipe(origin, fetchHealth, log) {
  log(`[check] Screenpipe at ${origin}/health`);
  try {
    // Never follow a redirect or forward credentials to another service.
    const response = await fetchHealth(`${origin}/health`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      log(`[pending] Screenpipe health returned HTTP ${response.status}.`);
      return false;
    }
    const health = await response.json();
    if (health?.status !== "healthy") {
      log(
        "[pending] Screenpipe did not report healthy status. Check its recording settings and permissions.",
      );
      return false;
    }
    log(
      "[ok] Screenpipe health reports healthy. Protected API access and capture freshness remain unverified.",
    );
    return true;
  } catch {
    log("[pending] Screenpipe health is unavailable, timed out, or returned an invalid response.");
    return false;
  }
}

export async function install({
  args = process.argv.slice(2),
  rootDir = dirname(fileURLToPath(import.meta.url)),
  nodeVersion = process.versions.node,
  env = process.env,
  run = runCommand,
  fetchHealth = globalThis.fetch,
  log = console.log,
} = {}) {
  const supported = new Set(["--check", "--skip-screenpipe", "--desktop", "--help"]);
  if (args.some((arg) => !supported.has(arg))) {
    log("[error] Unknown option. Run node install.mjs --help.");
    return 1;
  }
  if (args.includes("--help")) {
    log(HELP);
    return 0;
  }

  try {
    const expectedNode = (await readFile(join(rootDir, ".nvmrc"), "utf8")).trim();
    if (nodeVersion !== expectedNode) {
      log(`[pending] Use Node ${expectedNode} from .nvmrc. Current version: ${nodeVersion}.`);
      log("With nvm, run nvm install and nvm use, then rerun setup.");
      return 2;
    }
    log(`[ok] Node ${expectedNode}.`);

    const commandOptions = { cwd: rootDir, env, timeout: 10000 };
    const npm = run("npm", ["--version"], commandOptions);
    if (npm.error || npm.status !== 0) {
      log("[pending] npm is unavailable. Install Node with npm, then rerun setup.");
      return 2;
    }
    log("[ok] npm is available.");

    const check = args.includes("--check");
    const skipScreenpipe = args.includes("--skip-screenpipe");
    const config = await prepareConfig(rootDir, check, log);
    let complete = config !== null;
    // Validate before npm ci. Do not print the raw configured value on failure.
    const origin = skipScreenpipe
      ? null
      : screenpipeOrigin(
          env.SCREENPIPE_API_URL ?? config?.SCREENPIPE_API_URL ?? "http://127.0.0.1:3030",
        );

    if (check) {
      if (await exists(join(rootDir, "node_modules", ".package-lock.json"))) {
        log(
          "[ok] npm dependencies found. This does not verify their integrity or lockfile agreement.",
        );
      } else {
        complete = false;
        log("[pending] npm dependencies missing. Run node install.mjs.");
      }
    } else {
      log("[install] Running npm ci with development dependencies. This replaces node_modules.");
      const result = run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], {
        cwd: rootDir,
        env,
        stdio: "inherit",
      });
      if (result.error || result.status !== 0) {
        log("[error] npm ci failed. Resolve the npm error above, then rerun setup.");
        return 1;
      }
      log("[ok] Project dependencies installed.");
    }

    if (args.includes("--desktop")) {
      for (const command of ["rustc", "cargo"]) {
        const result = run(command, ["--version"], commandOptions);
        if (result.error || result.status !== 0) {
          complete = false;
          log(
            `[pending] ${command} is unavailable. Follow the desktop prerequisites in docs/SETUP.md.`,
          );
        } else {
          log(`[ok] ${command} is available.`);
        }
      }
      log(
        "[info] OS build tools, WebView dependencies, and native behavior need separate verification.",
      );
    }

    if (skipScreenpipe) {
      log("[skipped] Screenpipe readiness. This run prepares local app development only.");
    } else {
      const healthy = await checkScreenpipe(origin, fetchHealth, log);
      if (!healthy) {
        complete = false;
        log(
          "Install or open Screenpipe, check its permissions, then run node install.mjs --check.",
        );
        log("Screenpipe installation: https://docs.screenpipe.com/getting-started");
      }
    }

    log(
      complete
        ? "Selected environment checks passed."
        : "Environment preparation is partial. Resolve the pending checks and rerun.",
    );
    log(
      "Screenpipe workflows, TimeKeeper MCP tools, and tag synchronization remain unimplemented.",
    );
    log("Start the local app with npm run dev. See docs/SETUP.md for desktop development.");
    return complete ? 0 : 2;
  } catch {
    // Raw filesystem, config, and network errors can contain local secrets.
    log(
      "[error] Setup could not read or prepare its configuration. Check .nvmrc, .env.example, .env permissions, and SCREENPIPE_API_URL.",
    );
    return 1;
  }
}

if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  process.exitCode = await install();
}
