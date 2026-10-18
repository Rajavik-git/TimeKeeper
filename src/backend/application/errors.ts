export class AppError extends Error {
  constructor(
    readonly code: "no-active-session" | "not-found" | "conflict" | "pending" | "invalid-request",
    message: string,
  ) {
    super(message);
  }
}
