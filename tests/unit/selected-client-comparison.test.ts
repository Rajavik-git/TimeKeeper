import { expect, it } from "vitest";
import { monthlyRecordedTime } from "../../src/frontend/calculations/comparison";
import { frontendFixture } from "./frontend-fixture";

function fixture() {
  const { state, core } = frontendFixture();
  state.clients.push({ ...state.clients[0], id: "other", name: "Other client" });
  state.cases.push({ ...state.cases[0], id: "other-case", clientId: "other" });
  core.periods[0].durationOverrideMs = 7200000;
  core.periods.push(
    {
      ...core.periods[0],
      id: "previous",
      startedAt: "2026-09-17T09:00:00Z",
      durationOverrideMs: 3600000,
    },
    {
      ...core.periods[0],
      id: "incomplete",
      caseId: "other-case",
      durationOverrideMs: null,
      detectedDurationMs: null,
    },
  );
  return { state, core };
}

it("compares both ranges for one client even when unrelated client time is incomplete", () => {
  const { state, core } = fixture();
  expect(monthlyRecordedTime(state, core, "2026-10-17").comparison.status).toBe("unavailable");
  const selected = monthlyRecordedTime(state, core, "2026-10-17", "client");
  expect(selected.comparison).toMatchObject({
    status: "available",
    current: 7200000,
    previous: 3600000,
  });
  expect(selected.current.roundedMinutes).toBe(120);
  expect(selected.previous.roundedMinutes).toBe(60);
  expect(selected.scopeLabel).toBe("Test client");
});

it("keeps an incomplete selected client unavailable instead of dropping its periods", () => {
  const { state, core } = fixture();
  const selected = monthlyRecordedTime(state, core, "2026-10-17", "other");
  expect(selected.comparison.status).toBe("unavailable");
  expect(selected.current.incompletePeriodIds).toEqual(["incomplete"]);
});

it("falls back to the entire workspace for a removed client", () => {
  const { state, core } = fixture();
  const selected = monthlyRecordedTime(state, core, "2026-10-17", "removed");
  expect(selected.clientId).toBeNull();
  expect(selected.scopeLabel).toBe("All clients");
  expect(selected.current.complete).toBe(false);
});

it("keeps All clients distinct from a client whose ID is the string null", () => {
  const { state, core } = fixture();
  state.clients[0].id = "null";
  state.cases[0].clientId = "null";
  const all = monthlyRecordedTime(state, core, "2026-10-17");
  expect(all.clientId).toBeNull();
  expect(all.scopeLabel).toBe("All clients");
  expect(all.comparison.status).toBe("unavailable");
  expect(monthlyRecordedTime(state, core, "2026-10-17", "null").comparison.status).toBe(
    "available",
  );
});
