import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import type { FormatsPlugin } from "ajv-formats";
import type { MiddlewareHandler } from "hono";
import { requestContract } from "../../contracts/request-contract.generated.js";
import { AppError } from "../application/errors.js";

const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;

type Schema = Record<string, unknown>;
type Operation = {
  requestBody?: { required?: boolean; content: { "application/json": { schema: Schema } } };
};
const ajv = new Ajv2020({ strict: false, allErrors: false });
addFormats(ajv, { mode: "full" });
const operations = Object.entries(requestContract.paths).flatMap(([path, methods]) =>
  Object.entries(methods).flatMap(([method, operation]) => {
    const schema = (operation as Operation).requestBody?.content["application/json"].schema;
    if (!schema) return [];
    const ref = schema.$ref as string | undefined;
    const resolved = ref
      ? (requestContract.components.schemas as unknown as Record<string, Schema>)[
          ref.split("/").at(-1)!
        ]
      : schema;
    return [
      {
        method: method.toUpperCase(),
        optional: (operation as Operation).requestBody?.required === false,
        path: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}/?$`),
        validate: ajv.compile({ ...schema, components: requestContract.components }),
        empty:
          Array.isArray(resolved.required) &&
          resolved.required.length === 0 &&
          Object.keys((resolved.properties as object) ?? {}).length === 0,
      },
    ];
  }),
);

/** Validate before routing. Hono caches the parsed JSON for route handlers. */
export const validateRequest: MiddlewareHandler = async (c, next) => {
  const operation = operations.find(
    (item) => item.method === c.req.method && item.path.test(c.req.path),
  );
  if (operation) {
    const raw = await c.req.text();
    if (!raw && (operation.empty || operation.optional)) return next();
    if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      throw new AppError("invalid-request", "application/json required");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new AppError("invalid-request", "invalid JSON object");
    }
    if (!operation.validate(body))
      throw new AppError("invalid-request", "request does not match the API contract");
  }
  await next();
};
