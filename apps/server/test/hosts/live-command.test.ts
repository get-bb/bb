import {
  createEnvironment,
  getEnvironment,
  getAppSettings,
  setAppSettings,
  updateHost,
} from "@bb/db";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { updateMachineEnvironment } from "../../src/services/machines/environment-settings.js";
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

it("resolves fresh setup values at dispatch without retaining them in the request", async () => {
  await withTestHarness(async (harness) => {
    setAppSettings(harness.db, {
      ...getAppSettings(harness.db),
      machineGitCredentialsEnabled: false,
    });
    const { host } = seedHostSession(harness.deps);
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "manual",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: host.id,
      providerOwnsPath: true,
    });
    const command = buildEnvironmentProvisionCommand({
      environmentId: environment.id,
      hostId: host.id,
      initiator: null,
      path: "/tmp/setup-values",
      setupScriptTimeoutMs: 1000,
    });
    const original = JSON.stringify(command);
    const request = vi
      .spyOn(harness.hub, "requestHostOnlineRpc")
      .mockImplementation(async ({ message }) => ({
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: "environment.attach",
        ok: true,
        result: {
          path: command.path,
          isGitRepo: false,
          isWorktree: false,
          branchName: null,
          defaultBranch: null,
        },
      }));
    for (const value of ["first-secret", "refreshed-secret"]) {
      await updateMachineEnvironment(
        harness.db,
        harness.config.dataDir,
        "SETUP_VALUE",
        { name: "SETUP_VALUE", value, note: null },
      );
      await runLiveHostCommand(harness.deps, {
        command,
        hostId: host.id,
        timeoutMs: 1000,
      });
      expect(request.mock.lastCall?.[0].message.command).toMatchObject({
        contributedEnv: [
          expect.objectContaining({ name: "SETUP_VALUE", value }),
        ],
      });
      expect(JSON.stringify(command)).toBe(original);
      expect(
        JSON.stringify(getEnvironment(harness.db, environment.id)),
      ).not.toContain(value);
      expect(
        JSON.stringify(
          harness.db.$client.prepare("SELECT * FROM app_settings_values").all(),
        ),
      ).not.toContain(value);
    }
    await runLiveHostCommand(harness.deps, {
      command: { ...command, setupScriptTimeoutMs: null },
      hostId: host.id,
      timeoutMs: 1000,
    });
    expect(request.mock.lastCall?.[0].message.command).toMatchObject({
      contributedEnv: [],
    });
    await writeFile(join(harness.config.dataDir, "host-id"), host.id);
    await runLiveHostCommand(harness.deps, {
      command,
      hostId: host.id,
      timeoutMs: 1000,
    });
    expect(request.mock.lastCall?.[0].message.command).toMatchObject({
      contributedEnv: [],
    });
  });
});

it("fails provisioning if saved setup variables cannot be decrypted", async () => {
  await withTestHarness(async (harness) => {
    setAppSettings(harness.db, {
      ...getAppSettings(harness.db),
      machineGitCredentialsEnabled: false,
    });
    const { host } = seedHostSession(harness.deps);
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "manual",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: host.id,
      providerOwnsPath: true,
    });
    await updateMachineEnvironment(
      harness.db,
      harness.config.dataDir,
      "SETUP_VALUE",
      { name: "SETUP_VALUE", value: "private-value", note: null },
    );
    await rm(join(harness.config.dataDir, "machine-environment-key"));
    const request = vi.spyOn(harness.hub, "requestHostOnlineRpc");
    const command = buildEnvironmentProvisionCommand({
      environmentId: environment.id,
      hostId: host.id,
      initiator: null,
      path: "/tmp/setup-values",
      setupScriptTimeoutMs: 1000,
    });
    await expect(
      runLiveHostCommand(harness.deps, {
        command,
        hostId: host.id,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("Machine environment encryption key is unavailable");
    expect(request).not.toHaveBeenCalled();
    expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
  });
});
