import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createEnvironment,
  environments,
  getEnvironment,
  getHost,
  updateHost,
} from "@bb/db";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  forceMachineRemoval,
  requestMachineRemoval,
  retryMachineCleanup,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { callPluginHostRpc } from "../../../src/services/plugins/plugin-host-rpc.js";
import { installMachineProvider } from "../../helpers/machine-provider.js";
import { readJson } from "../../helpers/json.js";
import { setPluginThreadEventEmitter } from "../../../src/services/plugins/plugin-thread-events.js";
import {
  requestEnvironmentRemoval,
  sweepProviderEnvironment,
} from "../../../src/services/environments/environment-engine.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";
import type { TestAppHarness as TestHarness } from "../../helpers/test-app.js";

const API = "/api/v1";

afterEach(() => {
  vi.restoreAllMocks();
  setPluginMachineProviderBridge(undefined);
  setPluginEnvironmentProviderBridge(undefined);
  setPluginThreadEventEmitter(undefined);
});

function captureEnvironmentRemovals(): string[] {
  const removed: string[] = [];
  const ignore = () => {};
  setPluginThreadEventEmitter({
    emitThreadEvents: ignore,
    emitTerminalInput: ignore,
    emitHostDeleted: ignore,
    emitEnvironmentRemoved: (removal) => {
      removed.push(removal.environmentId);
    },
    emitThreadCreated: ignore,
    emitThreadActive: ignore,
    emitThreadIdle: ignore,
    emitThreadFailed: ignore,
    emitThreadArchived: ignore,
    emitThreadUnarchived: ignore,
    emitThreadParentChanged: ignore,
    emitThreadDeleted: ignore,
    emitMessageQueued: ignore,
    emitMessageDispatched: ignore,
    emitMessageCancelled: ignore,
    emitInteractionPending: ignore,
    emitTurnFailed: ignore,
  });
  return removed;
}

function seedMachineWithWorkspace(
  harness: TestHarness,
  options: {
    machineRemove?: () => Promise<
      { status: "removed" } | { status: "failed"; message: string }
    >;
    workspaceRemove?: () => Promise<{ status: "removed" }>;
  } = {},
) {
  const target = seedHostSession(harness.deps, { id: "gone-machine" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: target.host.id,
  });
  const machineRemove = vi.fn(
    options.machineRemove ?? (async () => ({ status: "removed" as const })),
  );
  installMachineProvider({ remove: machineRemove });
  updateHost(harness.db, harness.hub, target.host.id, {
    machineProviderId: "test-machine",
    resource: { id: "owned" },
  });
  const environment = createEnvironment(harness.db, harness.hub, {
    projectId: project.id,
    hostId: target.host.id,
    path: "/tmp/gone-worktree",
    providerOwnsPath: true,
    status: "ready",
    environmentProvider: null,
  });
  harness.db
    .update(environments)
    .set({
      environmentProviderId: "gone-worktree",
      environmentProviderPluginId: "gone-worktree-plugin",
      environmentProviderInstanceKey: "gone-worktree",
    })
    .where(eq(environments.id, environment.id))
    .run();
  const workspaceRemove = vi.fn(
    options.workspaceRemove ??
      (async () => {
        await callPluginHostRpc(harness.deps, {
          pluginId: "gone-worktree-plugin",
          hostId: target.host.id,
          contract: { remove: { input: z.object({}), output: z.object({}) } },
          method: "remove",
          input: {},
          timeoutMs: 100,
          artifact: {
            path: "/tmp/gone-artifact",
            generation: "1",
            digest: "a".repeat(64),
            byteLength: 1,
          },
        });
        return { status: "removed" as const };
      }),
  );
  const record = {
    pluginId: "gone-worktree-plugin",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: "gone-worktree",
      displayName: "Gone worktree",
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      create: async () => ({
        status: "created",
        path: "/tmp/gone-worktree",
        ownsPath: true,
      }),
      remove: workspaceRemove,
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
  return { target, environment, machineRemove, workspaceRemove };
}

async function strandRemoval(
  harness: TestHarness,
  hostId: string,
  sessionId: string,
) {
  harness.hub.unregisterDaemon(sessionId);
  expect(requestMachineRemoval(harness.deps, hostId)).toBe(true);
  await sweepProviderMachine(harness.deps, hostId);
}

it("finishes removing a machine whose workspace cleanup cannot reach it", async () =>
  withTestHarness(async (harness) => {
    const { target, environment, machineRemove, workspaceRemove } =
      seedMachineWithWorkspace(harness);
    await strandRemoval(harness, target.host.id, target.session.id);
    expect(getHost(harness.db, target.host.id)).toMatchObject({
      phase: "removing",
      teardownStatus: "failed",
      destroyedAt: null,
    });
    const removals = captureEnvironmentRemovals();
    await retryMachineCleanup(harness.deps, target.host.id);
    expect(getHost(harness.db, target.host.id)).toMatchObject({
      phase: "removing",
      teardownStatus: "failed",
    });
    expect(machineRemove).not.toHaveBeenCalled();

    await forceMachineRemoval(harness.deps, target.host.id);

    expect(getHost(harness.db, target.host.id)).toMatchObject({
      phase: "destroyed",
      teardownStatus: "removed",
    });
    expect(getHost(harness.db, target.host.id)?.destroyedAt).not.toBeNull();
    expect(getEnvironment(harness.db, environment.id)).toMatchObject({
      status: "destroyed",
      teardownStatus: "removed",
      path: null,
    });
    expect(machineRemove).toHaveBeenCalledOnce();
    expect(removals).toEqual([environment.id]);
    const attempts = workspaceRemove.mock.calls.length;
    await sweepProviderMachine(harness.deps, target.host.id);
    expect(workspaceRemove.mock.calls.length).toBe(attempts);
  }));

it("refuses to skip cleanup before teardown has failed", async () =>
  withTestHarness(async (harness) => {
    const { target, machineRemove } = seedMachineWithWorkspace(harness);
    harness.hub.unregisterDaemon(target.session.id);
    await expect(
      forceMachineRemoval(harness.deps, target.host.id),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "machine_cleanup_not_failed" },
    });
    expect(getHost(harness.db, target.host.id)?.phase).not.toBe("destroyed");
    expect(machineRemove).not.toHaveBeenCalled();
  }));

it("refuses to skip cleanup while the machine is connected", async () =>
  withTestHarness(async (harness) => {
    const { target, environment, machineRemove } =
      seedMachineWithWorkspace(harness);
    expect(requestMachineRemoval(harness.deps, target.host.id)).toBe(true);
    updateHost(harness.db, harness.hub, target.host.id, {
      teardownStatus: "failed",
      statusMessage: "Workspace cleanup temporarily failed",
    });
    await expect(
      forceMachineRemoval(harness.deps, target.host.id),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "machine_connected" },
    });
    expect(getEnvironment(harness.db, environment.id)).toMatchObject({
      status: "ready",
    });
    expect(machineRemove).not.toHaveBeenCalled();
  }));

it("exposes forced removal as a forced machine delete", async () =>
  withTestHarness(async (harness) => {
    const { target, machineRemove } = seedMachineWithWorkspace(harness);
    const early = await harness.app.request(
      `${API}/hosts/${target.host.id}?force=true`,
      { method: "DELETE" },
    );
    expect(early.status).toBe(409);
    expect(await readJson(early)).toMatchObject({
      code: "machine_cleanup_not_failed",
    });
    await strandRemoval(harness, target.host.id, target.session.id);
    const response = await harness.app.request(
      `${API}/hosts/${target.host.id}?force=true`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true });
    expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
    expect(machineRemove).toHaveBeenCalledOnce();
    const missing = await harness.app.request(
      `${API}/hosts/${target.host.id}?force=true`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  }));

it("keeps a forgotten environment removed when an in-flight teardown fails late", async () =>
  withTestHarness(async (harness) => {
    let failLate: (error: Error) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const { target, environment } = seedMachineWithWorkspace(harness, {
      workspaceRemove: () => {
        markStarted();
        return new Promise((_resolve, reject) => {
          failLate = reject;
        });
      },
    });
    harness.db
      .update(environments)
      .set({ providerOwnsPath: false })
      .where(eq(environments.id, environment.id))
      .run();
    harness.hub.unregisterDaemon(target.session.id);
    expect(requestMachineRemoval(harness.deps, target.host.id)).toBe(true);
    expect(requestEnvironmentRemoval(harness.deps, environment.id)).toBe(true);
    const sweep = sweepProviderEnvironment(harness.deps, environment.id);
    await started;
    harness.db
      .update(environments)
      .set({ status: "destroyed", teardownStatus: "removed", path: null })
      .where(eq(environments.id, environment.id))
      .run();
    failLate(new Error("Host is not connected"));
    await sweep;
    expect(getEnvironment(harness.db, environment.id)).toMatchObject({
      status: "destroyed",
      teardownStatus: "removed",
    });
  }));

it("leaves a provider removal failure retryable after skipping cleanup", async () =>
  withTestHarness(async (harness) => {
    let providerDown = true;
    const { target, environment, machineRemove } = seedMachineWithWorkspace(
      harness,
      {
        machineRemove: async () =>
          providerDown
            ? { status: "failed", message: "Provider API unavailable" }
            : { status: "removed" },
      },
    );
    await strandRemoval(harness, target.host.id, target.session.id);
    await forceMachineRemoval(harness.deps, target.host.id);
    expect(getHost(harness.db, target.host.id)).toMatchObject({
      phase: "removing",
      teardownStatus: "failed",
      statusMessage: "Provider API unavailable",
    });
    expect(getEnvironment(harness.db, environment.id)).toMatchObject({
      status: "destroyed",
      teardownStatus: "removed",
    });
    await expect(
      forceMachineRemoval(harness.deps, target.host.id),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: "machine_cleanup_not_blocked" },
    });
    providerDown = false;
    await retryMachineCleanup(harness.deps, target.host.id);
    expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
    expect(machineRemove).toHaveBeenCalledTimes(2);
  }));

it("skips cleanup for a stranded machine that was suspended without resuming it", async () =>
  withTestHarness(async (harness) => {
    const resume = vi.fn(async () => ({ resource: { id: "owned" } }));
    const { target, environment, machineRemove } =
      seedMachineWithWorkspace(harness);
    installMachineProvider({
      remove: machineRemove,
      resume,
      suspend: async () => ({ resource: { id: "owned" } }),
    });
    harness.hub.unregisterDaemon(target.session.id);
    expect(requestMachineRemoval(harness.deps, target.host.id)).toBe(true);
    updateHost(harness.db, harness.hub, target.host.id, {
      suspendedAt: Date.now(),
      teardownStatus: "failed",
      statusMessage: "Machine resume failed: compute is gone",
    });
    await forceMachineRemoval(harness.deps, target.host.id);
    expect(resume).not.toHaveBeenCalled();
    expect(getEnvironment(harness.db, environment.id)?.status).toBe(
      "destroyed",
    );
    expect(getHost(harness.db, target.host.id)?.phase).toBe("destroyed");
    expect(machineRemove).toHaveBeenCalledOnce();
  }));
