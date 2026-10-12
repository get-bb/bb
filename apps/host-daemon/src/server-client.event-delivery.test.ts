import { createServer } from "node:http";
import { setTimeout as realDelay } from "node:timers/promises";
import { createDeferredPromise } from "@bb/test-helpers";
import { expect, it, vi } from "vitest";
import { createEventSink } from "./event-sink.js";
import { createServerClient } from "./server-client.js";

it.each(["headers", "body"])(
  "retries a stalled event upload at %s and delivers a queued completion after reconnection",
  async (stalledAt) => {
    const firstRequest = createDeferredPromise<void>();
    const receivedHeaders = createDeferredPromise<void>();
    const requests: unknown[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (requests.length === 1) {
        if (stalledAt === "body") {
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"acceptedEvents":');
        }
        firstRequest.resolve();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ acceptedEvents: [], rejectedEvents: [] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP listener");
    }
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    let sessionId = "session-before-drop";
    const client = createServerClient({
      serverUrl: `http://127.0.0.1:${address.port}`,
      hostKey: "test-host",
      getSessionId: () => sessionId,
      fetchFn: async (...args) => {
        const response = await fetch(...args);
        receivedHeaders.resolve();
        return response;
      },
      logger,
    });
    const sink = createEventSink({
      isSessionOpen: () => true,
      postEvents: (events) => client.postEvents(events),
      logger,
    });
    const started = {
      threadId: "thr_recovered",
      event: {
        type: "turn/started",
        threadId: "thr_recovered",
        providerThreadId: "provider-thread",
        scope: { kind: "turn", turnId: "turn-1" },
      },
    } as const;
    const completed = {
      ...started,
      event: { ...started.event, type: "turn/completed", status: "completed" },
    } as const;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      sink.emit(started);
      const flush = sink.flush();
      await firstRequest.promise;
      if (stalledAt === "body") await receivedHeaders.promise;
      sink.emit(completed);
      sessionId = "session-after-drop";
      void sink.flush();
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(
        Promise.race([flush.then(() => true), realDelay(1000, false)]),
      ).resolves.toBe(true);
      await flush;
      expect(sink.listUndeliveredThreadIds()).toEqual(["thr_recovered"]);
      expect(logger.error).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      await sink.flush();
      expect(requests).toEqual([
        {
          sessionId: "session-before-drop",
          eventGroups: [
            { threadId: started.threadId, events: [started.event] },
          ],
        },
        {
          sessionId: "session-after-drop",
          eventGroups: [
            {
              threadId: started.threadId,
              events: [started.event, completed.event],
            },
          ],
        },
      ]);
      expect(sink.listUndeliveredThreadIds()).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await sink.dispose();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  },
);
