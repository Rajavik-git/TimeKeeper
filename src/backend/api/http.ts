import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError, type AppErrorCode } from '../ports/errors.js';

export type ErrorCode = AppErrorCode | 'forbidden-origin' | 'internal';
export interface ErrorBody { error: ErrorCode; message: string }

const statusFor: Record<AppErrorCode, ContentfulStatusCode> = {
  'invalid-request': 400,
  'not-found': 404,
  'no-active-session': 404,
  conflict: 409,
  'rule-not-decided': 409,
};

/** SQLite reports constraint violations with primary result code 19 (SQLITE_CONSTRAINT). */
function isConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_SQLITE_ERROR' &&
    'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 0xff) === 19;
}

/** The one mapping from thrown values to API responses, shared by every route. */
export function toErrorResponse(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof AppError) return { status: statusFor[error.code], body: { error: error.code, message: error.message } };
  if (isConstraintViolation(error)) return { status: 409, body: { error: 'conflict', message: 'storage constraint conflict' } };
  // Unexpected failure: keep details in the server log only, never in the response.
  console.error('[api] internal error:', error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
  return { status: 500, body: { error: 'internal', message: 'internal error' } };
}

export function errorHandler(error: unknown, c: Context) {
  const { status, body } = toErrorResponse(error);
  return c.json(body, status);
}

/** Reads a JSON request body, reporting a malformed body as a client error instead of an internal one. */
export async function readJson<T = unknown>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  try {
    return await c.req.json() as T;
  } catch {
    throw new AppError('invalid-request', 'request body must be valid JSON');
  }
}
