// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { ImportedSources } from "../../src/frontend/features/workday/components/ImportedSources/ImportedSources";
import {
  newestSources,
  type ImportedSource,
} from "../../src/frontend/features/workday/lib/importedSources";
import { frontendFixture } from "./frontend-fixture";

const { state, core } = frontendFixture();
function source(id: string, changes: Partial<ImportedSource> = {}): ImportedSource {
  return {
    id,
    workPeriodId: null,
    externalId: `external-${id}`,
    instanceId: "test-screenpipe",
    contentType: "accessibility",
    recordedAt: "2026-10-18T12:34:56.000Z",
    ingestedAt: "2026-10-18T12:35:00.000Z",
    validationStatus: "unvalidated",
    availabilityStatus: "unknown",
    ...changes,
  };
}
function records(count: number) {
  return Array.from({ length: count }, (_, index) => source(String(index + 1).padStart(3, "0")));
}
function view(sources: ImportedSource[], periods = core.periods) {
  return <ImportedSources sources={sources} periods={periods} catalogState={state} />;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows unlinked and linked saved sources when no periods are available without any API writes or reads", () => {
  const get = vi.spyOn(api, "GET");
  const post = vi.spyOn(api, "POST");
  const patch = vi.spyOn(api, "PATCH");
  render(view([source("free"), source("linked", { workPeriodId: "missing" })], []));
  expect(screen.getByText("external-free")).toBeTruthy();
  expect(screen.getByText("external-linked")).toBeTruthy();
  expect(screen.getAllByText("Not linked to a work period")).toHaveLength(2);
  expect(screen.getByText("Linked work period unavailable")).toBeTruthy();
  expect(screen.getByText("1–2 of 2 matching sources. 2 saved in TimeKeeper.")).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
});

it("paginates all references and filters unknown content types without losing unlinked sources", () => {
  const sources = records(52);
  sources[51] = source("052", { contentType: "sample" });
  render(view(sources, []));
  expect(screen.getAllByRole("row")).toHaveLength(51);
  expect(screen.queryByText("external-052")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("external-052")).toBeTruthy();
  expect(screen.getByText("51–52 of 52 matching sources. 52 saved in TimeKeeper.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Content type" }), {
    target: { value: "type:sample" },
  });
  expect(screen.getByText("1–1 of 1 matching sources. 52 saved in TimeKeeper.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("combobox", { name: "Work period link" }), {
    target: { value: "unlinked" },
  });
  expect(screen.getByText("external-052")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), {
    target: { value: "no match" },
  });
  expect(screen.getByText(/No sources match these filters/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("1–50 of 52 matching sources. 52 saved in TimeKeeper.")).toBeTruthy();
});

it("keeps type filters distinct from the all-types option even for unknown types named all or empty", () => {
  render(view([source("one", { contentType: "all" }), source("two", { contentType: "" })]));
  fireEvent.change(screen.getByRole("combobox", { name: "Content type" }), {
    target: { value: "type:all" },
  });
  expect(screen.getByText("external-one")).toBeTruthy();
  expect(screen.queryByText("external-two")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Content type" }), {
    target: { value: "type:" },
  });
  expect(screen.getByText("external-two")).toBeTruthy();
});

it("sorts newest first with a stable ID tie break and places invalid dates last", () => {
  const original = [
    source("b"),
    source("bad", { recordedAt: "invalid" }),
    source("a"),
    source("new", { recordedAt: "2026-10-19T00:00:00Z" }),
  ];
  expect(newestSources(original).map((item) => item.id)).toEqual(["new", "a", "b", "bad"]);
  expect(original.map((item) => item.id)).toEqual(["b", "bad", "a", "new"]);
  render(view(original));
  expect(screen.getByText("Recording time unavailable")).toBeTruthy();
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]!).getByText("external-new")).toBeTruthy();
  expect(within(rows[3]!).getByText("external-bad")).toBeTruthy();
});

it("retains the current page across polling updates and clamps it when records shrink", () => {
  const sources = records(101);
  const rendered = render(view(sources));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  rendered.rerender(view([...sources]));
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("external-101")).toBeTruthy();
  rendered.rerender(view(sources.slice(0, 51)));
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  rendered.rerender(view(sources.slice(0, 2)));
  expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  rendered.rerender(view(sources));
  expect(screen.getByText("Page 1 of 3")).toBeTruthy();
});

it("renders untrusted stored text as text and keeps source validation separate from availability", () => {
  const excerpt = '<img src=x onerror="alert(1)"><script>private()</script>';
  const rendered = render(
    view([
      source("text", { excerpt, validationStatus: "validated", availabilityStatus: "unavailable" }),
    ]),
  );
  fireEvent.click(screen.getByText("Source excerpt"));
  expect(screen.getByText(excerpt)).toBeTruthy();
  expect(rendered.container.querySelector("img, script")).toBeNull();
  expect(screen.getByText("Source validated")).toBeTruthy();
  expect(screen.getByText("Unavailable in Screenpipe")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), {
    target: { value: "private()" },
  });
  expect(screen.getByText("external-text")).toBeTruthy();
});

it("shows an existing period label and case without creating a duration or requiring case assignment", () => {
  render(view([source("known", { workPeriodId: core.periods[0]!.id })]));
  expect(screen.getByText(core.periods[0]!.label)).toBeTruthy();
  expect(screen.getByText(/Test client/)).toBeTruthy();
  expect(screen.getByText("Metadata only. No stored text.")).toBeTruthy();
});

it("distinguishes an empty import from filters without matches", () => {
  render(view([], []));
  expect(screen.getByText(/No sources have been imported/)).toBeTruthy();
  expect(screen.queryByText(/No sources match these filters/)).toBeNull();
});

it("shows observed app and window names and searches either field without changing period labels", () => {
  const appName = '<svg onload="private()">Editor</svg>';
  const windowName = "Draft submission.docx";
  const rendered = render(
    view([
      source("context", { appName, windowName, excerpt: "Literal source words" }),
      source("other"),
    ]),
  );
  expect(screen.getByText(`App: ${appName}`)).toBeTruthy();
  expect(screen.getByText(`Window: ${windowName}`)).toBeTruthy();
  expect(rendered.container.querySelector("svg")).toBeNull();
  for (const value of ["editor", "submission.docx", "literal source words"]) {
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), {
      target: { value },
    });
    expect(screen.getByText("external-context")).toBeTruthy();
    expect(screen.queryByText("external-other")).toBeNull();
  }
});
