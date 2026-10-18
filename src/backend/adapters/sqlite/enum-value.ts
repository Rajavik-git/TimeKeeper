import { AppError } from "../../application/errors.js";
import { isState } from "../../domain/states.js";
/** SQLite affinity and historical data cannot establish a business enum's type. */
export function enumValue<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  field = "state",
): Values[number] {
  if (!isState(value, allowed))
    throw new AppError(
      "conflict",
      `Stored ${field} is unsupported; repair this record before continuing`,
    );
  return value;
}
