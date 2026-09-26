import { changedMessageSchema, type ThreadChangedMessage } from "@bb/domain";
import { getThread, markThreadDeleted } from "@bb/db";
import { HOST_RECONNECT_GRACE_MS } from "../../src/constants.js";
import { describe, expect, it, vi } from "vitest";
import {
  handleDaemonSocketClosed,
  handleHostRemoved,
} from "../../src/internal/session-owner-side-effects.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface HostThreadsFixture {
  activeThreadId: string;
  environmentId: string;
  hostId: string;
  idleThreadId: string;
  projectId: string;
  sessionId: string;
}

function seedHostThreadsFixture(
  harness: TestAppHarness,
  value: number,
): HostThreadsFixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-runtime-status-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/runtime-status-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/runtime-status-${value}`,
    status: "ready",
  });
  const activeThread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });
  const idleThread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return {
    activeThreadId: activeThread.id,
    environmentId: environment.id,
    hostId: host.id,
    idleThreadId: idleThread.id,
    projectId: project.id,
    sessionId: session.id,
  };
}

function seedHostThreads(
  harness: TestAppHarness,
  args: {
    count: number;
    fixture: Pick<HostThreadsFixture, "environmentId" | "projectId">;
    status: "active" | "idle";
  },
): string[] {
  return Array.from(
    { length: args.count },
    () =>
      seedThread(harness.deps, {
        projectId: args.fixture.projectId,
        environmentId: args.fixture.environmentId,
        status: args.status,
      }).id,
  );
}

function countPreparedStatements(
  harness: TestAppHarness,
  work: () => void,
): number {
  const prepare = vi.spyOn(harness.db.$client, "prepare");
  try {
    work();
    return prepare.mock.calls.length;
  } finally {
    prepare.mockRestore();
  }
}

function statusChangedMessagesFor(
  messages: readonly string[],
  threadId: string,
): ThreadChangedMessage[] {
  return messages.flatMap((raw) => {
    const message = changedMessageSchema.parse(JSON.parse(raw));
    return message.entity === "thread" &&
      message.id === threadId &&
      message.changes.includes("status-changed")
      ? [message]
      : [];
  });
}

function hostDisconnectedMessagesFor(
  messages: readonly string[],
  hostId: string,
): string[] {
  return messages.filter((raw) => {
    const message = changedMessageSchema.parse(JSON.parse(raw));
    return (
      message.entity === "host" &&
      message.id === hostId &&
      message.changes.includes("host-disconnected")
    );
  });
}

function lastStatusChange(
  messages: readonly string[],
  threadId: string,
): ThreadChangedMessage {
  const statusMessages = statusChangedMessagesFor(messages, threadId);
  const last = statusMessages.at(-1);
  if (!last) {
    throw new Error(`no status-changed message for thread ${threadId}`);
  }
  return last;
}

describe("host thread runtime status notifications", () => {
  it("keeps a closed daemon socket hidden until the reconnect grace ends, without interrupting the thread", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 1);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });
      harness.hub.subscribe(socket, { kind: "host-list" });

      vi.useFakeTimers();
      try {
        handleDaemonSocketClosed(harness.deps, {
          sessionId: fixture.sessionId,
        });
        expect(
          lastStatusChange(socket.messages, fixture.activeThreadId).metadata
            ?.statusChange,
        ).toMatchObject({
          status: "active",
          runtime: { displayStatus: "active" },
        });
        expect(
          lastStatusChange(socket.messages, fixture.idleThreadId).metadata
            ?.statusChange,
        ).toBeUndefined();
        const hostChangesBeforeGraceEnd = hostDisconnectedMessagesFor(
          socket.messages,
          fixture.hostId,
        ).length;

        vi.advanceTimersByTime(HOST_RECONNECT_GRACE_MS);

        expect(
          lastStatusChange(socket.messages, fixture.activeThreadId).metadata
            ?.statusChange,
        ).toMatchObject({
          status: "active",
          runtime: {
            displayStatus: "waiting-for-host",
          },
        });
        expect(
          hostDisconnectedMessagesFor(socket.messages, fixture.hostId),
        ).toHaveLength(hostChangesBeforeGraceEnd + 1);
        expect(getThread(harness.db, fixture.activeThreadId)?.status).toBe(
          "active",
        );
      } finally {
        harness.hub.cancelPendingDaemonDisconnect(fixture.sessionId);
        vi.useRealTimers();
      }
    });
  });

  it("tells clients a disconnected host's threads are active again when its daemon reconnects", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 6);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      vi.useFakeTimers();
      try {
        handleDaemonSocketClosed(harness.deps, {
          sessionId: fixture.sessionId,
        });
        vi.advanceTimersByTime(HOST_RECONNECT_GRACE_MS);
      } finally {
        vi.useRealTimers();
      }
      expect(
        lastStatusChange(socket.messages, fixture.activeThreadId).metadata
          ?.statusChange?.runtime.displayStatus,
      ).toBe("waiting-for-host");

      const reconnected = seedSession(harness.deps, fixture.hostId);
      onDaemonSocketOpen(harness.deps, {
        hostId: fixture.hostId,
        sessionId: reconnected.id,
        socket: createMockHubSocket(),
      });

      expect(
        lastStatusChange(socket.messages, fixture.activeThreadId).metadata
          ?.statusChange,
      ).toMatchObject({
        status: "active",
        runtime: { displayStatus: "active" },
      });
    });
  });

  it("never shows a disconnect for a daemon that reconnects within the reconnect grace", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 5);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      vi.useFakeTimers();
      try {
        handleDaemonSocketClosed(harness.deps, {
          sessionId: fixture.sessionId,
        });
        vi.advanceTimersByTime(HOST_RECONNECT_GRACE_MS - 1_000);
        const reconnected = seedSession(harness.deps, fixture.hostId);
        harness.hub.registerDaemon(
          reconnected.id,
          fixture.hostId,
          createMockHubSocket(),
        );
        vi.advanceTimersByTime(HOST_RECONNECT_GRACE_MS);
      } finally {
        vi.useRealTimers();
      }

      expect(
        statusChangedMessagesFor(socket.messages, fixture.activeThreadId).map(
          (message) => message.metadata?.statusChange?.runtime.displayStatus,
        ),
      ).toEqual(["active"]);
    });
  });

  it("publishes the disconnect fan-out in a statement count that does not grow with the host's thread count", async () => {
    await withTestHarness(async (harness) => {
      const small = seedHostThreadsFixture(harness, 2);
      const large = seedHostThreadsFixture(harness, 3);
      const largeActiveThreadIds = [
        large.activeThreadId,
        ...seedHostThreads(harness, {
          count: 2,
          fixture: large,
          status: "active",
        }),
      ];
      const largeIdleThreadIds = seedHostThreads(harness, {
        count: 300,
        fixture: large,
        status: "idle",
      });
      const deletedActiveThread = seedThread(harness.deps, {
        projectId: large.projectId,
        environmentId: large.environmentId,
        status: "active",
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedActiveThread.id,
      });
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      const largeStatements = countPreparedStatements(harness, () =>
        handleDaemonSocketClosed(harness.deps, { sessionId: large.sessionId }),
      );
      harness.hub.cancelPendingDaemonDisconnect(large.sessionId);
      const largeMessages = [...socket.messages];
      socket.messages.length = 0;

      const smallStatements = countPreparedStatements(harness, () =>
        handleDaemonSocketClosed(harness.deps, { sessionId: small.sessionId }),
      );
      harness.hub.cancelPendingDaemonDisconnect(small.sessionId);

      expect(largeStatements).toBe(smallStatements);

      for (const threadId of largeActiveThreadIds) {
        expect(
          lastStatusChange(largeMessages, threadId).metadata?.statusChange,
        ).toMatchObject({
          status: "active",
          runtime: { displayStatus: "active" },
        });
      }
      for (const threadId of [...largeIdleThreadIds, deletedActiveThread.id]) {
        expect(
          lastStatusChange(largeMessages, threadId).metadata?.statusChange,
        ).toBeUndefined();
      }
      expect(
        statusChangedMessagesFor(largeMessages, small.activeThreadId),
      ).toEqual([]);
    });
  });

  it("carries the settled post-interruption snapshot when the host is removed", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 4);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      handleHostRemoved(harness.deps, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });

      const activeSnapshots = statusChangedMessagesFor(
        socket.messages,
        fixture.activeThreadId,
      ).flatMap((message) =>
        message.metadata?.statusChange ? [message.metadata.statusChange] : [],
      );
      expect(activeSnapshots.length).toBeGreaterThan(0);
      expect(getThread(harness.db, fixture.activeThreadId)?.status).toBe(
        "idle",
      );
      expect(activeSnapshots.at(-1)).toMatchObject({
        status: "idle",
        runtime: { displayStatus: "idle" },
      });
      expect(
        lastStatusChange(socket.messages, fixture.idleThreadId).metadata
          ?.statusChange,
      ).toBeUndefined();
    });
  });
});
