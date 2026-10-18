import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../../integrations/screenpipe/jev-check/check.js";
import {
  formatCheckLog,
  safeCheckResult,
} from "../../../integrations/screenpipe/jev-check/logging.js";
import { parseWatchLog } from "../../../src/mcp/tab-detection.js";

const sensitive = "PrivateClient https://private.example/document secret-key";
const result: CheckResult = {
  checked_at: "2026-10-18T08:00:00Z",
  status: "checked",
  detection: "focus_change",
  previous: { ts: "2026-10-18T07:59:00Z", frame_id: 1, app: sensitive, window_title: sensitive },
  current: { ts: "2026-10-18T08:00:00Z", frame_id: 2, app: sensitive, window_title: sensitive },
  transition_at: "2026-10-18T08:00:00Z",
  passed_through: [sensitive],
  tab_change: {
    answer: "yes",
    choice: "yes",
    confidence: 0.9,
    model: sensitive,
    probabilities: { yes: 1 },
  },
  assignment: {
    status: "proposal",
    case_id: sensitive,
    client_id: sensitive,
    reference: sensitive,
    title: sensitive,
    probability: 0.95,
    confidence: 0.91,
    model: sensitive,
  },
  error: sensitive,
  still_current: true,
  display_proposal: true,
  applied: false,
  requests: [{ text: sensitive, authorization: sensitive }],
};

describe("private watcher diagnostics", () => {
  it("omits captured content, labels, URLs, raw IDs, request payloads and error bodies", () => {
    const json = JSON.stringify(safeCheckResult(result));
    const log = formatCheckLog(result);
    for (const output of [json, log]) {
      expect(output).not.toContain("PrivateClient");
      expect(output).not.toContain("private.example");
      expect(output).not.toContain("secret-key");
      expect(output).not.toContain("authorization");
    }
    expect(safeCheckResult(result)).toMatchObject({
      previous: { frame_id: 1 },
      current: { frame_id: 2 },
      assignment: {
        status: "proposal",
        confidence: 0.91,
        case_id_hash: expect.stringMatching(/^[a-f0-9]{16}$/),
      },
    });
    expect(parseWatchLog(log).checks).toEqual([
      {
        checkedAt: "2026-10-18T08:00:00.000Z",
        status: "checked",
        tabChange: "yes confidence=0.9",
        assignment: "proposal confidence=0.91",
      },
    ]);
  });
  it("redacts legacy fields and arbitrary event or status suffixes", () => {
    const log = `[2026-10-18T08:00:00Z] status=error error=${sensitive}\n  current: ${sensitive}\n  timekeeper: ${sensitive}\n[2026-10-18T08:01:00Z] ${sensitive}`;
    const parsed = JSON.stringify(parseWatchLog(log));
    expect(parsed).not.toContain(sensitive);
    expect(parsed).toContain("event-redacted");
    expect(parsed).toContain("[redacted]");
  });
});
