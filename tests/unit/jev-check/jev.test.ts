import { describe, expect, test } from "vitest";
import {
  buildCaseRequest,
  buildTabChangeRequest,
  callJev,
  interpretCase,
  interpretTabChange,
  parseAllowedFields,
  permittedObservation,
  validateChoice,
} from "../../../integrations/screenpipe/jev-check/jev.ts";
import { CASES, choice } from "./fixtures.ts";

const ALL = parseAllowedFields(
  "previous_observation.text,previous_observation.window_title,observation.text,observation.window_title,candidates.reference,candidates.title",
);
const obs = {
  frameId: 1,
  timestampMs: 0,
  timestampIso: "",
  app: "chrome.exe",
  title: "Tab",
  text: "x".repeat(1000),
};

describe("allowed fields", () => {
  test("rejects empty and unsupported selections", () => {
    expect(() => parseAllowedFields("")).toThrow("empty");
    expect(() => parseAllowedFields("observation.url")).toThrow("Unsupported");
    expect(() => parseAllowedFields("observation.screenshot")).toThrow("Unsupported");
  });

  test("sends only permitted fields and truncates text", () => {
    const p = permittedObservation(obs, "observation", ALL, 600)!;
    expect(Object.keys(p).sort()).toEqual(["text", "window_title"]);
    expect(p.text.length).toBe(600);
  });

  test("observation permission does not grant previous_observation", () => {
    const only = parseAllowedFields("observation.window_title");
    expect(permittedObservation(obs, "previous_observation", only, 600)).toBeUndefined();
  });
});

describe("requests", () => {
  test("tab-change request has one choice question with yes/no/uncertain", () => {
    const r = buildTabChangeRequest("jev-latest", { window_title: "A" }, { window_title: "B" });
    expect(Object.keys(r.questions)).toEqual(["tab_change"]);
    expect(Object.keys(r.questions.tab_change.criteria)).toEqual(["yes", "no", "uncertain"]);
    expect(JSON.stringify(r)).not.toContain("frame");
  });

  test("case request uses aliases, never real IDs", () => {
    const { body, alias } = buildCaseRequest(
      "jev-latest",
      { window_title: "B" },
      CASES,
      ALL,
      "case-A",
    );
    const s = JSON.stringify(body);
    expect(s).not.toContain("case-A");
    expect(s).not.toContain("client-1");
    expect(body.state.current_candidate).toBe("candidate_0");
    expect(Object.keys(body.questions.case_selection.criteria)).toEqual([
      ...alias.values(),
      "unresolved",
    ]);
  });

  test("case request fails when a candidate has no permitted description", () => {
    expect(() =>
      buildCaseRequest("jev-latest", {}, CASES, parseAllowedFields("observation.text"), null),
    ).toThrow("no permitted description");
  });
});

describe("response validation", () => {
  const ok = {
    type: "choice",
    choice: "yes",
    probabilities: { yes: 0.8, no: 0.15, uncertain: 0.05 },
    confidence: 0.9,
  };
  test("accepts a valid answer", () =>
    expect(validateChoice(ok, ["yes", "no", "uncertain"])).toBeNull());
  test("rejects unknown choice", () =>
    expect(validateChoice({ ...ok, choice: "maybe" }, ["yes", "no", "uncertain"])).toBe(
      "choice not in criteria",
    ));
  test("rejects bad sum", () =>
    expect(
      validateChoice({ ...ok, probabilities: { yes: 0.8, no: 0.8, uncertain: 0 } }, [
        "yes",
        "no",
        "uncertain",
      ]),
    ).not.toBeNull());
  test("rejects choice that is not highest", () =>
    expect(validateChoice({ ...ok, choice: "no" }, ["yes", "no", "uncertain"])).toBe(
      "choice not highest",
    ));
  test("rejects missing confidence", () =>
    expect(validateChoice({ ...ok, confidence: undefined }, ["yes", "no", "uncertain"])).toBe(
      "confidence",
    ));
  test("rejects non-jev model", () =>
    expect(
      interpretTabChange(
        { ...choice("tab_change", { yes: 1, no: 0, uncertain: 0 }, 1), model: "gpt" },
        0.7,
      ),
    ).toHaveProperty("error"));
});

describe("interpretation", () => {
  test("low-confidence yes becomes uncertain", () => {
    const r = interpretTabChange(
      choice("tab_change", { yes: 0.6, no: 0.3, uncertain: 0.1 }, 0.5),
      0.7,
    );
    expect(r).toMatchObject({ answer: "uncertain", reason: "low_confidence", choice: "yes" });
  });

  test("confident no stays no", () => {
    expect(
      interpretTabChange(choice("tab_change", { yes: 0.02, no: 0.97, uncertain: 0.01 }, 0.95), 0.7),
    ).toMatchObject({ answer: "no" });
  });

  test("case alias maps back to the real case", () => {
    const { alias } = buildCaseRequest("jev-latest", { window_title: "B" }, CASES, ALL, null);
    const r = interpretCase(
      choice("case_selection", { candidate_0: 0.01, candidate_1: 0.98, unresolved: 0.01 }, 0.97),
      alias,
      CASES,
      0.7,
    );
    expect(r).toMatchObject({
      status: "proposal",
      case_id: "case-C",
      client_id: "client-2",
      reference: "LEF-2026-003",
    });
  });

  test("unresolved selection is not a proposal", () => {
    const { alias } = buildCaseRequest("jev-latest", { window_title: "B" }, CASES, ALL, null);
    const r = interpretCase(
      choice("case_selection", { candidate_0: 0.01, candidate_1: 0.01, unresolved: 0.98 }, 0.97),
      alias,
      CASES,
      0.7,
    );
    expect(r).toMatchObject({ status: "unresolved", reason: "no_unique_candidate" });
  });
});

describe("HTTP call", () => {
  test("maps 401 to authentication failure without retrying", async () => {
    let calls = 0;
    const r = await callJev({}, "k", (async () => {
      calls++;
      return new Response("nope", { status: 401 });
    }) as Record<string, unknown>);
    expect(r).toMatchObject({ ok: false, error: "authentication failure" });
    expect(calls).toBe(1);
  });

  test("sends bearer auth and no redirects", async () => {
    let init: Record<string, unknown>;
    await callJev({ a: 1 }, "secret", (async (_u: string, i: Record<string, unknown>) => {
      init = i;
      return Response.json({});
    }) as Record<string, unknown>);
    expect(init.headers.Authorization).toBe("Bearer secret");
    expect(init.redirect).toBe("error");
  });

  test("times out", async () => {
    const slow = ((_u: string, i: Record<string, unknown>) =>
      new Promise((_, rej) =>
        i.signal.addEventListener("abort", () =>
          rej(Object.assign(new Error("x"), { name: "AbortError" })),
        ),
      )) as Record<string, unknown>;
    expect(await callJev({}, "k", slow, 20)).toMatchObject({ ok: false, error: "timeout" });
  });
});

describe("provider failure retry classification", () => {
  test.each([
    [400, false],
    [401, false],
    [403, false],
    [422, false],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
  ])("HTTP %s retryable=%s", async (status, retryable) => {
    const fetcher = (async () => Response.json({}, { status })) as typeof fetch;
    expect(await callJev({}, "fake-test-key", fetcher)).toMatchObject({ ok: false, retryable });
  });

  test("invalid JSON after successful response is terminal", async () => {
    const fetcher = (async () => new Response("{invalid", { status: 200 })) as typeof fetch;
    expect(await callJev({}, "fake-test-key", fetcher)).toMatchObject({
      ok: false,
      error: "malformed response: JSON",
      retryable: false,
    });
  });

  test("network failures remain retryable", async () => {
    const fetcher = (async () => {
      throw new TypeError("connection failed");
    }) as typeof fetch;
    expect(await callJev({}, "fake-test-key", fetcher)).toMatchObject({
      ok: false,
      retryable: true,
    });
  });
});
