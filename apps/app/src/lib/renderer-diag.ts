/**
 * DIAGNOSTIC-ONLY instrumentation for the desktop cold-start "Host is offline"
 * investigation (thr_v7jjaqbtaw). Not intended to merge: captures the renderer
 * startup timeline (WS lifecycle, watermark invalidation, host/provider query
 * cache events) and ships it to the server so it lands in server.N.log
 * interleaved with the server/daemon timeline.
 */
import type { QueryClient, Query } from "@tanstack/react-query";

interface DiagLine {
  t: number;
  msg: string;
  data?: unknown;
}

const MAX_BUFFERED_LINES = 500;
const FLUSH_INTERVAL_MS = 500;
const CAPTURE_WINDOW_MS = 180_000;

const startedAt = Date.now();
let buffer: DiagLine[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function withinCaptureWindow(): boolean {
  return Date.now() - startedAt < CAPTURE_WINDOW_MS;
}

export function diag(msg: string, data?: unknown): void {
  if (!withinCaptureWindow()) {
    return;
  }
  const line: DiagLine = { t: Date.now(), msg, ...(data === undefined ? {} : { data }) };
  // eslint-disable-next-line no-console
  console.log("[bb-diag]", line.t, msg, data ?? "");
  if (buffer.length < MAX_BUFFERED_LINES) {
    buffer.push(line);
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) {
    return;
  }
  const batch = buffer;
  buffer = [];
  try {
    await fetch("/api/v1/diag/renderer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: batch }),
    });
  } catch {
    // Server not reachable yet (it may still be booting). Requeue and retry;
    // the buffer cap bounds memory if the server never comes up.
    buffer = [...batch, ...buffer].slice(0, MAX_BUFFERED_LINES);
    scheduleFlush();
  }
}

const INTERESTING_KEY_HEADS = new Set([
  "hosts",
  "host",
  "systemProviders",
  "systemExecutionOptions",
]);

function isInterestingQuery(query: Query): boolean {
  const head = query.queryKey[0];
  return typeof head === "string" && INTERESTING_KEY_HEADS.has(head);
}

/** Compact one-line summary of a host/provider payload for the log. */
function summarizeData(query: Query): unknown {
  const data: unknown = query.state.data;
  if (data === undefined || data === null) {
    return null;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return {
          id: record.id,
          status: record.status,
          name: record.name,
        };
      }
      return item;
    });
  }
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of ["id", "status", "hosts", "providers", "options"]) {
      const value = record[key];
      if (value === undefined) {
        continue;
      }
      summary[key] = Array.isArray(value) ? `array(${value.length})` : value;
    }
    return summary;
  }
  return data;
}

export function installRendererDiag(queryClient: QueryClient): void {
  diag("renderer boot", {
    href: window.location.href,
    timeOrigin: Math.round(performance.timeOrigin),
  });

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (!isInterestingQuery(event.query)) {
      return;
    }
    if (event.type === "updated") {
      diag("query updated", {
        key: event.query.queryKey,
        action: event.action.type,
        fetchStatus: event.query.state.fetchStatus,
        status: event.query.state.status,
        dataUpdatedAt: event.query.state.dataUpdatedAt,
        isInvalidated: event.query.state.isInvalidated,
        summary:
          event.action.type === "success" || event.action.type === "setState"
            ? summarizeData(event.query)
            : undefined,
      });
      return;
    }
    if (event.type === "added" || event.type === "removed") {
      diag(`query ${event.type}`, { key: event.query.queryKey });
    }
  });

  setTimeout(() => {
    unsubscribe();
    void flush();
  }, CAPTURE_WINDOW_MS);
}
