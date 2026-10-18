import type { ErrorHandler } from "hono";
import { AppError } from "../application/errors.js";

/** Drizzle wraps driver failures. Inspect their cause without exposing SQL or parameters. */
function sqliteError(error: Error): Error | undefined {
  const visited = new Set<Error>();
  let current: unknown = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if ("code" in current && current.code === "ERR_SQLITE_ERROR") return current;
    current = current.cause;
  }
  return undefined;
}

const applicationStatuses = {
  "not-found": 404,
  "no-active-session": 404,
  "rule-not-decided": 409,
  "forbidden-origin": 403,
  conflict: 409,
  "invalid-request": 400,
} as const;

export const apiError: ErrorHandler = (error, c) => {
  if (error instanceof AppError)
    return c.json({ error: error.code, message: error.message }, applicationStatuses[error.code]);
  const storageError = sqliteError(error);
  if (storageError) {
    if (
      /^(UNIQUE|FOREIGN KEY|overlapping periods|period outside session|source target owner mismatch|target has aliases)/.test(
        storageError.message,
      )
    )
      return c.json({ error: "conflict", message: "storage constraint conflict" }, 409);
    if (
      /^(CHECK|NOT NULL) constraint failed/.test(storageError.message) ||
      /^[a-z_]+ (?:extension|value) constraint$/.test(storageError.message)
    )
      return c.json(
        { error: "invalid-request", message: "storage constraint rejected input" },
        400,
      );
  }
  return c.json({ error: "internal", message: "internal error" }, 500);
};
