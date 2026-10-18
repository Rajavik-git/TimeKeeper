import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installScreenpipe } from "../../scripts/install-screenpipe.mjs";

const directories = [];
const SOURCE = "---\nname: timekeeper\ndescription: Test skill\n---\n\nUse TimeKeeper.\n";
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const rootDir = await fs.mkdtemp(join(tmpdir(), "timekeeper-screenpipe-install-"));
  directories.push(rootDir);
  const sourceDir = join(rootDir, "integrations", "screenpipe", "timekeeper");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(join(sourceDir, "SKILL.md"), SOURCE);
  const pipeSource = join(rootDir, "integrations", "screenpipe", "pipes", "generate-work-periods");
  await fs.mkdir(pipeSource, { recursive: true });
  await fs.writeFile(
    join(pipeSource, "pipe.md"),
    "---\nschedule: manual\nenabled: true\n---\nCall generate_history_proposals once.\n",
  );
  const screenpipeDir = join(rootDir, "screenpipe");
  const configPath = join(screenpipeDir, "mcp_servers.json");
  const skillDir = join(screenpipeDir, "skills", "timekeeper");
  const skillPath = join(skillDir, "SKILL.md");
  const log = vi.fn();
  const runWithEnv = (env, ...args) =>
    installScreenpipe({ rootDir, args: ["--screenpipe-dir", screenpipeDir, ...args], env, log });
  const run = (...args) => runWithEnv({}, ...args);
  return {
    rootDir,
    sourceDir,
    screenpipeDir,
    configPath,
    skillDir,
    skillPath,
    run,
    runWithEnv,
    output: () => log.mock.calls.flat().join("\n"),
  };
}

describe("Screenpipe integration installer", () => {
  it("registers the configured MCP port and rejects invalid ports before creating files", async () => {
    const f = await fixture();
    expect(await f.runWithEnv({ TIMEKEEPER_MCP_PORT: "4042" })).toBe(0);
    expect(JSON.parse(await fs.readFile(f.configPath, "utf8")).servers[0].url).toBe(
      "http://127.0.0.1:4042/mcp",
    );
    expect(await f.runWithEnv({ TIMEKEEPER_MCP_PORT: "4042" }, "--check")).toBe(0);
    const invalid = await fixture();
    expect(await invalid.runWithEnv({ TIMEKEEPER_MCP_PORT: "-1" })).toBe(1);
    await expect(fs.stat(invalid.screenpipeDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("registers the HTTP server and copies the canonical skill without moving the source", async () => {
    const f = await fixture();
    expect(await f.run()).toBe(0);
    expect(JSON.parse(await fs.readFile(f.configPath, "utf8"))).toEqual({
      servers: [
        {
          id: "timekeeper",
          name: "TimeKeeper",
          url: "http://127.0.0.1:3032/mcp",
          transport: "http",
          header_names: [],
          auth_mode: "headers",
          enabled: true,
          created_at: expect.any(Number),
        },
      ],
    });
    expect(await fs.readFile(f.skillPath, "utf8")).toBe(SOURCE);
    expect(await fs.readFile(join(f.sourceDir, "SKILL.md"), "utf8")).toBe(SOURCE);
    expect(await fs.readdir(f.screenpipeDir)).toEqual(["mcp_servers.json", "pipes", "skills"]);
    expect(
      await fs.readFile(join(f.screenpipeDir, "pipes", "generate-work-periods", "pipe.md"), "utf8"),
    ).toContain("schedule: manual");
    if (process.platform !== "win32")
      expect((await fs.stat(f.configPath)).mode & 0o777).toBe(0o600);
  });

  it("checks an absent destination without creating it", async () => {
    const f = await fixture();
    expect(await f.run("--check")).toBe(2);
    expect(f.output()).toContain("[pending]");
    await expect(fs.stat(f.screenpipeDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves other servers, unknown keys, skills, and files; reruns without changing bytes or timestamps", async () => {
    const f = await fixture();
    await fs.mkdir(join(f.screenpipeDir, "skills", "another"), { recursive: true });
    const other = {
      id: "another",
      name: "Another",
      url: "http://localhost:9000/mcp",
      created_at: 1,
      privateExtension: "keep",
    };
    const before = JSON.stringify({ servers: [other], custom: { keep: true } });
    await fs.writeFile(f.configPath, before, { mode: 0o640 });
    await fs.writeFile(join(f.screenpipeDir, "skills", "another", "SKILL.md"), "keep other skill");
    await fs.writeFile(join(f.screenpipeDir, "keep.db"), "keep data");
    expect(await f.run()).toBe(0);
    const config = JSON.parse(await fs.readFile(f.configPath, "utf8"));
    expect(config.servers[0]).toEqual(other);
    expect(config.custom).toEqual({ keep: true });
    const bytes = await fs.readFile(f.configPath);
    const configStat = await fs.stat(f.configPath);
    const skillStat = await fs.stat(f.skillPath);
    expect(await f.run()).toBe(0);
    expect(await f.run("--check")).toBe(0);
    expect(await fs.readFile(f.configPath)).toEqual(bytes);
    expect((await fs.stat(f.configPath)).mtimeMs).toBe(configStat.mtimeMs);
    expect((await fs.stat(f.skillPath)).mtimeMs).toBe(skillStat.mtimeMs);
    if (process.platform !== "win32")
      expect((await fs.stat(f.configPath)).mode & 0o777).toBe(0o640);
    expect(await fs.readFile(join(f.screenpipeDir, "keep.db"), "utf8")).toBe("keep data");
    expect(await fs.readFile(join(f.screenpipeDir, "skills", "another", "SKILL.md"), "utf8")).toBe(
      "keep other skill",
    );
    const backups = await fs.readdir(join(f.screenpipeDir, "timekeeper-backups"));
    expect(backups).toHaveLength(1);
    expect(
      await fs.readFile(
        join(f.screenpipeDir, "timekeeper-backups", backups[0], "mcp_servers.json"),
        "utf8",
      ),
    ).toBe(before);
  });

  it("backs up replaced files and updates only the owned entry and skill file", async () => {
    const f = await fixture();
    await fs.mkdir(f.skillDir, { recursive: true });
    await fs.writeFile(f.skillPath, "old skill", { mode: 0o600 });
    await fs.writeFile(join(f.skillDir, "notes.md"), "keep notes");
    const old = {
      servers: [
        {
          id: "timekeeper",
          name: "Old",
          transport: "stdio",
          command: "old",
          args: [],
          env: { TOKEN: "private diagnostic" },
          oauth: {},
          header_names: ["Authorization"],
          created_at: 123,
          custom: "keep",
        },
      ],
    };
    const before = JSON.stringify(old);
    await fs.writeFile(f.configPath, before);
    expect(await f.run()).toBe(0);
    const [server] = JSON.parse(await fs.readFile(f.configPath, "utf8")).servers;
    expect(server).toMatchObject({
      id: "timekeeper",
      transport: "http",
      created_at: 123,
      custom: "keep",
      header_names: [],
    });
    for (const key of ["command", "args", "env", "oauth"]) expect(server).not.toHaveProperty(key);
    expect(await fs.readFile(join(f.skillDir, "notes.md"), "utf8")).toBe("keep notes");
    const [backup] = await fs.readdir(join(f.screenpipeDir, "timekeeper-backups"));
    const backupDir = join(f.screenpipeDir, "timekeeper-backups", backup);
    expect(await fs.readFile(join(backupDir, "mcp_servers.json"), "utf8")).toBe(before);
    expect(await fs.readFile(join(backupDir, "SKILL.md"), "utf8")).toBe("old skill");
    if (process.platform !== "win32") {
      expect((await fs.stat(join(backupDir, "mcp_servers.json"))).mode & 0o777).toBe(0o600);
      expect((await fs.stat(f.skillPath)).mode & 0o777).toBe(0o600);
    }
    expect(f.output()).not.toContain("private diagnostic");
  });

  it.each(["{private diagnostic", "[]", '{"servers":{}}', '{"servers":[{"id":"x"},{"id":"x"}]}'])(
    "rejects malformed configuration before changing the installed skill: %s",
    async (before) => {
      const f = await fixture();
      await fs.mkdir(f.skillDir, { recursive: true });
      await fs.writeFile(f.skillPath, "keep skill");
      await fs.writeFile(f.configPath, before);
      expect(await f.run()).toBe(1);
      expect(await fs.readFile(f.configPath, "utf8")).toBe(before);
      expect(await fs.readFile(f.skillPath, "utf8")).toBe("keep skill");
      expect(await fs.readdir(f.screenpipeDir)).toEqual(["mcp_servers.json", "skills"]);
      expect(f.output()).not.toContain("private diagnostic");
    },
  );

  it("rejects a missing source before writing either target", async () => {
    const f = await fixture();
    await fs.rm(join(f.sourceDir, "SKILL.md"));
    expect(await f.run()).toBe(1);
    expect(await fs.readdir(f.screenpipeDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink destination without changing its target",
    async () => {
      const f = await fixture();
      await fs.mkdir(f.skillDir, { recursive: true });
      const target = join(f.rootDir, "preserve.md");
      await fs.writeFile(target, "keep target");
      await fs.symlink(target, f.skillPath);
      expect(await f.run()).toBe(1);
      expect(await fs.readFile(target, "utf8")).toBe("keep target");
      await expect(fs.stat(f.configPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("keeps an existing installer lock and performs no writes", async () => {
    const f = await fixture();
    await fs.mkdir(f.screenpipeDir);
    const lock = join(f.screenpipeDir, ".timekeeper-install.lock");
    await fs.writeFile(lock, "other installer");
    expect(await f.run()).toBe(1);
    expect(await fs.readFile(lock, "utf8")).toBe("other installer");
    expect(await fs.readdir(f.screenpipeDir)).toEqual([".timekeeper-install.lock"]);
  });

  it("restores the previous skill if committing the registration fails", async () => {
    const f = await fixture();
    await fs.mkdir(f.skillDir, { recursive: true });
    await fs.writeFile(f.skillPath, "previous skill");
    const before = JSON.stringify({ servers: [] });
    await fs.writeFile(f.configPath, before);
    const rename = fs.rename;
    const failure = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (target === f.configPath)
        throw Object.assign(new Error("private diagnostic"), { code: "EACCES" });
      return rename(source, target);
    });
    expect(await f.run()).toBe(1);
    failure.mockRestore();
    expect(await fs.readFile(f.skillPath, "utf8")).toBe("previous skill");
    expect(await fs.readFile(f.configPath, "utf8")).toBe(before);
    expect(await fs.readdir(f.skillDir)).toEqual(["SKILL.md"]);
    expect(
      (await fs.readdir(f.screenpipeDir)).some(
        (name) => name.endsWith(".tmp") || name.endsWith(".lock"),
      ),
    ).toBe(false);
    expect(f.output()).not.toContain("private diagnostic");
  });

  it("runs the actual CLI from another working directory", async () => {
    const f = await fixture();
    const result = await promisify(execFile)(
      process.execPath,
      [
        new URL("../../scripts/install-screenpipe.mjs", import.meta.url).pathname,
        "--screenpipe-dir",
        f.screenpipeDir,
      ],
      { cwd: tmpdir(), timeout: 10000 },
    );
    expect(result.stdout).toContain("[installed]");
    expect(await fs.readFile(f.skillPath, "utf8")).toContain("name: timekeeper");
    expect(JSON.parse(await fs.readFile(f.configPath, "utf8")).servers[0].id).toBe("timekeeper");
  });

  it.each(["close", "remove"])(
    "reports a sanitized error if lock cleanup cannot %s",
    async (operation) => {
      const f = await fixture();
      const lockPath = join(f.screenpipeDir, ".timekeeper-install.lock");
      const failure = Object.assign(new Error("private diagnostic"), { code: "EACCES" });
      if (operation === "remove") {
        const remove = fs.rm;
        vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
          if (path === lockPath) throw failure;
          return remove(path, options);
        });
      } else {
        const open = fs.open;
        vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          const handle = await open(...args);
          if (args[0] === lockPath) {
            const close = handle.close.bind(handle);
            vi.spyOn(handle, "close").mockImplementation(async () => {
              await close();
              throw failure;
            });
          }
          return handle;
        });
      }
      expect(await f.run()).toBe(1);
      expect(f.output()).toContain("Installer lock cleanup failed");
      expect(f.output()).not.toContain("private diagnostic");
      expect(JSON.parse(await fs.readFile(f.configPath, "utf8")).servers[0].id).toBe("timekeeper");
    },
  );

  it("preserves rollback recovery guidance if temporary-file cleanup also fails", async () => {
    const f = await fixture();
    await fs.mkdir(f.skillDir, { recursive: true });
    await fs.writeFile(f.skillPath, "previous skill");
    await fs.writeFile(f.configPath, JSON.stringify({ servers: [] }));
    const rename = fs.rename;
    let skillWrites = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (target === f.configPath || (target === f.skillPath && ++skillWrites > 1)) {
        throw Object.assign(new Error("private diagnostic"), { code: "EACCES" });
      }
      return rename(source, target);
    });
    const remove = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
      if (path.endsWith(".tmp"))
        throw Object.assign(new Error("private diagnostic"), { code: "EACCES" });
      return remove(path, options);
    });
    expect(await f.run()).toBe(1);
    expect(f.output()).toContain("rollback is incomplete");
    expect(f.output()).toContain("Restore previous files from");
    expect(f.output()).toContain("Temporary-file cleanup failed");
    expect(f.output()).not.toContain("private diagnostic");
  });

  it("shows help and rejects incomplete flags without accessing installation files", async () => {
    const log = vi.fn();
    expect(await installScreenpipe({ rootDir: "/missing", args: ["--help"], log })).toBe(0);
    expect(await installScreenpipe({ rootDir: "/missing", args: ["--screenpipe-dir"], log })).toBe(
      1,
    );
    expect(await installScreenpipe({ rootDir: "/missing", args: ["--unknown"], log })).toBe(1);
  });
});
