import type { ThreadTimelineResponse } from "@bb/server-contract";
import { timelineWindowJsonLength } from "./timeline-window-tag.js";

const DEFAULT_MAX_THREADS = 16;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const READ_HOLD_MS = 30_000;

interface ServedTimelineWindow {
  bytes: number;
  readHeldUntil: number;
  readHolds: number;
  requestKey: string;
  response: ThreadTimelineResponse;
}

interface TimelineServedWindowsCache {
  get(threadId: string, tag: string): ThreadTimelineResponse | undefined;
  invalidateThread(threadId: string): void;
  latest(
    threadId: string,
    requestKey: string,
  ): ThreadTimelineResponse | undefined;
  recordPushed(
    threadId: string,
    requestKey: string,
    response: ThreadTimelineResponse,
  ): void;
  recordRead(
    threadId: string,
    requestKey: string,
    response: ThreadTimelineResponse,
    afterTag: string | undefined,
  ): void;
  release(threadId: string, tag: string): void;
  readonly size: number;
}

export function createTimelineServedWindowsCache(options: {
  maxBytes?: number;
  maxThreads?: number;
  subscriberTags: (threadId: string) => ReadonlySet<string>;
}): TimelineServedWindowsCache {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxWindowBytes = maxBytes / 4;
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
  const windowsByThreadId = new Map<string, ServedTimelineWindow[]>();
  let totalBytes = 0;

  function touch(threadId: string): ServedTimelineWindow[] | undefined {
    const windows = windowsByThreadId.get(threadId);
    if (windows !== undefined) {
      windowsByThreadId.delete(threadId);
      windowsByThreadId.set(threadId, windows);
    }
    return windows;
  }

  function dropThread(threadId: string): void {
    for (const served of windowsByThreadId.get(threadId) ?? []) {
      totalBytes -= served.bytes;
    }
    windowsByThreadId.delete(threadId);
  }

  function release(threadId: string, tag: string): void {
    const served = windowsByThreadId
      .get(threadId)
      ?.find((window) => window.response.tag === tag);
    if (served !== undefined && served.readHolds > 0) {
      served.readHolds -= 1;
    }
  }

  function prune(threadId: string, windows: ServedTimelineWindow[]): void {
    const subscriberTags = options.subscriberTags(threadId);
    const latestByRequestKey = new Map<string, ServedTimelineWindow>();
    for (const served of windows) {
      latestByRequestKey.set(served.requestKey, served);
    }
    const now = Date.now();
    const kept = windows.filter(
      (served) =>
        latestByRequestKey.get(served.requestKey) === served ||
        subscriberTags.has(served.response.tag) ||
        (served.readHolds > 0 && served.readHeldUntil > now),
    );
    for (const served of windows) {
      if (!kept.includes(served)) {
        totalBytes -= served.bytes;
      }
    }
    windows.splice(0, windows.length, ...kept);
  }

  function record(
    threadId: string,
    requestKey: string,
    response: ThreadTimelineResponse,
    readHold: boolean,
  ): void {
    const windows = touch(threadId) ?? [];
    const existingIndex = windows.findIndex(
      (served) =>
        served.requestKey === requestKey &&
        served.response.tag === response.tag,
    );
    const [existing] =
      existingIndex === -1 ? [] : windows.splice(existingIndex, 1);
    totalBytes -= existing?.bytes ?? 0;
    const bytes = timelineWindowJsonLength(response);
    if (bytes <= maxWindowBytes) {
      windows.push({
        bytes,
        readHeldUntil: readHold
          ? Date.now() + READ_HOLD_MS
          : (existing?.readHeldUntil ?? 0),
        readHolds: (existing?.readHolds ?? 0) + (readHold ? 1 : 0),
        requestKey,
        response,
      });
      totalBytes += bytes;
    }
    prune(threadId, windows);
    windowsByThreadId.set(threadId, windows);
    while (
      windowsByThreadId.size > maxThreads ||
      (totalBytes > maxBytes && windowsByThreadId.size > 1)
    ) {
      const oldest = windowsByThreadId.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      dropThread(oldest);
    }
    while (totalBytes > maxBytes && windows.length > 1) {
      totalBytes -= windows.shift()?.bytes ?? 0;
    }
  }

  return {
    get(threadId, tag) {
      return touch(threadId)?.find((served) => served.response.tag === tag)
        ?.response;
    },
    latest(threadId, requestKey) {
      const windows = touch(threadId) ?? [];
      for (let index = windows.length - 1; index >= 0; index -= 1) {
        const served = windows[index];
        if (served?.requestKey === requestKey) {
          return served.response;
        }
      }
      return undefined;
    },
    invalidateThread(threadId) {
      dropThread(threadId);
    },
    recordPushed(threadId, requestKey, response) {
      record(threadId, requestKey, response, false);
    },
    recordRead(threadId, requestKey, response, afterTag) {
      if (afterTag !== undefined) {
        release(threadId, afterTag);
      }
      record(threadId, requestKey, response, true);
    },
    release,
    get size() {
      return windowsByThreadId.size;
    },
  };
}
