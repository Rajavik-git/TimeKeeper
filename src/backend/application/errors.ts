export class AppError extends Error {
  constructor(
    readonly code:
      | "no-active-session"
      | "not-found"
      | "conflict"
      | "rule-not-decided"
      | "forbidden-origin"
      | "invalid-request",
    message: string,
  ) {
    super(message);
  }
}
