import type { ThreadTimelineResponse } from "@bb/server-contract";
import { timelineWindowJsonLength } from "./timeline-window-tag.js";

const DEFAULT_MAX_THREADS = 16;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_RING_SIZE = 8;

interface ServedTimelineWindow {
  bytes: number;
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
  set(
    threadId: string,
    requestKey: string,
    response: ThreadTimelineResponse,
  ): void;
  readonly size: number;
}

export function createTimelineServedWindowsCache(
  options: { maxBytes?: number; maxThreads?: number; ringSize?: number } = {},
): TimelineServedWindowsCache {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
  const ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
  const ringsByThreadId = new Map<string, ServedTimelineWindow[]>();
  let totalBytes = 0;

  function touch(threadId: string): ServedTimelineWindow[] | undefined {
    const ring = ringsByThreadId.get(threadId);
    if (ring !== undefined) {
      ringsByThreadId.delete(threadId);
      ringsByThreadId.set(threadId, ring);
    }
    return ring;
  }

  function dropThread(threadId: string): void {
    for (const served of ringsByThreadId.get(threadId) ?? []) {
      totalBytes -= served.bytes;
    }
    ringsByThreadId.delete(threadId);
  }

  function dropOldest(ring: ServedTimelineWindow[]): void {
    const dropped = ring.shift();
    if (dropped !== undefined) {
      totalBytes -= dropped.bytes;
    }
  }

  return {
    get(threadId, tag) {
      return touch(threadId)?.find((served) => served.response.tag === tag)
        ?.response;
    },
    latest(threadId, requestKey) {
      const ring = touch(threadId) ?? [];
      for (let index = ring.length - 1; index >= 0; index -= 1) {
        const served = ring[index];
        if (served?.requestKey === requestKey) {
          return served.response;
        }
      }
      return undefined;
    },
    invalidateThread(threadId) {
      dropThread(threadId);
    },
    set(threadId, requestKey, response) {
      const ring = touch(threadId) ?? [];
      const existingIndex = ring.findIndex(
        (served) =>
          served.requestKey === requestKey &&
          served.response.tag === response.tag,
      );
      if (existingIndex !== -1) {
        const [existing] = ring.splice(existingIndex, 1);
        totalBytes -= existing?.bytes ?? 0;
      }
      const bytes = timelineWindowJsonLength(response);
      ring.push({ bytes, requestKey, response });
      totalBytes += bytes;
      while (ring.length > ringSize) {
        dropOldest(ring);
      }
      ringsByThreadId.set(threadId, ring);
      while (
        ringsByThreadId.size > maxThreads ||
        (totalBytes > maxBytes && ringsByThreadId.size > 1)
      ) {
        const oldest = ringsByThreadId.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        dropThread(oldest);
      }
      while (totalBytes > maxBytes && ring.length > 1) {
        dropOldest(ring);
      }
    },
    get size() {
      return ringsByThreadId.size;
    },
  };
}
