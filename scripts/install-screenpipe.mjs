#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpHttpConfig } from "../src/mcp/runtime-config.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELP = `Install TimeKeeper's MCP registration and skill in Screenpipe.

Usage: node scripts/install-screenpipe.mjs [--check] [--screenpipe-dir PATH]

  --check                 Report pending changes without writing files.
  --screenpipe-dir PATH   Screenpipe data directory. Default: ~/.screenpipe.
  --help                  Show this help.

Registers timekeeper at the loopback TIMEKEEPER_MCP_PORT in mcp_servers.json.
Uses the same default and validation as npm run mcp:http.
Copies the repository skill to skills/timekeeper/SKILL.md and the manual history pipe.
Preserves other servers, skills, and files. Backs up files before replacing them.
Does not start services, recording, workflows, or JEV.

Exit codes: 0 = installed or current; 1 = error; 2 = check found pending changes.
`;

function parseArgs(args) {
  const options = { check: false, screenpipeDir: join(homedir(), ".screenpipe") };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--screenpipe-dir" && args[i + 1]?.trim() && !args[i + 1].startsWith("--")) {
      options.screenpipeDir = resolve(args[++i]);
    } else throw new Error("Unsupported or incomplete option. Use --help.");
  }
  return options;
}

async function inspect(path, directory = false) {
  try {
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error("An installation path has an unsupported file type or symbolic link.");
    }
    return stat;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function snapshot(path) {
  const stat = await inspect(path);
  return stat ? { bytes: await fs.readFile(path), mode: stat.mode & 0o777 } : null;
}

function serverConfig(previous, mcpUrl) {
  const server = {
    ...previous,
    id: "timekeeper",
    name: "TimeKeeper",
    url: mcpUrl,
    transport: "http",
    header_names: [],
    auth_mode: "headers",
    enabled: true,
    created_at: previous?.created_at ?? Math.floor(Date.now() / 1000),
  };
  // TimeKeeper uses loopback HTTP without provider credentials or a child process.
  for (const key of ["command", "args", "env", "oauth"]) delete server[key];
  return server;
}

function updateRegistration(bytes, mcpUrl) {
  let config;
  try {
    config = bytes ? JSON.parse(bytes.toString("utf8")) : { servers: [] };
  } catch {
    throw new Error("mcp_servers.json contains invalid JSON. Repair it before installation.");
  }
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    !Array.isArray(config.servers)
  ) {
    throw new Error("mcp_servers.json must contain a servers array. No files were changed.");
  }
  const ids = new Set();
  for (const server of config.servers) {
    if (!server || typeof server.id !== "string" || !server.id.trim() || ids.has(server.id)) {
      throw new Error(
        "mcp_servers.json contains invalid or duplicate server IDs. Repair it first.",
      );
    }
    ids.add(server.id);
  }
  const index = config.servers.findIndex((server) => server.id === "timekeeper");
  const previous = index < 0 ? undefined : config.servers[index];
  const next = serverConfig(previous, mcpUrl);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return bytes;
  if (index < 0) config.servers.push(next);
  else config.servers[index] = next;
  return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
}

async function planInstallation(rootDir, screenpipeDir, mcpUrl) {
  // Validate all managed destinations before creating directories or changing files.
  for (const path of [
    screenpipeDir,
    join(screenpipeDir, "skills"),
    join(screenpipeDir, "skills", "timekeeper"),
    join(screenpipeDir, "timekeeper-backups"),
    join(screenpipeDir, "pipes"),
    join(screenpipeDir, "pipes", "generate-work-periods"),
  ]) {
    await inspect(path, true);
  }
  const source = join(rootDir, "integrations", "screenpipe", "timekeeper", "SKILL.md");
  const skill = await snapshot(source);
  if (!skill || !/^---\r?\nname: timekeeper\r?\n/.test(skill.bytes.toString("utf8"))) {
    throw new Error("The repository TimeKeeper SKILL.md is missing or has an unexpected name.");
  }
  const configPath = join(screenpipeDir, "mcp_servers.json");
  const skillPath = join(screenpipeDir, "skills", "timekeeper", "SKILL.md");
  const configBefore = await snapshot(configPath);
  const skillBefore = await snapshot(skillPath);
  const pipeSource = join(
    rootDir,
    "integrations",
    "screenpipe",
    "pipes",
    "generate-work-periods",
    "pipe.md",
  );
  const pipe = await snapshot(pipeSource);
  if (!pipe || !pipe.bytes.toString("utf8").includes("schedule: manual")) {
    throw new Error("The repository manual history pipe is missing or invalid.");
  }
  const pipePath = join(screenpipeDir, "pipes", "generate-work-periods", "pipe.md");
  const pipeBefore = await snapshot(pipePath);
  const files = [
    {
      path: pipePath,
      label: "TimeKeeper history pipe",
      backupName: "generate-work-periods.md",
      before: pipeBefore,
      bytes: pipe.bytes,
      mode: pipeBefore?.mode ?? 0o644,
    },
    {
      path: skillPath,
      label: "TimeKeeper skill",
      backupName: "SKILL.md",
      before: skillBefore,
      bytes: skill.bytes,
      mode: skillBefore?.mode ?? 0o644,
    },
    {
      path: configPath,
      label: "TimeKeeper MCP registration",
      backupName: "mcp_servers.json",
      before: configBefore,
      bytes: updateRegistration(configBefore?.bytes, mcpUrl),
      mode: configBefore?.mode ?? 0o600,
    },
  ];
  return files.filter((file) => !file.before?.bytes.equals(file.bytes));
}

async function stageFile(path, bytes, mode) {
  const temporary = join(dirname(path), `.timekeeper-${randomUUID()}.tmp`);
  const file = await fs.open(temporary, "wx", mode);
  try {
    try {
      await file.writeFile(bytes);
      await file.chmod(mode);
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    // Close before removing on Windows. Preserve the original write failure.
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return temporary;
}

async function applyInstallation(changes, screenpipeDir, log) {
  let backupDir;
  const staged = [];
  const applied = [];
  let failure;
  try {
    if (changes.some((file) => file.before)) {
      const backups = join(screenpipeDir, "timekeeper-backups");
      await fs.mkdir(backups, { recursive: true, mode: 0o700 });
      backupDir = await fs.mkdtemp(join(backups, `${Date.now()}-`));
      for (const file of changes.filter((file) => file.before)) {
        await fs.writeFile(join(backupDir, file.backupName), file.before.bytes, {
          flag: "wx",
          mode: 0o600,
        });
      }
      log(`[backup] Previous files saved in ${backupDir}`);
    }
    for (const file of changes) {
      await fs.mkdir(dirname(file.path), { recursive: true });
      staged.push({ ...file, temporary: await stageFile(file.path, file.bytes, file.mode) });
    }
    for (const file of staged) {
      const current = await snapshot(file.path);
      if (file.before ? !current?.bytes.equals(file.before.bytes) : current !== null) {
        throw new Error("Screenpipe files changed during installation. Rerun the installer.");
      }
    }
    for (const file of staged) {
      await fs.rename(file.temporary, file.path);
      applied.push(file);
    }
  } catch (error) {
    failure = error;
    let restored = true;
    for (const file of applied.reverse()) {
      try {
        if (file.before) {
          const temporary = await stageFile(file.path, file.before.bytes, file.before.mode);
          staged.push({ temporary });
          await fs.rename(temporary, file.path);
        } else await fs.rm(file.path);
      } catch {
        restored = false;
      }
    }
    if (!restored) {
      failure = new Error(
        `Installation failed and rollback is incomplete. Restore previous files from ${backupDir ?? "your backup"}.`,
      );
    }
  }
  const cleanup = await Promise.allSettled(
    staged.map((file) => fs.rm(file.temporary, { force: true })),
  );
  if (cleanup.some((result) => result.status === "rejected")) {
    log(
      "[pending] Temporary-file cleanup failed. Check .timekeeper-*.tmp files in the installation directories.",
    );
    failure ??= new Error("Files were installed, but temporary-file cleanup needs attention.");
  }
  if (failure) throw failure;
}

export async function installScreenpipe({
  args = process.argv.slice(2),
  rootDir = ROOT,
  env = process.env,
  log = console.log,
} = {}) {
  let lock;
  let lockPath;
  let exitCode = 1;
  try {
    const options = parseArgs(args);
    if (options.help) {
      log(HELP);
      exitCode = 0;
    } else {
      const { screenpipeDir, check } = options;
      const { url: mcpUrl } = mcpHttpConfig(env);
      if (!check) {
        await inspect(screenpipeDir, true);
        await fs.mkdir(screenpipeDir, { recursive: true, mode: 0o700 });
        lockPath = join(screenpipeDir, ".timekeeper-install.lock");
        try {
          lock = await fs.open(lockPath, "wx", 0o600);
        } catch (error) {
          if (error.code === "EEXIST")
            throw new Error(
              "Another installer holds .timekeeper-install.lock. If it stopped, remove that lock and rerun.",
            );
          throw error;
        }
      }
      const changes = await planInstallation(rootDir, screenpipeDir, mcpUrl);
      if (check) {
        for (const file of changes) log(`[pending] ${file.label}: ${file.path}`);
        if (!changes.length) log("[ok] Screenpipe registration and TimeKeeper skill are current.");
        exitCode = changes.length ? 2 : 0;
      } else {
        await applyInstallation(changes, screenpipeDir, log);
        for (const file of changes) log(`[installed] ${file.label}: ${file.path}`);
        if (!changes.length) log("[ok] Screenpipe registration and TimeKeeper skill are current.");
        log(
          "Run the TimeKeeper API and npm run mcp:http separately. Open a new Screenpipe chat to load the skill.",
        );
        exitCode = 0;
      }
    }
  } catch (error) {
    // Do not print raw JSON, filesystem diagnostics, or existing server credentials.
    log(
      `[error] ${error.code ? "Cannot access installation files. Check the Screenpipe directory and permissions." : error.message}`,
    );
  }
  if (lock) {
    const cleanup = await Promise.allSettled([lock.close()]);
    // Attempt lock removal even if closing it failed.
    cleanup.push(...(await Promise.allSettled([fs.rm(lockPath, { force: true })])));
    if (cleanup.some((result) => result.status === "rejected")) {
      log(
        "[error] Installer lock cleanup failed. Check .timekeeper-install.lock in the Screenpipe directory before rerunning.",
      );
      exitCode = 1;
    }
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await installScreenpipe();
}
