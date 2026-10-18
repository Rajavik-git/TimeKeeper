import type { EndCommand, StartCommand } from "../../contracts/index.js";

export interface Clock {
  now(): string;
}
export interface MemoryObservation {
  instanceId: string;
  contentType: string;
  externalId: string;
  recordedAt: string;
  appName?: string;
  windowName?: string;
  url?: string;
}
export interface ScreenpipeMemory {
  read(startAt: string, endAt: string): Promise<MemoryObservation[]>;
}
/** The newest window Screenpipe recorded. Titles are untrusted screen content. */
export interface WindowFocus {
  appName: string;
  windowTitle: string;
  url: string | null;
  recordedAt: string;
}
/** One recorded screen frame. Screen text is never part of it. */
export interface ScreenpipeFrame {
  frameId: string;
  recordedAt: string;
  appName: string;
  windowTitle: string;
}
export interface FrameImage {
  contentType: string;
  body: ArrayBuffer;
}
/** Read-only access to Screenpipe's recorded activity (docs/SCREENPIPE_INTEGRATION.md). */
export interface ScreenpipeReader {
  /** The window Screenpipe recorded most recently within `withinMs`. */
  latestFocus(withinMs: number): Promise<WindowFocus | null>;
  /** Frames recorded in [startAt, endAt], oldest first, at most `limit`. */
  frames(startAt: string, endAt: string, limit: number): Promise<ScreenpipeFrame[]>;
  /** The recorded screenshot, or null when Screenpipe no longer has it. */
  frameImage(frameId: string): Promise<FrameImage | null>;
}
export interface TagSnapshot {
  instanceId: string;
  targetType: string;
  targetId: string;
  tags: string[];
}
export interface SourceTags {
  read(instanceId: string, targetType: string, targetId: string): Promise<TagSnapshot>;
  reconcile(target: TagSnapshot, desiredTags: string[]): Promise<void>;
}
// Delivery while the backend is closed remains open: docs/REQUIREMENTS.md.
export interface CommandInbox {
  receiveStart(command: StartCommand): Promise<void>;
  receiveEnd(command: EndCommand): Promise<void>;
}
