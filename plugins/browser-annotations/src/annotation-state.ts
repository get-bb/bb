import type { ExperimentalBrowserCaptureDescriptor } from "@get-bb/plugin-sdk/browser";

import type {
  BrowserElementAnnotation,
  BrowserElementAnnotationIntent,
  BrowserElementAnnotationNote,
} from "./element-types";
import type { Shape, Tool } from "./BrowserScreenshotAnnotation";
import type { BrowserScreenshotEditorState } from "./contracts";

export interface BrowserAnnotationKey {
  environmentId: string | null;
  threadId: string;
  tabId: string;
}

export interface BrowserScreenshotEditorSnapshot {
  image: BrowserScreenshotEditorState["image"];
  color: string;
  fontSize: number;
  past: Shape[][];
  pendingText: BrowserScreenshotEditorState["pendingText"];
  redo: Shape[][];
  shapes: Shape[];
  tool: Tool;
  width: number;
}

export interface BrowserScreenshotSession {
  editor: BrowserScreenshotEditorSnapshot;
  screenshot: ExperimentalBrowserCaptureDescriptor;
  previewUrl: string;
}

export type BrowserElementReviewDraft =
  | {
      annotation: BrowserElementAnnotation;
      comment: string;
      intent: BrowserElementAnnotationIntent;
      kind: "new";
      screenshot: ExperimentalBrowserCaptureDescriptor | null;
      screenshotPreviewUrl: string | null;
      captureError: string | null;
    }
  | {
      comment: string;
      intent: BrowserElementAnnotationIntent;
      kind: "edit";
      noteId: string;
    };

export interface BrowserElementSession {
  notes: readonly BrowserElementAnnotationNote[];
  pageSnapshot: ExperimentalBrowserCaptureDescriptor | null;
  pageSnapshotPreviewUrl: string | null;
  review: BrowserElementReviewDraft | null;
}

export interface BrowserAnnotationRecord {
  elements: BrowserElementSession | null;
  environmentId: string | null;
  navigationEpoch: number;
  screenshot: BrowserScreenshotSession | null;
  tabId: string;
  threadId: string;
}

const records = new Map<string, BrowserAnnotationRecord>();
const epochs = new Map<string, number>();
const listeners = new Set<() => void>();
const previews = new Map<string, { storeKey: string; dispose: () => void }>();

function recordUsesPreview(storeKey: string, url: string): boolean {
  const record = records.get(storeKey);
  if (record?.screenshot?.previewUrl === url) return true;
  const elements = record?.elements;
  return (
    elements?.pageSnapshotPreviewUrl === url ||
    (elements?.review?.kind === "new" &&
      elements.review.screenshotPreviewUrl === url)
  );
}

export function retainBrowserAnnotationPreview(
  key: BrowserAnnotationKey,
  preview: { url: string; dispose: () => void },
): void {
  const storeKey = keyOf(key);
  if (recordUsesPreview(storeKey, preview.url)) {
    previews.set(preview.url, { storeKey, dispose: preview.dispose });
  } else {
    preview.dispose();
  }
}

function keyOf(key: BrowserAnnotationKey): string {
  return `${key.environmentId ?? ""}\u0000${key.threadId}\u0000${key.tabId}`;
}

function notify(): void {
  for (const [url, preview] of previews) {
    if (!recordUsesPreview(preview.storeKey, url)) {
      previews.delete(url);
      preview.dispose();
    }
  }
  for (const listener of [...listeners]) listener();
}

export function browserAnnotationSnapshot(
  key: BrowserAnnotationKey,
): BrowserAnnotationRecord | null {
  return records.get(keyOf(key)) ?? null;
}

export function subscribeBrowserAnnotationStore(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createEmptyBrowserScreenshotEditor(
  image: BrowserScreenshotEditorState["image"],
): BrowserScreenshotEditorSnapshot {
  return {
    image,
    color: "#ef4444",
    fontSize: 18,
    past: [],
    pendingText: null,
    redo: [],
    shapes: [],
    tool: "pen",
    width: 4,
  };
}

export function markBrowserAnnotationEpoch(
  key: BrowserAnnotationKey,
  navigationEpoch: number,
): void {
  epochs.set(keyOf(key), navigationEpoch);
}

export function isBrowserAnnotationEpochCurrent(
  key: BrowserAnnotationKey,
  navigationEpoch: number,
): boolean {
  return epochs.get(keyOf(key)) === navigationEpoch;
}

export function setBrowserAnnotationScreenshot(
  key: BrowserAnnotationKey,
  navigationEpoch: number,
  session: BrowserScreenshotSession | null,
): void {
  const storeKey = keyOf(key);
  if (epochs.get(storeKey) !== navigationEpoch) return;
  const existing = records.get(storeKey);
  const next: BrowserAnnotationRecord =
    existing === undefined || existing.navigationEpoch !== navigationEpoch
      ? {
          elements: null,
          environmentId: key.environmentId,
          navigationEpoch,
          screenshot: session,
          tabId: key.tabId,
          threadId: key.threadId,
        }
      : { ...existing, screenshot: session };
  if (next.screenshot === null && next.elements === null) {
    records.delete(storeKey);
  } else {
    records.set(storeKey, next);
  }
  notify();
}

export function setBrowserAnnotationElements(
  key: BrowserAnnotationKey,
  navigationEpoch: number,
  session: BrowserElementSession | null,
): void {
  const storeKey = keyOf(key);
  if (epochs.get(storeKey) !== navigationEpoch) return;
  const existing = records.get(storeKey);
  const next: BrowserAnnotationRecord =
    existing === undefined || existing.navigationEpoch !== navigationEpoch
      ? {
          elements: session,
          environmentId: key.environmentId,
          navigationEpoch,
          screenshot: null,
          tabId: key.tabId,
          threadId: key.threadId,
        }
      : { ...existing, elements: session };
  if (next.screenshot === null && next.elements === null) {
    records.delete(storeKey);
  } else {
    records.set(storeKey, next);
  }
  notify();
}

export function clearBrowserAnnotationRecord(key: BrowserAnnotationKey): void {
  const storeKey = keyOf(key);
  if (records.delete(storeKey)) notify();
}

export function clearBrowserAnnotationRecordsForTab(tabId: string): void {
  let changed = false;
  for (const [storeKey, record] of [...records]) {
    if (record.tabId === tabId) {
      records.delete(storeKey);
      changed = true;
    }
  }
  for (const [storeKey] of [...epochs]) {
    if (storeKey.slice(storeKey.lastIndexOf("\u0000") + 1) === tabId) {
      epochs.delete(storeKey);
      changed = true;
    }
  }
  if (changed) notify();
}

export function clearBrowserAnnotationRecordsForThread(threadId: string): void {
  let changed = false;
  for (const [storeKey, record] of [...records]) {
    if (record.threadId === threadId) {
      records.delete(storeKey);
      changed = true;
    }
  }
  for (const [storeKey] of [...epochs]) {
    if (storeKey.split("\u0000")[1] === threadId) {
      epochs.delete(storeKey);
      changed = true;
    }
  }
  if (changed) notify();
}

export function clearBrowserAnnotationRecordsForEnvironment(
  environmentId: string,
): void {
  let changed = false;
  for (const [storeKey, record] of [...records]) {
    if (record.environmentId === environmentId) {
      records.delete(storeKey);
      changed = true;
    }
  }
  for (const [storeKey] of [...epochs]) {
    if (storeKey.split("\u0000")[0] === environmentId) {
      epochs.delete(storeKey);
      changed = true;
    }
  }
  if (changed) notify();
}

export function resetBrowserAnnotationStore(): void {
  records.clear();
  for (const preview of previews.values()) preview.dispose();
  previews.clear();
  epochs.clear();
}
