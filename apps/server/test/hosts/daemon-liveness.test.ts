import { getSessionById } from "@bb/db";
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
