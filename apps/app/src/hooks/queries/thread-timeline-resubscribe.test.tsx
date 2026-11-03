// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { JSX, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientMessageSchema,
  defaultExperiments,
  type ClientMessage,
} from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { useWebSocket } from "@/hooks/useWebSocket";
import { sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { systemConfigQueryKey, threadTimelineQueryKey } from "./query-keys";
import { useThreadTimeline } from "./thread-panel-queries";

const fakeSockets = vi.hoisted(() => {
  class FakeReconnectingWebSocket {
    onclose: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 0;
    readonly sentMessages: string[] = [];

    constructor() {
      instances.push(this);
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }
  }
  const instances: FakeReconnectingWebSocket[] = [];
  return { FakeReconnectingWebSocket, instances };
});

vi.mock("partysocket/ws", () => ({
  default: fakeSockets.FakeReconnectingWebSocket,
}));

vi.mock("@/lib/dev-websocket-url", () => ({
  buildBrowserWebSocketUrl: () => "ws://bb.test/ws",
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      get: vi.fn(),
      timeline: vi.fn(),
    },
  },
}));

const timelineTarget = {
  kind: "thread-timeline",
  threadId: "thread-1",
  segmentLimit: null,
  deferContent: true,
} as const;
const timelineKey = "thread-timeline:thread-1:default:deferred";

const row = {
  id: "row-1",
  kind: "system",
  threadId: "thread-1",
  turnId: null,
  sourceSeqStart: 7,
  sourceSeqEnd: 7,
  startedAt: 1,
  createdAt: 1,
  systemKind: "debug",
  title: "First row",
  detail: null,
  status: null,
} satisfies ThreadTimelineResponse["rows"][number];

function mockMatchMedia(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function onlySocket() {
  const socket = fakeSockets.instances.at(-1);
  if (socket === undefined) {
    throw new Error("Expected the app to open a websocket");
  }
  return socket;
}

function timelineSubscribeTags(): Array<Record<string, string | null>> {
  return onlySocket()
    .sentMessages.map(
      (message): ClientMessage =>
        clientMessageSchema.parse(JSON.parse(message)),
    )
    .flatMap((message) =>
      message.type === "subscribe" && message.timelineTags !== undefined
        ? [message.timelineTags]
        : [],
    );
}

function renderApp() {
  const harness = createQueryClientTestHarness();
  harness.queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      experiments: { ...defaultExperiments, timelinePush: true },
    }),
  );
  const HarnessWrapper = harness.wrapper;
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <MemoryRouter>
      <HarnessWrapper>{children}</HarnessWrapper>
    </MemoryRouter>
  );
  renderHook(() => useWebSocket(), { wrapper });
  act(() => {
    onlySocket().open();
  });
  const openThread = () =>
    renderHook(() => useThreadTimeline("thread-1"), { wrapper });
  return { openThread, queryClient: harness.queryClient };
}

async function leaveThread(unmount: () => void): Promise<void> {
  unmount();
  await act(async () => {
    await Promise.resolve();
  });
  onlySocket().sentMessages.length = 0;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
  });
  mockMatchMedia();
  vi.mocked(sdk.threads.timeline).mockResolvedValue(
    makeThreadTimelineResponse({ rows: [row], maxSeq: 7 }),
  );
});

afterEach(() => {
  cleanup();
  wsManager.disconnect();
  fakeSockets.instances.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("returning to a pushed thread timeline", () => {
  it("resubscribes with the cached window's tag when the cache is too fresh to refetch", async () => {
    const { openThread } = renderApp();
    const first = openThread();
    await waitFor(() => {
      expect(first.result.current.data?.tag).toBe("timeline-7");
    });
    await leaveThread(first.unmount);

    const second = openThread();

    expect(second.result.current.data?.tag).toBe("timeline-7");
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    expect(timelineSubscribeTags()).toEqual([{ [timelineKey]: "timeline-7" }]);
  });

  it("resends the tag of the window it holds, not an unapplied push's, after a reconnect", async () => {
    const { openThread, queryClient } = renderApp();
    const opened = openThread();
    await waitFor(() => {
      expect(opened.result.current.data?.tag).toBe("timeline-7");
    });
    vi.mocked(sdk.threads.timeline).mockImplementation(
      () => new Promise(() => {}),
    );
    act(() => {
      onlySocket().onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "thread-timeline",
            target: timelineTarget,
            afterSequence: null,
            timeline: {
              maxSeq: 9,
              tag: "timeline-9",
              delta: { afterTag: "timeline-6", upsertRows: [], fields: {} },
            },
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    expect(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      )?.tag,
    ).toBe("timeline-7");
    onlySocket().sentMessages.length = 0;

    act(() => {
      onlySocket().close();
      onlySocket().open();
    });

    expect(timelineSubscribeTags()).toEqual([{ [timelineKey]: "timeline-7" }]);
  });

  it("subscribes without a tag once the cached window is gone, then sends the refetched tag", async () => {
    const { openThread, queryClient } = renderApp();
    const first = openThread();
    await waitFor(() => {
      expect(first.result.current.data?.tag).toBe("timeline-7");
    });
    await leaveThread(first.unmount);
    queryClient.removeQueries({ queryKey: threadTimelineQueryKey("thread-1") });
    vi.mocked(sdk.threads.timeline).mockResolvedValue(
      makeThreadTimelineResponse({ rows: [row], maxSeq: 8 }),
    );

    const second = openThread();

    await waitFor(() => {
      expect(second.result.current.data?.tag).toBe("timeline-8");
    });
    expect(timelineSubscribeTags()).toEqual([
      { [timelineKey]: null },
      { [timelineKey]: "timeline-8" },
    ]);
  });
});
