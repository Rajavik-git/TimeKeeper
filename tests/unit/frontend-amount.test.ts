import { expect, it } from "vitest";
import { parseAmount } from "../../src/frontend/shared/lib/amount";

it("clears nullable rates and budgets while preserving an explicit zero", () => {
  expect(parseAmount("  ", true)).toEqual({ valid: true, cents: null });
  expect(parseAmount("0", true)).toEqual({ valid: true, cents: 0 });
  expect(parseAmount("12,50", true)).toEqual({ valid: true, cents: 1250 });
});

it("rejects empty required amounts, invalid precision, negatives and unsafe integers", () => {
  for (const input of ["", "-1", "1.001", "1e3", "NaN", "9007199254740992"]) {
    expect(parseAmount(input, false)).toEqual({ valid: false });
  }
});
