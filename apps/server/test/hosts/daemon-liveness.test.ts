import { eq } from "drizzle-orm";
import {
  closeSession,
  getSessionById,
  hostDaemonSessions,
  noopNotifier,
} from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_INTERVAL_MS,
  LEASE_TIMEOUT_MS,
} from "../../src/constants.js";
import {
  onDaemonSocketClose,
  startDaemonLivenessChecks,
} from "../../src/ws/daemon-protocol.js";
import { feedRawDaemonWebSocketMessage } from "../helpers/daemon-ws.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function connectDaemon(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const socket = createMockHubSocket();
  harness.hub.registerDaemon(session.id, host.id, socket);
  return { hostId: host.id, sessionId: session.id, socket };
}

describe("daemon liveness checks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bounds liveness writes during message bursts while renewing heartbeats and rejecting closed sessions", async () => {
    await withTestHarness(async (harness) => {
      const daemon = connectDaemon(harness);
      const session = getSessionById(harness.db, {
        sessionId: daemon.sessionId,
      })!;
      const now = vi.spyOn(Date, "now").mockReturnValue(session.updatedAt + 1);
      const changes = () =>
        harness.db.$client
          .prepare<[], { count: number }>("SELECT total_changes() AS count")
          .get()!.count;
      const send = (type: "heartbeat" | "host-rpc.response") =>
        feedRawDaemonWebSocketMessage({
          harness,
          hostId: daemon.hostId,
          sessionId: daemon.sessionId,
          socket: daemon.socket,
          rawMessage:
            type === "heartbeat"
              ? { type }
              : {
                  type,
                  requestId: "finished-request",
                  commandType: "host.list_files",
                  ok: true,
                  result: { files: [], truncated: false },
                },
        });
      const before = changes();
      for (let index = 0; index < 100; index += 1) send("host-rpc.response");
      expect(changes() - before).toBeLessThanOrEqual(2);
      expect(daemon.socket.closed).toEqual([]);

      now.mockReturnValue(session.updatedAt + HEARTBEAT_INTERVAL_MS);
      send("host-rpc.response");
      const renewed = getSessionById(harness.db, {
        sessionId: daemon.sessionId,
      })!;
      expect(renewed.leaseExpiresAt).toBe(Date.now() + LEASE_TIMEOUT_MS);

      now.mockReturnValue(Date.now() + 1);
      send("heartbeat");
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId })!
          .leaseExpiresAt,
      ).toBe(Date.now() + LEASE_TIMEOUT_MS);
      expect(
        daemon.socket.messages.map((message) => JSON.parse(message)),
      ).toContainEqual({ type: "heartbeat-ack" });

      harness.db
        .update(hostDaemonSessions)
        .set({ leaseExpiresAt: Date.now() + 1 })
        .where(eq(hostDaemonSessions.id, daemon.sessionId))
        .run();
      send("host-rpc.response");
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId })!
          .leaseExpiresAt,
      ).toBe(Date.now() + LEASE_TIMEOUT_MS);

      const beforeClockChange = getSessionById(harness.db, {
        sessionId: daemon.sessionId,
      })!;
      now.mockReturnValue(Date.now() - 100);
      send("host-rpc.response");
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId }),
      ).toMatchObject({
        updatedAt: Date.now(),
        leaseExpiresAt: beforeClockChange.leaseExpiresAt + 1,
      });

      closeSession(harness.db, noopNotifier, daemon.sessionId, "replaced");
      const closed = getSessionById(harness.db, {
        sessionId: daemon.sessionId,
      });
      send("host-rpc.response");
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId }),
      ).toEqual(closed);
      expect(daemon.socket.closed.length).toBeGreaterThan(0);
    });
  });

  it("closes a daemon socket that sends nothing for the lease timeout", async () => {
    await withTestHarness(async (harness) => {
      const daemon = connectDaemon(harness);
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const stop = startDaemonLivenessChecks(harness.deps);
      try {
        vi.advanceTimersByTime(LEASE_TIMEOUT_MS);
        expect(harness.hub.hasDaemonForHost(daemon.hostId)).toBe(true);

        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
        expect(harness.hub.hasDaemonForHost(daemon.hostId)).toBe(false);
        expect(
          daemon.socket.messages.map((message) => JSON.parse(message)),
        ).toContainEqual({ type: "session-close", reason: "expired" });
        expect(daemon.socket.closed).toEqual([
          { code: 1000, reason: "expired" },
        ]);
        expect(
          getSessionById(harness.db, { sessionId: daemon.sessionId }),
        ).toMatchObject({ status: "closed", closeReason: "expired" });

        onDaemonSocketClose(harness.deps, daemon.sessionId);
        expect(
          getSessionById(harness.db, { sessionId: daemon.sessionId }),
        ).toMatchObject({ status: "closed", closeReason: "expired" });
      } finally {
        stop();
        harness.hub.cancelPendingDaemonDisconnect(daemon.sessionId);
      }
    });
  });

  it("keeps a daemon that sends a message within every lease window", async () => {
    await withTestHarness(async (harness) => {
      const daemon = connectDaemon(harness);
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const stop = startDaemonLivenessChecks(harness.deps);
      try {
        for (let round = 0; round < 4; round += 1) {
          vi.advanceTimersByTime(LEASE_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
          feedRawDaemonWebSocketMessage({
            harness,
            hostId: daemon.hostId,
            rawMessage: { type: "heartbeat" },
            sessionId: daemon.sessionId,
            socket: daemon.socket,
          });
        }

        expect(harness.hub.hasDaemonForHost(daemon.hostId)).toBe(true);
        expect(daemon.socket.closed).toEqual([]);
        expect(
          getSessionById(harness.db, { sessionId: daemon.sessionId }),
        ).toMatchObject({ status: "active" });
      } finally {
        stop();
      }
    });
  });
});
