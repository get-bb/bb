import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BbRealtimeConnectionEvent, ThreadRealtimeEvent } from "@bb/sdk";
import {
  COMPLETION_NOTIFICATION_TITLE_MAX_LENGTH,
  COMPLETION_NOTIFICATION_SETTLE_MS,
  createDesktopCompletionNotificationWatcher,
  formatDesktopCompletionNotificationTitle,
  formatDesktopCompletionThreadUrl,
  resolveDesktopCompletionNotification,
  type DesktopCompletionNotification,
  type DesktopCompletionThread,
} from "../src/desktop-completion-notifications.js";

function makeThread(
  overrides: Partial<DesktopCompletionThread> &
    Pick<DesktopCompletionThread, "id">,
): DesktopCompletionThread {
  return {
    latestAttentionAt: 100,
    parentThreadId: null,
    projectId: "project-1",
    status: "idle",
    title: "Fix search",
    titleFallback: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDesktopCompletionNotificationTitle", () => {
  it("appends the completion copy to ordinary thread titles", () => {
    expect(formatDesktopCompletionNotificationTitle("Fix search")).toBe(
      "Fix search: has finished",
    );
  });

  it("truncates long thread titles while preserving the completion suffix", () => {
    const title = formatDesktopCompletionNotificationTitle("A".repeat(200));

    expect(title).toHaveLength(COMPLETION_NOTIFICATION_TITLE_MAX_LENGTH);
    expect(title).toBe(`${"A".repeat(65)}…: has finished`);
  });
});

describe("resolveDesktopCompletionNotification", () => {
  it("notifies for a realtime completion candidate without surfacing history", () => {
    const current = makeThread({
      id: "just-completed",
      projectId: PERSONAL_PROJECT_ID,
      title: null,
      titleFallback: "Ship notifications",
    });

    expect(
      resolveDesktopCompletionNotification({
        candidate: false,
        current,
        previous: undefined,
      }),
    ).toBeNull();
    expect(
      resolveDesktopCompletionNotification({
        candidate: true,
        current,
        previous: undefined,
      }),
    ).toEqual({
      outcome: "completed",
      projectId: null,
      threadId: "just-completed",
      title: "Ship notifications",
    });
  });

  it("reconciles a known running root that completed while disconnected", () => {
    expect(
      resolveDesktopCompletionNotification({
        candidate: false,
        current: makeThread({
          id: "thread-1",
          latestAttentionAt: 101,
          status: "idle",
        }),
        previous: makeThread({
          id: "thread-1",
          latestAttentionAt: 100,
          status: "active",
        }),
      }),
    ).toEqual({
      outcome: "completed",
      projectId: "project-1",
      threadId: "thread-1",
      title: "Fix search",
    });
  });

  it("does not mistake read-state attention for a completion", () => {
    expect(
      resolveDesktopCompletionNotification({
        candidate: false,
        current: makeThread({ id: "thread-1", latestAttentionAt: 101 }),
        previous: makeThread({ id: "thread-1", latestAttentionAt: 100 }),
      }),
    ).toBeNull();
  });

  it("reports failed roots and ignores child or still-active threads", () => {
    expect(
      resolveDesktopCompletionNotification({
        candidate: true,
        current: makeThread({ id: "failed", status: "error" }),
        previous: undefined,
      }),
    ).toMatchObject({ outcome: "failed", threadId: "failed" });
    expect(
      resolveDesktopCompletionNotification({
        candidate: true,
        current: makeThread({ id: "child", parentThreadId: "root" }),
        previous: undefined,
      }),
    ).toBeNull();
    expect(
      resolveDesktopCompletionNotification({
        candidate: true,
        current: makeThread({ id: "queued", status: "active" }),
        previous: undefined,
      }),
    ).toBeNull();
  });
});

describe("createDesktopCompletionNotificationWatcher", () => {
  it("uses typed realtime completion events to fetch only the affected thread", async () => {
    vi.useFakeTimers();
    let threadListener = (_event: ThreadRealtimeEvent): void => undefined;
    const notifications: DesktopCompletionNotification[] = [];
    const fetchThread = vi.fn(async (_threadId: string, _signal: AbortSignal) =>
      makeThread({ id: "thread-1", latestAttentionAt: 101 }),
    );
    const listThreads = vi.fn(async () => []);
    const watcher = createDesktopCompletionNotificationWatcher({
      fetchThread,
      listThreads,
      notify: (notification) => notifications.push(notification),
      subscribeToConnection: () => () => undefined,
      subscribeToThreadChanges(listener) {
        threadListener = listener;
        return () => {
          threadListener = () => undefined;
        };
      },
      warn: vi.fn(),
    });

    threadListener({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["status-changed"],
      metadata: { eventTypes: ["turn/completed"] },
    });
    await vi.advanceTimersByTimeAsync(COMPLETION_NOTIFICATION_SETTLE_MS);

    expect(fetchThread).toHaveBeenCalledOnce();
    expect(fetchThread.mock.calls[0]?.[0]).toBe("thread-1");
    expect(listThreads).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      {
        outcome: "completed",
        projectId: "project-1",
        threadId: "thread-1",
        title: "Fix search",
      },
    ]);
    watcher.stop();
  });

  it("reconciles known running threads after the SDK reconnects", async () => {
    vi.useFakeTimers();
    let connectionListener = (_event: BbRealtimeConnectionEvent): void =>
      undefined;
    let threads: DesktopCompletionThread[] = [
      makeThread({ id: "thread-1", status: "active" }),
    ];
    const notifications: DesktopCompletionNotification[] = [];
    const watcher = createDesktopCompletionNotificationWatcher({
      fetchThread: async () => null,
      listThreads: async () => threads,
      notify: (notification) => notifications.push(notification),
      subscribeToConnection(listener) {
        connectionListener = listener;
        return () => {
          connectionListener = () => undefined;
        };
      },
      subscribeToThreadChanges: () => () => undefined,
      warn: vi.fn(),
    });

    connectionListener({
      state: "connected",
      reconnected: false,
      reconnectDelayMs: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(notifications).toEqual([]);

    threads = [
      makeThread({
        id: "thread-1",
        latestAttentionAt: 101,
        status: "idle",
      }),
    ];
    connectionListener({
      state: "connected",
      reconnected: true,
      reconnectDelayMs: null,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ threadId: "thread-1" });
    watcher.stop();
  });
});

describe("formatDesktopCompletionThreadUrl", () => {
  it("opens ordinary project threads at their canonical route", () => {
    expect(
      formatDesktopCompletionThreadUrl("https://remote.example/?old=1#stale", {
        projectId: "project one",
        threadId: "thread/two",
      }),
    ).toBe(
      "https://remote.example/projects/project%20one/threads/thread%2Ftwo",
    );
  });

  it("opens personal threads at their projectless route", () => {
    expect(
      formatDesktopCompletionThreadUrl("http://127.0.0.1:38886", {
        projectId: null,
        threadId: "thread-1",
      }),
    ).toBe("http://127.0.0.1:38886/threads/thread-1");
  });
});
