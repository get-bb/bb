import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createEnvironment,
  environments,
  getEnvironment,
  getHost,
  hosts,
  listThreadIdsWithHostOfflineQueueWaits,
  updateHost,
} from "@bb/db";
import type { PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import {
  requestMachineRemoval,
  requestMachineSuspension,
  requestMachineResume,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { callPluginHostRpc } from "../../../src/services/plugins/plugin-host-rpc.js";
import { callHostOnlineRpcForWork } from "../../../src/services/hosts/online-rpc.js";
import { createMachineEnrollmentService } from "../../../src/services/machines/enrollments.js";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedQueuedMessage,
  seedSession,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

function installMachineProvider(
  overrides: Partial<PluginMachineProviderDeclaration> = {},
) {
  const record = {
    pluginId: "test-machine-plugin",
    provider: validatePluginMachineProviderDeclaration({
      id: "test-machine",
      displayName: "Test machine",
      description: "Provision a test machine.",
      icon: "Terminal",
      create: async ({ key }) => ({
        status: "created" as const,
        name: "Created machine",
        resource: { key },
      }),
      reconcileCleanup: async () => ({ status: "removed" as const }),
      remove: async () => ({ status: "removed" as const }),
      ...overrides,
    }),
  };
  setPluginMachineProviderBridge({
    listMachineProviders: () => [record],
    getMachineProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_pluginId, _label, run) => {
      try {
        return { ok: true as const, value: await run() };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: 10_000,
  });
  return record;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPluginMachineProviderBridge(undefined);
  setPluginEnvironmentProviderBridge(undefined);
});

it("can resume after a snapshot fails following daemon shutdown", async () =>
  withTestHarness(async (harness) => {
    const target = seedHostSession(harness.deps, {
      id: "review-failed-suspend",
    });
    const resume = vi.fn(async () => {
      seedSession(harness.deps, target.host.id);
      return { resource: { id: "owned" } };
    });
    installMachineProvider({
      suspend: async () => {
        throw new Error("snapshot API unavailable");
      },
      resume,
    });
    updateHost(harness.db, harness.hub, target.host.id, {
      machineProviderId: "test-machine",
      resource: { id: "owned" },
    });
    registerTestHostRpcCapture(harness, {
      hostId: target.host.id,
      sessionId: target.session.id,
    });
    const shutdown = vi.spyOn(harness.hub, "requestDaemonShutdown");
    await expect(
      requestMachineSuspension(harness.deps, target.host.id),
    ).rejects.toThrow("snapshot API unavailable");
    expect(shutdown).toHaveBeenCalledOnce();
    expect(getHost(harness.db, target.host.id)?.phase).toBe("suspended");
    expect(harness.hub.hasDaemonForHost(target.host.id)).toBe(false);
    await requestMachineResume(harness.deps, target.host.id);
    expect(resume).toHaveBeenCalledOnce();
    expect(getHost(harness.db, target.host.id)?.phase).toBe("active");
    expect(harness.hub.hasDaemonForHost(target.host.id)).toBe(true);
  }));

it("recovers a persisted resuming machine without queued work", async () =>
  withTestHarness(async (harness) => {
    const target = seedHostSession(harness.deps, {
      id: "interrupted-resume",
    });
    const resume = vi.fn(async () => ({ resource: { id: "restored" } }));
    installMachineProvider({
      suspend: async () => ({ resource: { id: "owned" } }),
      resume,
    });
    updateHost(harness.db, harness.hub, target.host.id, {
      machineProviderId: "test-machine",
      machineOperationId: "test-machine-plugin:interrupted",
      phase: "resuming",
      resource: { id: "owned" },
      suspendedAt: Date.now(),
    });
    harness.hub.unregisterDaemon(target.session.id);

    await sweepProviderMachine(harness.deps, target.host.id);

    expect(resume).toHaveBeenCalledOnce();
    expect(getHost(harness.db, target.host.id)).toMatchObject({
      machineOperationId: expect.stringMatching(/^test-machine-plugin:/u),
      phase: "active",
      resource: { id: "restored" },
      suspendedAt: null,
    });
  }));

it.each(["active", "suspended"] as const)(
  "removes environments on a %s persistent machine without admitting new work",
  async (phase) =>
    withTestHarness(async (harness) => {
      const target = seedHostSession(harness.deps, { id: "review-removing" });
      registerTestHostRpcCapture(harness, {
        hostId: target.host.id,
        sessionId: target.session.id,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: target.host.id,
      });
      const machineRemove = vi.fn(async () => ({ status: "removed" as const }));
      const enrollment = createMachineEnrollmentService({
        db: harness.db,
        machineAuth: harness.deps.machineAuth,
        isConnected: (hostId) => harness.hub.hasDaemonForHost(hostId),
        serverAccess: {
          resolve: async () => ({
            id: "direct",
            serverUrl: "https://example.test",
          }),
        },
      }).forOwner("test-machine-plugin");
      const resume = vi.fn(async () => {
        expect(
          await enrollment.prepare({
            signal: new AbortController().signal,
            key: "cleanup-machine",
          }),
        ).toMatchObject({ state: "enrolled" });
        seedSession(harness.deps, target.host.id);
        await enrollment.waitForConnection({
          enrollmentId: target.host.id,
          timeoutMs: 100,
          signal: new AbortController().signal,
        });
        return { resource: { id: "owned" } };
      });
      installMachineProvider({
        remove: machineRemove,
        resume,
        suspend: async () => ({ resource: { id: "owned" } }),
      });
      updateHost(harness.db, harness.hub, target.host.id, {
        machineProviderId: "test-machine",
        resource: { id: "owned" },
        launchKey: "cleanup-machine",
        phase,
        suspendedAt: phase === "suspended" ? Date.now() : null,
      });
      harness.db
        .update(hosts)
        .set({ lastSeenAt: Date.now() })
        .where(eq(hosts.id, target.host.id))
        .run();
      if (phase === "suspended")
        harness.hub.unregisterDaemon(target.session.id);
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: target.host.id,
        path: "/tmp/review-worktree",
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: null,
      });
      harness.db
        .update(environments)
        .set({
          environmentProviderId: "review-worktree",
          environmentProviderPluginId: "review-worktree-plugin",
          environmentProviderInstanceKey: "review-worktree",
        })
        .where(eq(environments.id, environment.id))
        .run();
      const record = {
        pluginId: "review-worktree-plugin",
        provider: validatePluginEnvironmentProviderDeclaration({
          id: "review-worktree",
          displayName: "Review worktree",
          description: "Prepare a workspace for this thread.",
          icon: "Folder",
          create: async () => ({
            status: "created",
            path: "/tmp/review-worktree",
            ownsPath: true,
          }),
          remove: async () => {
            await callPluginHostRpc(harness.deps, {
              pluginId: "review-worktree-plugin",
              hostId: target.host.id,
              contract: {
                remove: { input: z.object({}), output: z.object({}) },
              },
              method: "remove",
              input: {},
              timeoutMs: 100,
              artifact: {
                path: "/tmp/review-artifact",
                generation: "1",
                digest: "a".repeat(64),
                byteLength: 1,
              },
            });
            return { status: "removed" };
          },
        }),
      };
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [record],
        getEnvironmentProvider: (id) =>
          id === record.provider.id ? record : undefined,
        invokeProvider: async (_id, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 1000,
      });
      expect(requestMachineRemoval(harness.deps, target.host.id)).toBe(true);
      const sweeping = sweepProviderMachine(harness.deps, target.host.id);
      const call = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "plugin.host.call",
      );
      expect(getHost(harness.db, target.host.id)?.phase).toBe("removing");
      await expect(
        callHostOnlineRpcForWork(harness.deps, {
          hostId: target.host.id,
          timeoutMs: 100,
          command: { type: "host.paths_exist", paths: ["/tmp/new-work"] },
        }),
      ).rejects.toMatchObject({ body: { code: "machine_removing" } });
      await expect(
        enrollment.prepare({
          signal: new AbortController().signal,
          key: "cleanup-machine",
        }),
      ).rejects.toThrow("cancelled");
      await reportQueuedCommandSuccess(harness, call, { output: {} });
      await sweeping;
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
      expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
      expect(resume).toHaveBeenCalledTimes(phase === "suspended" ? 1 : 0);
      expect(machineRemove).toHaveBeenCalledOnce();
    }),
);

it("keeps a standalone ephemeral machine available after successful creation", async () =>
  withTestHarness(async (harness) => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    installMachineProvider({
      ephemeral: true,
      inputs: z.object({ size: z.string().default("small") }),
      create: async ({ key, inputs }) => {
        expect(inputs).toEqual({ size: "small" });
        return {
          status: "created",
          name: "Standalone machine",
          resource: { key },
        };
      },
      remove,
    });
    const response = await harness.app.request("/api/v1/hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineProviderId: "test-machine", inputs: null }),
    });
    expect(response.status).toBe(201);
    const result = z.object({ id: z.string() }).parse(await readJson(response));
    await expect
      .poll(() => getHost(harness.db, result.id)?.phase)
      .not.toBe("creating");
    await sweepProviderMachine(harness.deps, result.id);
    expect(getHost(harness.db, result.id)).toMatchObject({
      phase: "active",
      type: "persistent",
      destroyedAt: null,
    });
    expect(remove).not.toHaveBeenCalled();
  }));

it("removes a suspended machine when its last thread is archived with an offline follow-up queued", async () =>
  withTestHarness(async (harness) => {
    const target = seedHostSession(harness.deps, {
      id: "review-archived-queue",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: target.host.id,
    });
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: target.host.id,
      path: "/tmp/review-archived-queue",
      providerOwnsPath: false,
      status: "ready",
      environmentProvider: null,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
    });
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    installMachineProvider({
      ephemeral: true,
      remove,
      suspend: async () => ({ resource: { id: "owned" } }),
      resume: async () => ({ resource: { id: "owned" } }),
    });
    updateHost(harness.db, harness.hub, target.host.id, {
      machineProviderId: "test-machine",
      launchKey: thread.id,
      resource: { id: "owned" },
      type: "ephemeral",
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    seedQueuedMessage(harness.deps, {
      threadId: thread.id,
      content: [{ type: "text", text: "Follow up", mentions: [] }],
      waitingOn: { kind: "host-offline", hostName: target.host.name },
    });
    expect(
      listThreadIdsWithHostOfflineQueueWaits(harness.db, target.host.id),
    ).toEqual([thread.id]);
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/archive`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(
      listThreadIdsWithHostOfflineQueueWaits(harness.db, target.host.id),
    ).toEqual([]);
    await sweepProviderMachine(harness.deps, target.host.id);
    await sweepProviderMachine(harness.deps, target.host.id);
    expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
    expect(remove).toHaveBeenCalledOnce();
  }));
