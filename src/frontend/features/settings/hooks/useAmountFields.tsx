import { useRef, useState } from "react";
import { parseAmount } from "../../../shared/lib/amount";

export function useAmountFields() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const setFieldError = (key: string, message: string) =>
    setErrors((old) => ({ ...old, [key]: message }));
  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="settings-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
  const commitAmount = async (
    key: string,
    value: string,
    current: number | null,
    patch: (next: number | null) => Promise<boolean>,
    nullable = true,
  ) => {
    const parsed = parseAmount(value, nullable);
    if (!parsed.valid) {
      setFieldError(key, "Enter a non-negative amount (up to two decimal places).");
      return;
    }
    if (pending.current.has(key)) return;
    setFieldError(key, "");
    if (parsed.cents === current) return;
    pending.current.add(key);
    try {
      if (!(await patch(parsed.cents))) {
        setFieldError(key, "Could not save. Your entered amount is kept. Press Enter to retry.");
      }
    } catch {
      setFieldError(key, "Could not save. Your entered amount is kept. Press Enter to retry.");
    } finally {
      pending.current.delete(key);
    }
  };
  return { setFieldError, fieldError, commitAmount };
}
