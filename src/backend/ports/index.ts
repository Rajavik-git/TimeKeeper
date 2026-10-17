import type { EndCommand, StartCommand } from '../../contracts/index.js';

export interface Clock { now(): string }
export interface MemoryObservation {
  instanceId: string; contentType: string; externalId: string; recordedAt: string;
  appName?: string; windowName?: string; url?: string;
}
export interface ScreenpipeMemory { read(startAt: string, endAt: string): Promise<MemoryObservation[]> }
export interface TagSnapshot { instanceId: string; targetType: string; targetId: string; tags: string[] }
export interface SourceTags {
  read(instanceId: string, targetType: string, targetId: string): Promise<TagSnapshot>;
  reconcile(target: TagSnapshot, desiredTags: string[]): Promise<void>;
}
/** One command file found in the local inbox folder (docs/API.md D8). */
export interface InboxFile { name: string; content: string }
/** Commands written by Screenpipe pipes while TimeKeeper was closed (docs/API.md D8). */
export interface CommandInbox {
  list(): InboxFile[];
  markDone(name: string): void;
  markFailed(name: string, error: { error: string; message: string }): void;
}
export type InboxCommand = (StartCommand & { kind: 'start' }) | (EndCommand & { kind: 'end' });
