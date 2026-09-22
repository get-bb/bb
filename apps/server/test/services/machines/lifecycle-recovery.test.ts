import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  requestEnvironmentRemoval,
  sweepProviderEnvironment,
} from "../../../src/services/environments/environment-engine.js";
import { maintainMachine } from "../../../src/services/machines/lifecycle.js";
import {
  SERVER_MOVE_FROZEN_RETRY_MS,
  setServerMoveFrozen,
} from "../../../src/services/server-move/freeze-state.js";
import {
  createEnvironment,
  createTerminalSession,
  environments,
  getEnvironment,
  getAppSettings,
  setAppSettings,
  getHost,
  getThread,
  hosts,
  listThreadIdsWithHostOfflineQueueWaits,
  updateHost,
} from "@bb/db";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  requestMachineRemoval,
  retryMachineCleanup,
  requestMachineSuspension,
  reconcileMachine,
  resumeMachine,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { callPluginHostRpc } from "../../../src/services/plugins/plugin-host-rpc.js";
import { callHostOnlineRpcForWork } from "../../../src/services/hosts/online-rpc.js";
import { createMachineEnrollmentService } from "../../../src/services/machines/enrollments.js";
import { registerTestHostRpcCapture } from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import { installMachineProvider } from "../../helpers/machine-provider.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedQueuedMessage,
  seedSession,
} from "../../helpers/seed.js";
import { advanceUntilSettled } from "../../helpers/fake-timers.js";
import { withTestHarness } from "../../helpers/test-app.js";

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
    await resumeMachine(harness.deps, target.host.id);
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

it.each([
  { phase: "active", failCleanup: false },
  { phase: "suspended", failCleanup: false },
  { phase: "active", failCleanup: true },
] as const)(
  "removes environments on a $phase persistent machine (cleanup fails first: $failCleanup)",
  async ({ phase, failCleanup }) =>
    withTestHarness(async (harness) => {
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        machineGitCredentialsEnabled: false,
      });
      const target = seedHostSession(harness.deps, { id: "review-removing" });
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
      const cleanupCall = vi.fn(async () => ({ output: {} }));
      const registerCleanupCapture = (sessionId: string) =>
        registerTestHostRpcCapture(harness, {
          hostId: target.host.id,
          sessionId,
          onPluginHostCall: cleanupCall,
        });
      registerCleanupCapture(target.session.id);
      const resume = vi.fn(async () => {
        expect(
          await enrollment.prepare({
            signal: new AbortController().signal,
            key: "cleanup-machine",
          }),
        ).toMatchObject({ state: "enrolled" });
        const session = seedSession(harness.deps, target.host.id);
        registerCleanupCapture(session.id);
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
      let cleanupFailurePending = failCleanup;
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
            if (cleanupFailurePending) {
              cleanupFailurePending = false;
              return {
                status: "failed",
                message: "Workspace cleanup temporarily failed",
              };
            }
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        visibility: "hidden",
      });
      expect(requestEnvironmentRemoval(harness.deps, environment.id)).toBe(
        false,
      );
      await sweepProviderEnvironment(harness.deps, environment.id);
      expect(cleanupCall).not.toHaveBeenCalled();
      expect(requestMachineRemoval(harness.deps, target.host.id)).toBe(true);
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
      await sweepProviderMachine(harness.deps, target.host.id);
      if (failCleanup) {
        expect(getHost(harness.db, target.host.id)).toMatchObject({
          phase: "removing",
          teardownStatus: "failed",
          statusMessage: "Workspace cleanup temporarily failed",
        });
        expect(machineRemove).not.toHaveBeenCalled();
        await retryMachineCleanup(harness.deps, target.host.id);
      }
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
      expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: null,
        deletedAt: null,
        status: "idle",
      });
      expect(cleanupCall).toHaveBeenCalledOnce();
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
      `/api/v1/threads/${thread.id}/archive-all`,
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

it("reconciles on request using core's current state and serializes a concurrent resume", async () =>
  withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      id: "plugin-reconcile",
    });
    harness.hub.unregisterDaemon(session.id);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const suspend = vi.fn(async () => {
      await pending;
      return { resource: { id: "saved" } };
    });
    const resume = vi.fn(async () => ({ resource: { id: "running" } }));
    installMachineProvider({ suspend, resume });
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "test-machine",
      phase: "active",
      resource: { id: "running" },
    });
    await reconcileMachine(harness.deps, host.id);
    expect(suspend).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    updateHost(harness.db, harness.hub, host.id, {
      phase: "suspended",
      suspendedAt: 1,
    });
    await sweepProviderMachine(harness.deps, host.id);
    expect(suspend).not.toHaveBeenCalled();
    const reconciling = reconcileMachine(harness.deps, host.id);
    await expect.poll(() => suspend.mock.calls.length).toBe(1);
    const waking = resumeMachine(harness.deps, host.id);
    expect(resume).not.toHaveBeenCalled();
    finish();
    await reconciling;
    await waking;
    expect(resume).toHaveBeenCalledOnce();
    expect(getHost(harness.db, host.id)?.phase).toBe("active");
    await reconcileMachine(harness.deps, host.id);
    expect(suspend).toHaveBeenCalledOnce();
  }));

it("exposes reconciliation through the host API without changing active intent", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "reconcile-api" });
    const suspend = vi.fn(async () => ({ resource: { id: "saved" } }));
    installMachineProvider({
      suspend,
      resume: async ({ resource }) => ({ resource }),
    });
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "test-machine",
      phase: "active",
      resource: { id: "running" },
    });
    const response = await harness.app.request(
      `/api/v1/hosts/${host.id}/reconcile`,
      { method: "POST" },
    );
    expect(response.status).toBe(202);
    expect(suspend).not.toHaveBeenCalled();
    expect(getHost(harness.db, host.id)?.phase).toBe("active");
  }));

it("accepts reconciliation before the provider finishes and coalesces repeated requests", async () =>
  withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      id: "reconcile-slow",
    });
    harness.hub.unregisterDaemon(session.id);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const suspend = vi.fn(async () => {
      await pending;
      return { resource: { id: "saved" } };
    });
    installMachineProvider({
      suspend,
      resume: async ({ resource }) => ({ resource }),
    });
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "test-machine",
      phase: "suspended",
      suspendedAt: 1,
      resource: { id: "running" },
    });
    try {
      const response = await harness.app.request(
        `/api/v1/hosts/${host.id}/reconcile`,
        { method: "POST" },
      );
      expect(response.status).toBe(202);
      await expect.poll(() => suspend.mock.calls.length).toBe(1);
      expect(getHost(harness.db, host.id)?.phase).toBe("suspending");
      const repeated = await harness.app.request(
        `/api/v1/hosts/${host.id}/reconcile`,
        { method: "POST" },
      );
      expect(repeated.status).toBe(202);
      expect(suspend).toHaveBeenCalledOnce();
    } finally {
      finish();
      await expect
        .poll(() => getHost(harness.db, host.id)?.phase)
        .toBe("suspended");
    }
  }));

it("holds the machine drain deadline while the server is moving", async () =>
  withTestHarness({ terminalCloseTimeoutMs: 60 * 60_000 }, async (harness) => {
    const target = seedHostSession(harness.deps, {
      id: "review-frozen-drain",
    });
    createTerminalSession(harness.db, {
      cols: 80,
      daemonSessionId: target.session.id,
      environmentId: null,
      hostId: target.host.id,
      initialCwd: "~",
      rows: 24,
      status: "running",
      threadId: null,
      title: "zsh",
    });
    const save = vi.fn(async () => {});
    vi.useFakeTimers();
    const outcome = maintainMachine(
      harness.deps,
      target.host.id,
      "operation-frozen-drain",
      save,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    setServerMoveFrozen(harness.db, true);
    try {
      await vi.advanceTimersByTimeAsync(
        5 * 60_000 + SERVER_MOVE_FROZEN_RETRY_MS,
      );
      expect(getHost(harness.db, target.host.id)).toMatchObject({
        phase: "suspending",
        suspendRetryAt: null,
      });
    } finally {
      setServerMoveFrozen(harness.db, false);
    }

    expect(
      await advanceUntilSettled(outcome, SERVER_MOVE_FROZEN_RETRY_MS),
    ).toMatchObject({
      message: "Machine drain exceeded its deadline; old compute is retained",
    });
    expect(save).not.toHaveBeenCalled();
    expect(getHost(harness.db, target.host.id)?.phase).toBe("active");
    expect(getHost(harness.db, target.host.id)?.suspendRetryAt).not.toBeNull();
  }));
