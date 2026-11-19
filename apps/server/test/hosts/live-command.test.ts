import { createEnvironment, getEnvironment } from "@bb/db";
import { buildEnvironmentProvisionCommand } from "../../src/services/threads/thread-create-helpers.js";
import { describe, expect, it, vi } from "vitest";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
  runLiveHostCommand,
} from "../../src/services/hosts/live-command.js";
import {
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { ApiError } from "../../src/errors.js";

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
      expect(onError).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});

it("preserves provisioning when the host transport disappears", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: host.id,
      providerOwnsPath: false,
    });
    const command = buildEnvironmentProvisionCommand({
      environmentId: environment.id,
      hostId: host.id,
      initiator: null,
      path: "/tmp/preserve-disconnected-setup",
    });
    vi.spyOn(harness.hub, "requestHostOnlineRpc").mockRejectedValue(
      new ApiError(502, "host_unavailable", "Host is not connected"),
    );

    await expect(
      runLiveHostCommand(harness.deps, {
        command,
        hostId: host.id,
        preserveOnHostUnavailable: true,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("Host is not connected");
    expect(getEnvironment(harness.db, environment.id)?.status).toBe(
      "provisioning",
    );
  });
});
