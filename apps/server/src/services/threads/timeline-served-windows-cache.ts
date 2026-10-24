import type { ThreadTimelineResponse } from "@bb/server-contract";

const DEFAULT_MAX_THREADS = 64;
const DEFAULT_RING_SIZE = 8;

interface ServedTimelineWindow {
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
  options: { maxThreads?: number; ringSize?: number } = {},
): TimelineServedWindowsCache {
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
  const ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
  const ringsByThreadId = new Map<string, ServedTimelineWindow[]>();

  function use(threadId: string): ServedTimelineWindow[] | undefined {
    const ring = ringsByThreadId.get(threadId);
    if (ring !== undefined) {
      ringsByThreadId.delete(threadId);
      ringsByThreadId.set(threadId, ring);
    }
    return ring;
  }

  return {
    get(threadId, tag) {
      return use(threadId)?.find((served) => served.response.tag === tag)
        ?.response;
    },
    latest(threadId, requestKey) {
      const ring = use(threadId) ?? [];
      for (let index = ring.length - 1; index >= 0; index -= 1) {
        const served = ring[index];
        if (served?.requestKey === requestKey) {
          return served.response;
        }
      }
      return undefined;
    },
    invalidateThread(threadId) {
      ringsByThreadId.delete(threadId);
    },
    set(threadId, requestKey, response) {
      const ring = use(threadId) ?? [];
      const existingIndex = ring.findIndex(
        (served) =>
          served.requestKey === requestKey &&
          served.response.tag === response.tag,
      );
      if (existingIndex !== -1) {
        ring.splice(existingIndex, 1);
      }
      ring.push({ requestKey, response });
      while (ring.length > ringSize) {
        ring.shift();
      }
      ringsByThreadId.set(threadId, ring);
      while (ringsByThreadId.size > maxThreads) {
        const oldest = ringsByThreadId.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        ringsByThreadId.delete(oldest);
      }
    },
    get size() {
      return ringsByThreadId.size;
    },
  };
}
