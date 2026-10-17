export type AppErrorCode = 'invalid-request' | 'not-found' | 'no-active-session' | 'conflict' | 'rule-not-decided';

const codes: readonly AppErrorCode[] = ['invalid-request', 'not-found', 'no-active-session', 'conflict', 'rule-not-decided'];
export const isAppErrorCode = (value: unknown): value is AppErrorCode => codes.includes(value as AppErrorCode);

/** An expected refusal that the API reports with its code. Any other thrown value is an internal error. */
export class AppError extends Error {
  constructor(readonly code: AppErrorCode, message: string) { super(message); }
}
