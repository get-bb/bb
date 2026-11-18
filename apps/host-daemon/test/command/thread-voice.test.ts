import { describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../src/command-dispatch.js";
import { createHarness } from "./dispatch-helpers.js";

const sessionId = "0958a8c8-9527-40ee-9358-ab17ed9e6f98";

describe("voice control dispatch", () => {
  for (const action of ["keepAlive", "stop"] as const) {
    it(`delivers ${action} to the loaded runtime without resuming a thread`, async () => {
      const harness = createHarness();
      await harness.manager.ensureEnvironment({
        environmentId: "env-1",
        workspacePath: "/tmp/env-1",
      });
      harness.runtime.voice = vi.fn().mockResolvedValue({ sdp: null });
      await expect(
        dispatchCommand(
          {
            type: "thread.voice",
            environmentId: "env-1",
            threadId: "thread-1",
            command: { action, sessionId },
          },
          harness.dispatchOptions(),
        ),
      ).resolves.toEqual({ sdp: null });
      expect(harness.runtime.voice).toHaveBeenCalledWith({
        threadId: "thread-1",
        command: { action, sessionId },
      });
      expect(harness.runtimeState.resumedThreadId).toBeUndefined();
      expect(harness.runtimeState.startedThreadId).toBeUndefined();
    });
  }

  it("treats hang-up after runtime teardown as complete without creating a runtime", async () => {
    const harness = createHarness();
    await expect(
      dispatchCommand(
        {
          type: "thread.voice",
          environmentId: "env-1",
          threadId: "thread-1",
          command: { action: "stop", sessionId },
        },
        harness.dispatchOptions(),
      ),
    ).resolves.toEqual({ sdp: null });
    expect(harness.provisions).toHaveLength(0);
  });

  it("fails a lease renewal after runtime teardown without creating a runtime", async () => {
    const harness = createHarness();
    await expect(
      dispatchCommand(
        {
          type: "thread.voice",
          environmentId: "env-1",
          threadId: "thread-1",
          command: { action: "keepAlive", sessionId },
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toThrow("Voice session is no longer active");
    expect(harness.provisions).toHaveLength(0);
  });
});
