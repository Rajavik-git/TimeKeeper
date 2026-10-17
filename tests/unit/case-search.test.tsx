// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type Client, type Case } from "../../src/frontend/api/client";
import { CaseSearch } from "../../src/frontend/features/cases/CaseSearch";
import { useRecentCases } from "../../src/frontend/features/cases/useRecentCases";
import { frontendFixture } from "./frontend-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function setup() {
  const { state, core } = frontendFixture();
  const onSelectClient = vi.fn();
  const onSelectCase = vi.fn();
  render(
    <CaseSearch
      catalogState={state}
      workspaceState={core}
      recentIds={[]}
      attentionRows={[]}
      onSelectClient={onSelectClient}
      onSelectCase={onSelectCase}
    />,
  );
  return { state, onSelectClient, onSelectCase, input: screen.getByRole("searchbox") };
}

type SearchResponse = { data: { clients: Client[]; cases: Case[] }; response: Response };
function deferredSearch() {
  let resolve!: (response: SearchResponse) => void;
  const promise = new Promise<SearchResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("ignores a stale search response and selects the latest result with the keyboard", async () => {
  vi.useFakeTimers();
  const earlier = deferredSearch();
  const latest = deferredSearch();
  const get = vi
    .spyOn(api, "GET")
    .mockReturnValueOnce(earlier.promise)
    .mockReturnValueOnce(latest.promise);
  const { state, input, onSelectCase } = setup();
  fireEvent.change(input, { target: { value: "Earlier" } });
  await act(async () => vi.advanceTimersByTimeAsync(120));
  fireEvent.change(input, { target: { value: "Latest" } });
  expect(get.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(120));
  const selected = { ...state.cases[0], title: "Latest case" };
  await act(async () =>
    latest.resolve({ data: { clients: [], cases: [selected] }, response: new Response() }),
  );
  await act(async () =>
    earlier.resolve({
      data: { clients: [], cases: [{ ...selected, title: "Earlier case" }] },
      response: new Response(),
    }),
  );
  expect(screen.queryByText("Earlier case")).toBeNull();
  expect(screen.getByRole("option").textContent).toContain("Latest case");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelectCase).toHaveBeenCalledWith(selected);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("supports pointer selection and closes suggestions with Escape or an outside click", () => {
  const { state, input, onSelectCase } = setup();
  fireEvent.focus(input);
  fireEvent.click(screen.getAllByRole("option")[0]);
  expect(onSelectCase).toHaveBeenCalledWith(state.cases[0]);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.focus(input);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("shows search failures without treating them as an empty result", async () => {
  vi.useFakeTimers();
  vi.spyOn(api, "GET").mockRejectedValue(Error("API unavailable"));
  const { input } = setup();
  fireEvent.change(input, { target: { value: "Client" } });
  await act(async () => vi.advanceTimersByTimeAsync(120));
  expect(screen.getByRole("alert").textContent).toContain("Could not search");
  expect(screen.queryByText(/No client or case matches/)).toBeNull();
});

it("deduplicates equivalent numeric and string recent-case IDs and keeps the latest three", () => {
  const { result } = renderHook(useRecentCases);
  act(() => {
    result.current.rememberCase(1);
    result.current.rememberCase("second");
    result.current.rememberCase("1");
    result.current.rememberCase("third");
  });
  expect(result.current.recentIds).toEqual(["third", "1", "second"]);
  act(() => result.current.rememberCase("fourth"));
  expect(JSON.parse(localStorage.getItem("timekeeper-recent-cases")!)).toEqual([
    "fourth",
    "third",
    "1",
  ]);
});
