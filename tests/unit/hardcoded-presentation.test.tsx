// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaseBillingMode, SystemTaskCode } from "../../src/contracts/states.generated";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import {
  isBudgetWarning,
  budgetWarningMessage,
  BUDGET_WARNING_PERCENT,
} from "../../src/frontend/calculations/case-budget";
import { visibleValue } from "../../src/frontend/features/cases/lib/casePresentation";
import { TaskEditorDialog } from "../../src/frontend/features/settings/components/TaskEditorDialog/TaskEditorDialog";
import { RulesSection } from "../../src/frontend/features/settings/components/RulesSection/RulesSection";
import { currencyAmount } from "../../src/frontend/features/settings/lib/sectionPresentation";
import { rate } from "../../src/frontend/shared/format";
import {
  DEFAULT_DAILY_RESEARCH_CAP_MINUTES,
  DEFAULT_DAILY_RESEARCH_CAP_UNITS,
  researchCapMinutes,
  researchCapUnits,
} from "../../src/shared/client-rule-policy";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const action: ScreenProps["action"] = async (promise) => (await promise).data;

it("preserves fractional cents in hourly rates and Settings amounts", () => {
  const { state } = frontendFixture();
  expect(rate(12550, "USD")).toBe("$125.50/h");
  expect(currencyAmount(state, 12550)).toBe("$125.50");
});
it.each(["Firm [France]", "[Building A] 4 Main Street", "N/A", "[CASE-42]"])(
  "keeps entered text visible: %s",
  (value) => {
    expect(visibleValue(value)).toBe(true);
  },
);
it.each([null, undefined, "", "   "])("hides only empty values: %s", (value) => {
  expect(visibleValue(value)).toBe(false);
});
it("uses the precise shared budget warning threshold and text", () => {
  expect(isBudgetWarning(84.999)).toBe(false);
  expect(isBudgetWarning(BUDGET_WARNING_PERCENT)).toBe(true);
  expect(isBudgetWarning(null)).toBe(false);
  expect(budgetWarningMessage(CaseBillingMode.FlatFee)).toContain("85% of the agreed flat fee");
  expect(budgetWarningMessage(CaseBillingMode.Hourly)).toContain("85%");
});
it("shows the shared research default and saves it in API units", async () => {
  const { state } = frontendFixture();
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: {} } as never);
  render(
    <RulesSection
      catalogState={state}
      action={action}
      saved={async (operation) => {
        await operation;
        return true;
      }}
      notify={vi.fn()}
      navigate={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  expect(
    (screen.getByRole("spinbutton", { name: "Research minutes per day" }) as HTMLInputElement)
      .value,
  ).toBe(String(DEFAULT_DAILY_RESEARCH_CAP_MINUTES));
  fireEvent.click(screen.getAllByRole("button", { name: "Add rule" }).at(-1)!);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/catalog/client-rules",
      expect.objectContaining({
        body: expect.objectContaining({ value: DEFAULT_DAILY_RESEARCH_CAP_UNITS }),
      }),
    ),
  );
  expect(researchCapMinutes(DEFAULT_DAILY_RESEARCH_CAP_UNITS)).toBe(
    DEFAULT_DAILY_RESEARCH_CAP_MINUTES,
  );
  expect(researchCapUnits(DEFAULT_DAILY_RESEARCH_CAP_MINUTES)).toBe(
    DEFAULT_DAILY_RESEARCH_CAP_UNITS,
  );
});
it.each([SystemTaskCode.Research, SystemTaskCode.Travel, "CUSTOM"])(
  "protects built-in task codes while custom codes remain editable: %s",
  async (code) => {
    const task = {
      id: 42,
      code,
      label: "Original label",
      billableByDefault: true,
      offScreen: false,
    };
    const patch = vi.spyOn(api, "PATCH").mockResolvedValue({ data: task } as never);
    render(<TaskEditorDialog task={task} action={action} notify={vi.fn()} close={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Task code" }) as HTMLInputElement;
    expect(input.readOnly).toBe(code !== "CUSTOM");
    if (!input.readOnly) fireEvent.change(input, { target: { value: "CUSTOM2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Task label" }), {
      target: { value: "Renamed label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        "/api/catalog/task-types/{id}",
        expect.objectContaining({
          body: expect.objectContaining({
            code: code === "CUSTOM" ? "CUSTOM2" : code,
            label: "Renamed label",
          }),
        }),
      ),
    );
  },
);
