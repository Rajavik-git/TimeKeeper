import { Hono } from "hono";
import { ScreenpipeAuthError, ScreenpipeUnavailableError } from "../adapters/screenpipe/http.js";
import { AppError } from "../application/errors.js";
import type { ScreenpipeReader } from "../ports/index.js";
import type { components } from "../../contracts/generated.js";
import { apiError } from "./errors.js";

type FocusResult = components["schemas"]["ScreenpipeFocus"];
type FramesResult = components["schemas"]["ScreenpipeFrames"];
type ScreenpipeIssue = Extract<FocusResult, { message: string }>;

/**
 * How recent an observation must be to count as the current window. Screenpipe can take
 * 30-60 s to make a capture searchable, so a shorter window would miss late-indexed frames.
 */
const focusWindowMs = 120_000;
/** Polling clients share one Screenpipe read per interval. */
const cacheMs = 1_000;
const maxFrameRangeMs = 24 * 3_600_000;

/** Screenpipe failures as a state the UI can show, or null for other errors. */
function screenpipeIssue(error: unknown): ScreenpipeIssue | null {
  if (error instanceof ScreenpipeAuthError)
    return {
      status: "unauthorized",
      message: "Screenpipe refused the request. Set SCREENPIPE_API_KEY.",
    };
  if (error instanceof ScreenpipeUnavailableError)
    return { status: "unavailable", message: "Screenpipe is not running or not reachable." };
  return null;
}

async function readFocus(screenpipe: ScreenpipeReader): Promise<FocusResult> {
  try {
    return { status: "ok", focus: await screenpipe.latestFocus(focusWindowMs) };
  } catch (error) {
    const issue = screenpipeIssue(error);
    if (issue) return issue;
    throw error;
  }
}

function instant(value: string | undefined, name: string): number {
  const at = Date.parse(value ?? "");
  if (!value || !Number.isFinite(at))
    throw new AppError("invalid-request", `${name} must be an ISO timestamp`);
  return at;
}

function frameLimit(value: string | undefined): number {
  if (value === undefined) return 100;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new AppError("invalid-request", "limit must be between 1 and 200");
  return limit;
}

/**
 * Screenpipe owns window detection and recordings (docs/SCREENPIPE_INTEGRATION.md). These routes
 * read them for the desk pill and Activity previews; Screenpipe's key never leaves the server.
 */
export function screenpipeRoutes(screenpipe: ScreenpipeReader): Hono {
  const routes = new Hono();
  routes.onError(apiError);
  let cached: { at: number; result: Promise<FocusResult> } | null = null;
  routes.get("/screenpipe/focus", async (c) => {
    if (!cached || Date.now() - cached.at > cacheMs)
      cached = { at: Date.now(), result: readFocus(screenpipe) };
    return c.json(await cached.result);
  });
  routes.get("/screenpipe/frames", async (c) => {
    const start = instant(c.req.query("start"), "start");
    const end = instant(c.req.query("end"), "end");
    if (start >= end) throw new AppError("invalid-request", "start must be before end");
    if (end - start > maxFrameRangeMs)
      throw new AppError("invalid-request", "the range must not exceed 24 hours");
    const limit = frameLimit(c.req.query("limit"));
    let result: FramesResult;
    try {
      const frames = await screenpipe.frames(
        new Date(start).toISOString(),
        new Date(end).toISOString(),
        limit,
      );
      result = { status: "ok", frames };
    } catch (error) {
      const issue = screenpipeIssue(error);
      if (!issue) throw error;
      result = issue;
    }
    return c.json(result);
  });
  routes.get("/screenpipe/frames/:frameId/image", async (c) => {
    const frameId = c.req.param("frameId");
    if (!/^[0-9]+$/.test(frameId))
      throw new AppError("invalid-request", "frameId must be a number");
    try {
      const image = await screenpipe.frameImage(frameId);
      if (!image) return c.json({ error: "not-found", message: "frame not found" }, 404);
      return c.body(image.body, 200, {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=300",
      });
    } catch (error) {
      const issue = screenpipeIssue(error);
      if (!issue) throw error;
      const message =
        issue.status === "unauthorized" ? "Screenpipe refused the request" : issue.message;
      return c.json({ error: "unavailable", message }, 503);
    }
  });
  return routes;
}
