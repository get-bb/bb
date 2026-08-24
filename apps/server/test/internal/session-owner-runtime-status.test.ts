import { changedMessageSchema, type ThreadChangedMessage } from "@bb/domain";
import { getThread } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  handleDaemonSocketClosed,
  handleHostRemoved,
} from "../../src/internal/session-owner-side-effects.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface HostThreadsFixture {
  activeThreadId: string;
  hostId: string;
  idleThreadId: string;
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
    hostId: host.id,
    idleThreadId: idleThread.id,
    sessionId: session.id,
  };
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
  it("carries a statusChange snapshot for every host thread when the daemon socket closes", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 1);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      handleDaemonSocketClosed(harness.deps, { sessionId: fixture.sessionId });
      // The disconnect schedules the grace callbacks with real timers; drop
      // them so the harness does not fire interruptions after cleanup.
      harness.hub.cancelPendingDaemonDisconnect(fixture.sessionId);

      // Bare notifications here would make every client refetch every active
      // thread list once per host thread; the snapshot is what lets them
      // patch rows in place.
      const activeMessage = lastStatusChange(
        socket.messages,
        fixture.activeThreadId,
      );
      expect(activeMessage.metadata?.statusChange).toMatchObject({
        status: "active",
        runtime: {
          displayStatus: "host-reconnecting",
          hostReconnectGraceExpiresAt: expect.any(Number),
        },
      });
      const idleMessage = lastStatusChange(
        socket.messages,
        fixture.idleThreadId,
      );
      expect(idleMessage.metadata?.statusChange).toMatchObject({
        status: "idle",
        runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
      });
    });
  });

  it("carries the settled post-interruption snapshot when the host is removed", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostThreadsFixture(harness, 2);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      handleHostRemoved(harness.deps, {
        hostId: fixture.hostId,
        sessionId: fixture.sessionId,
      });

      // Removal interrupts the active thread (run.failed) before the runtime
      // fan-out, so every status-changed for it must carry a snapshot and the
      // final one must show the settled error state.
      const activeMessages = statusChangedMessagesFor(
        socket.messages,
        fixture.activeThreadId,
      );
      expect(activeMessages.length).toBeGreaterThan(0);
      for (const message of activeMessages) {
        expect(message.metadata?.statusChange).toBeDefined();
      }
      expect(getThread(harness.db, fixture.activeThreadId)?.status).toBe(
        "error",
      );
      expect(
        activeMessages.at(-1)?.metadata?.statusChange,
      ).toMatchObject({
        status: "error",
        runtime: { displayStatus: "error" },
      });
      expect(
        lastStatusChange(socket.messages, fixture.idleThreadId).metadata
          ?.statusChange,
      ).toMatchObject({
        status: "idle",
        runtime: { displayStatus: "idle" },
      });
    });
  });
});
