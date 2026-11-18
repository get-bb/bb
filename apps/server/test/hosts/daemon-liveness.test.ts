import { closeSession, getSessionById, noopNotifier } from "@bb/db";
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

  it("acknowledges heartbeats without writing and persists the lease at most once per lease period", async () => {
    await withTestHarness(async (harness) => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const daemon = connectDaemon(harness);
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
      const acks = () =>
        daemon.socket.messages.filter(
          (message) => JSON.parse(message).type === "heartbeat-ack",
        ).length;
      const lease = () =>
        getSessionById(harness.db, { sessionId: daemon.sessionId })!
          .leaseExpiresAt;

      const before = changes();
      const leaseBefore = lease();
      for (let index = 0; index < 50; index += 1) {
        now.mockReturnValue(1_000_000 + index * 500);
        send("heartbeat");
        send("host-rpc.response");
      }
      expect(changes() - before).toBe(0);
      expect(acks()).toBe(50);
      expect(lease()).toBe(leaseBefore);

      now.mockReturnValue(1_000_000 + LEASE_TIMEOUT_MS);
      send("heartbeat");
      expect(lease()).toBe(Date.now() + LEASE_TIMEOUT_MS);
      const renewed = changes();
      send("heartbeat");
      send("host-rpc.response");
      expect(changes()).toBe(renewed);
      expect(acks()).toBe(52);

      const beforeClockChange = lease();
      now.mockReturnValue(Date.now() - 100);
      send("heartbeat");
      expect(lease()).toBe(beforeClockChange + 1);

      closeSession(harness.db, noopNotifier, daemon.sessionId, "replaced");
      send("heartbeat");
      expect(daemon.socket.closed).toEqual([]);
      now.mockReturnValue(Date.now() + LEASE_TIMEOUT_MS);
      send("heartbeat");
      expect(daemon.socket.closed).toEqual([
        { code: 1008, reason: "inactive-session" },
      ]);
    });
  });

  it("rejects a non-heartbeat message from a closed session immediately", async () => {
    await withTestHarness(async (harness) => {
      const daemon = connectDaemon(harness);
      closeSession(harness.db, noopNotifier, daemon.sessionId, "replaced");
      feedRawDaemonWebSocketMessage({
        harness,
        hostId: daemon.hostId,
        sessionId: daemon.sessionId,
        socket: daemon.socket,
        rawMessage: { type: "machine.shutdown-ack" },
      });
      expect(daemon.socket.closed).toEqual([
        { code: 1008, reason: "inactive-session" },
      ]);
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
