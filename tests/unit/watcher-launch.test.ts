import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { launchWatcherWmi } from "../../src/mcp/watcher-launch.js";
import { workflowEnvironment } from "../../integrations/screenpipe/jev-check/environment.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function requestFixture() {
  const directory = mkdtempSync(join(tmpdir(), "timekeeper-launch-"));
  directories.push(directory);
  return {
    node: process.execPath,
    directory,
    apiBase: "http://127.0.0.1:8787/api",
    log: join(directory, "watch.log"),
    environment: {
      TYPESAFE_API_KEY: "private-fixture-key",
      JEV_ALLOWED_FIELDS: "observation.app_name",
      MAX_TEXT_CHARS: "123",
    },
  };
}

function fakePowershell(exitCode = 0) {
  const child = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr, kill: vi.fn(() => true) });
  let input = "";
  stdin.on("data", (chunk) => {
    input += String(chunk);
  });
  const run = vi.fn(() => {
    queueMicrotask(() => {
      stdout.write("12345\n");
      stderr.write("untrusted failure private-fixture-key");
      child.emit("close", exitCode);
    });
    return child;
  });
  return { run, input: () => input };
}

it("passes validated WMI configuration over stdin without credentials in command arguments", async () => {
  const request = requestFixture();
  const fake = fakePowershell();
  expect((await launchWatcherWmi(request, fake.run)).pid).toBe(12345);
  const [command, args] = fake.run.mock.calls[0] as unknown as [string, string[]];
  expect(command).toBe("powershell.exe");
  expect(args.join(" ")).not.toContain(request.environment.TYPESAFE_API_KEY);
  expect(args.join(" ")).not.toContain(request.environment.JEV_ALLOWED_FIELDS);
  expect(args.join(" ")).toContain("EnvironmentVariables = $variables");
  expect(JSON.parse(fake.input()).environment).toEqual(request.environment);
});

it("does not return raw launch diagnostics", async () => {
  const fake = fakePowershell(1);
  await expect(launchWatcherWmi(requestFixture(), fake.run)).rejects.toThrow(
    "Watcher process creation failed.",
  );
});

it("uses the same dotenv parsing and explicit inherited overrides for launcher and watcher", () => {
  const request = requestFixture();
  writeFileSync(
    join(request.directory, ".env"),
    'TYPESAFE_API_KEY="local key"\nJEV_ALLOWED_FIELDS=observation.text\n',
  );
  expect(workflowEnvironment(request.directory, { JEV_ALLOWED_FIELDS: "" })).toEqual({
    TYPESAFE_API_KEY: "local key",
    JEV_ALLOWED_FIELDS: "",
  });
});
