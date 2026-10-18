import { describe, expect, it } from "vitest";
import { mcpHttpConfig } from "../../src/mcp/runtime-config.js";
import { linkFromEnv } from "../../src/mcp/config.js";
import { checkSettings } from "../../integrations/screenpipe/jev-check/config.js";

describe("integration configuration", () => {
  it("uses the same validated MCP port for environment and command-line configuration", () => {
    expect(mcpHttpConfig({})).toEqual({ port: 3032, url: "http://127.0.0.1:3032/mcp" });
    expect(mcpHttpConfig({ TIMEKEEPER_MCP_PORT: "4042" })).toEqual({
      port: 4042,
      url: "http://127.0.0.1:4042/mcp",
    });
    expect(mcpHttpConfig({ TIMEKEEPER_MCP_PORT: "4042" }, "5052").port).toBe(5052);
    for (const port of ["0", "-1", "65536", "1.5", "NaN", "Infinity", "not-a-port"])
      expect(() => mcpHttpConfig({ TIMEKEEPER_MCP_PORT: port })).toThrow("TIMEKEEPER_MCP_PORT");
  });

  it("validates duration and text settings and preserves explicitly permitted zero values", () => {
    expect(checkSettings({})).toEqual({
      windowMinutes: 5,
      stabilityMs: 10_000,
      maxTextChars: 600,
      minConfidence: 0.7,
    });
    expect(checkSettings({ JEV_MIN_CONFIDENCE: "0" }).minConfidence).toBe(0);
    expect(checkSettings({ JEV_MIN_CONFIDENCE: "1" }).minConfidence).toBe(1);
    expect(checkSettings({ WINDOW_MINUTES: "5" }, "2.5").windowMinutes).toBe(2.5);
    expect(linkFromEnv({ TIMEKEEPER_LINK_GRACE_SECONDS: "0" }).deps.graceMs).toBe(0);

    for (const name of ["WINDOW_MINUTES", "STABILITY_SECONDS", "MAX_TEXT_CHARS"])
      for (const value of ["0", "-1", "NaN", "Infinity"])
        expect(() => checkSettings({ [name]: value })).toThrow(name);
    expect(() => checkSettings({ MAX_TEXT_CHARS: "1.5" })).toThrow("MAX_TEXT_CHARS");
    for (const value of ["-0.1", "1.1", "NaN", "Infinity"])
      expect(() => checkSettings({ JEV_MIN_CONFIDENCE: value })).toThrow("JEV_MIN_CONFIDENCE");
    for (const value of ["-1", "NaN", "Infinity"])
      expect(() => linkFromEnv({ TIMEKEEPER_LINK_GRACE_SECONDS: value })).toThrow(
        "TIMEKEEPER_LINK_GRACE_SECONDS",
      );
  });
});
