import { numberSetting } from "../../../src/mcp/runtime-config.js";

/** Validates non-secret workflow settings without loading the CLI or its environment file. */
export function checkSettings(
  env: Record<string, string | undefined>,
  windowArgument?: string,
): { windowMinutes: number; stabilityMs: number; maxTextChars: number; minConfidence: number } {
  return {
    windowMinutes: numberSetting("WINDOW_MINUTES", windowArgument ?? env.WINDOW_MINUTES, {
      defaultValue: 5,
      min: Number.EPSILON,
      // Keep the retrieval window representable as JavaScript ISO timestamps.
      max: 8_640_000_000_000_000 / 60_000,
    }),
    stabilityMs:
      numberSetting("STABILITY_SECONDS", env.STABILITY_SECONDS, {
        defaultValue: 10,
        min: Number.EPSILON,
        max: Number.MAX_SAFE_INTEGER / 1000,
      }) * 1000,
    maxTextChars: numberSetting("MAX_TEXT_CHARS", env.MAX_TEXT_CHARS, {
      defaultValue: 600,
      min: 1,
      integer: true,
    }),
    minConfidence: numberSetting("JEV_MIN_CONFIDENCE", env.JEV_MIN_CONFIDENCE, {
      defaultValue: 0.7,
      min: 0,
      max: 1,
    }),
  };
}
