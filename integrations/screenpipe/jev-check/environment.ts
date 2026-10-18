import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** Both the launcher and watcher use these literal settings and the same precedence. */
export function workflowEnvironment(
  directory: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  let local: NodeJS.ProcessEnv = {};
  try {
    local = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error("The watcher configuration could not be read.");
    }
  }
  return { ...local, ...inherited };
}
