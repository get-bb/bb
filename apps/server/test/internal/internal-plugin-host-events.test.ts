import { describe, expect, it, vi } from "vitest";
import { onDaemonSocketMessage } from "../../src/ws/daemon-protocol.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("internal plugin host events", () => {
  it("attributes worker exits to the authenticated daemon host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const handleHostWorkerExit = vi.fn();
      const socket = { close: vi.fn(), send: vi.fn() };

      onDaemonSocketMessage(
        harness.deps,
        {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "plugin-host.worker-exited",
            pluginId: "keep-awake",
            generation: "generation-1",
          }),
        },
        { handleHostWorkerExit, handleHostSignal: vi.fn() },
      );

      expect(handleHostWorkerExit).toHaveBeenCalledWith({
        authenticatedHostId: host.id,
        pluginId: "keep-awake",
        generation: "generation-1",
      });
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("attributes host signals to the authenticated daemon host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const handleHostSignal = vi.fn();
      const socket = { close: vi.fn(), send: vi.fn() };

      onDaemonSocketMessage(
        harness.deps,
        {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "plugin-host.signal",
            pluginId: "fixture",
            generation: "generation-1",
            signal: "changed",
            payload: { sequence: 3 },
          }),
        },
        { handleHostSignal, handleHostWorkerExit: vi.fn() },
      );

      expect(handleHostSignal).toHaveBeenCalledWith({
        authenticatedHostId: host.id,
        pluginId: "fixture",
        generation: "generation-1",
        signal: "changed",
        payload: { sequence: 3 },
      });
      expect(socket.close).not.toHaveBeenCalled();
    });
  });
});
