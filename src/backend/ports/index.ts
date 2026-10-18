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
