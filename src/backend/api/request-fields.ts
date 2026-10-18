import { AppError } from "../application/errors.js";

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid-request", "JSON object required");
  return value as Record<string, unknown>;
}

export async function readJsonObject(context: { req: { json(): Promise<unknown> } }) {
  return jsonObject(await context.req.json());
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new AppError("invalid-request", `${name} required`);
  return value;
}

export function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new AppError("invalid-request", `${name} must be a nonnegative integer`);
  return value;
}

export function positiveIntegerId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError("invalid-request", "invalid ID");
  return id;
}
