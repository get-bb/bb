import { describe, expect, it, vi } from "vitest";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../../src/services/hosts/live-command.js";
import {
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("live host command logging", () => {
  it("logs expected live command failures without calling warning handlers", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      harness.deps.logger = logger;
      const { host } = seedHostSession(harness.deps, {
        id: "host-live-command-expected-error",
      });
      const onError = vi.fn();
      const onExpectedError = vi.fn();

      startLiveHostCommand(harness.deps, {
        command: {
          type: "thread.rename",
          environmentId: "env-live-command-expected-error",
          threadId: "thr-live-command-expected-error",
          title: "Expected Error",
        },
        hostId: host.id,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
        onError,
        onExpectedError,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.rename",
      );
      await reportQueuedCommandError(harness, queued, {
        errorCode: "provision_cancelled",
        errorMessage: "Workspace provisioning was cancelled",
      });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          commandType: "thread.rename",
          environmentId: "env-live-command-expected-error",
          errorCode: "provision_cancelled",
          errorMessage: "Workspace provisioning was cancelled",
          errorStatus: 502,
          executionId: expect.stringMatching(/^rpc_/),
          hostId: host.id,
          threadId: "thr-live-command-expected-error",
        }),
        "Expected live host command failure",
      );
      expect(onExpectedError).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            type: "thread.rename",
            threadId: "thr-live-command-expected-error",
          }),
          error: expect.objectContaining({
            message: "Workspace provisioning was cancelled",
          }),
          execution: expect.objectContaining({
            id: expect.stringMatching(/^rpc_/),
          }),
          hostId: host.id,
        }),
      );
      expect(onError).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
