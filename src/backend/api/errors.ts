import type { ErrorHandler } from "hono";
import { AppError } from "../application/service.js";

// Compatibility services use these fixed messages for expected business failures.
const invalidOperation =
  /^(?:.+ is required|Billed work period cannot be .+|Block cannot be .+|Case and duration required for approval|Invalid duration|Expense already billed|Case reference is immutable|Client code must be uppercase letters or digits|Invalid type|No periods in source pack scope|Invoice required|Date range required|Period selection required)$/;

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

export const apiError: ErrorHandler = (error, c) => {
  if (error instanceof AppError)
    return c.json(
      { error: error.code, message: error.message },
      error.code === "not-found" || error.code === "no-active-session"
        ? 404
        : error.code === "pending"
          ? 202
          : error.code === "conflict"
            ? 409
            : 400,
    );
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
      /^[a-z_]+ extension constraint$/.test(storageError.message)
    )
      return c.json(
        { error: "invalid-request", message: "storage constraint rejected input" },
        400,
      );
  }
  if (error.message === "Not found")
    return c.json({ error: "not-found", message: "resource not found" }, 404);
  if (invalidOperation.test(error.message))
    return c.json({ error: "invalid-request", message: "operation rejected" }, 400);
  return c.json({ error: "internal", message: "internal error" }, 500);
};
