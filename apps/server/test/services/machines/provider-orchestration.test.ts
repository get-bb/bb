import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvironment,
  createHostId,
  environments,
  getHost,
  getEnvironment,
  hosts,
  archiveThread,
  setThreadStartupContext,
  updateHost,
} from "@bb/db";
import { createDeferredPromise } from "@bb/test-helpers";
import { eq } from "drizzle-orm";
import type { JsonValue } from "@bb/domain";
import type { PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  askMachineLaunch,
  requestAutomaticMachineRemoval,
  requestMachineRemoval,
  requestMachineSuspension,
  submitMachine,
  sweepMachineLifecycles,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import {
  ensureProjectSourceOnHost,
  hasPendingProjectSourceSetupOnHost,
} from "../../../src/services/projects/project-source-setup.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import {
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
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
});

describe("machine creation hosts", () => {
  it("recovers a persisted creating host with its original launch key", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const calls: Array<{ attempt: number; key: string }> = [];
      installMachineProvider({
        create: async ({ attempt, key }) => {
          calls.push({ attempt, key });
          started.resolve();
          await release.promise;
          return {
            status: "created",
            name: "Recovered machine",
            resource: { allocation: "same" },
          };
        },
      });

      const submitted = await submitMachine(harness.deps, {
        key: "thread-machine",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await started.promise;
      expect(submitted).toMatchObject({
        id: expect.stringMatching(/^host_/u),
        lifecycle: {
          phase: "creating",
          message: "Creating Test machine…",
        },
      });
      expect(getHost(harness.db, submitted.id)).toMatchObject({
        launchKey: "thread-machine",
        attempt: 1,
        phase: "creating",
      });

      release.resolve();
      await expect
        .poll(() => getHost(harness.db, submitted.id)?.phase)
        .toBe("active");
      expect(calls).toEqual([{ attempt: 1, key: "thread-machine" }]);
      expect(getHost(harness.db, submitted.id)).toMatchObject({
        name: "Recovered machine",
        inputs: null,
        resource: { allocation: "same" },
      });

      const restartedId = createHostId();
      const now = Date.now();
      harness.db
        .insert(hosts)
        .values({
          id: restartedId,
          name: "Test machine restart",
          type: "persistent",
          machineProviderId: "test-machine",
          machineOperationId: "test-machine-plugin:restart",
          launchKey: "restart-key",
          inputs: null,
          attempt: 1,
          phase: "creating",
          statusMessage: "Creating Test machine…",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      await sweepMachineLifecycles(harness.deps);
      expect(getHost(harness.db, restartedId)).toMatchObject({
        phase: "active",
        resource: { allocation: "same" },
      });
    }));

  it("uses one live row per launch key and reuses the key after destruction", async () =>
    withTestHarness(async (harness) => {
      const record = installMachineProvider();
      expect(
        askMachineLaunch(harness.deps, {
          lifetime: "standalone",
          key: "stable-key",
          record,
          inputs: null,
        }).action,
      ).toBe("wait");
      await expect
        .poll(
          () =>
            harness.db
              .select()
              .from(hosts)
              .all()
              .find((row) => row.launchKey === "stable-key")?.phase,
        )
        .toBe("active");
      const firstHost = harness.db
        .select()
        .from(hosts)
        .all()
        .find((row) => row.launchKey === "stable-key")!;
      expect(requestMachineRemoval(harness.deps, firstHost.id)).toBe(true);
      await sweepProviderMachine(harness.deps, firstHost.id);
      expect(getHost(harness.db, firstHost.id)?.phase).toBe("destroyed");

      askMachineLaunch(harness.deps, {
        lifetime: "standalone",
        key: "stable-key",
        record,
        inputs: null,
      });
      const rows = harness.db
        .select()
        .from(hosts)
        .all()
        .filter((row) => row.launchKey === "stable-key");
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.destroyedAt === null)).toMatchObject({
        attempt: 2,
        phase: "creating",
      });
    }));

  it("preserves failed creation output until the launch caller consumes it", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const cleanupStarted = createDeferredPromise<void>();
      const finishCleanup = createDeferredPromise<void>();
      const message =
        "Machine bootstrap command failed:\nbb-machine-install: 9: node: not found\nbb-machine-install: 9: curl: not found";
      const record = installMachineProvider({
        create: async ({ report }) => {
          report.step("Bootstrapping machine");
          report.log("bb-machine-install: 9: node: not found\n");
          report.log("bb-machine-install: 9: curl: not found\n");
          return { status: "failed", message };
        },
        reconcileCleanup: async () => {
          cleanupStarted.resolve();
          await finishCleanup.promise;
          return { status: "removed" };
        },
      });

      expect(
        askMachineLaunch(harness.deps, {
          lifetime: "standalone",
          key: "failed-bootstrap",
          record,
          inputs: null,
        }).action,
      ).toBe("wait");
      await expect
        .poll(
          () =>
            harness.db
              .select()
              .from(hosts)
              .all()
              .find((row) => row.launchKey === "failed-bootstrap")?.phase,
        )
        .toBe("removing");

      const rejected = askMachineLaunch(harness.deps, {
        lifetime: "standalone",
        key: "failed-bootstrap",
        record,
        inputs: null,
      });
      expect(rejected).toEqual({
        action: "reject",
        message,
        log: expect.stringContaining("curl: not found"),
      });
      await cleanupStarted.promise;
      const host = harness.db
        .select()
        .from(hosts)
        .all()
        .find((row) => row.launchKey === "failed-bootstrap");
      expect(host).toMatchObject({
        phase: "removing",
        statusMessage: message,
        teardownStatus: "running",
      });

      finishCleanup.resolve();
      await expect
        .poll(() => getHost(harness.db, host!.id)?.phase)
        .toBe("destroyed");
      expect(getHost(harness.db, host!.id)?.statusMessage).toBe(message);
    }));

  it("cancels by removing and reconciles without a checkpoint", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const reconcileCleanup = vi.fn(async () => ({
        status: "removed" as const,
      }));
      installMachineProvider({
        create: async ({ signal }) => {
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          throw new Error("unreachable");
        },
        reconcileCleanup,
      });
      const host = await submitMachine(harness.deps, {
        key: "cancel-key",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await started.promise;

      const response = await harness.app.request(`/api/v1/hosts/${host.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(reconcileCleanup).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("removes a checkpoint and fences stale checkpoint ownership", async () =>
    withTestHarness(async (harness) => {
      const checkpointed = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      let lateCheckpoint:
        | ((value: Exclude<JsonValue, null>) => Promise<void>)
        | undefined;
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installMachineProvider({
        create: async ({ checkpoint, signal }) => {
          lateCheckpoint = checkpoint;
          await checkpoint({ allocation: "one" });
          checkpointed.resolve();
          await release.promise;
          signal.throwIfAborted();
          return {
            status: "created",
            name: "Checkpointed machine",
            resource: { allocation: "one" },
          };
        },
        remove,
      });
      const host = await submitMachine(harness.deps, {
        key: "checkpoint-key",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await checkpointed.promise;
      const operationId = getHost(harness.db, host.id)!.machineOperationId;
      updateHost(harness.db, harness.hub, host.id, {
        machineOperationId: "test-machine-plugin:replacement-owner",
      });
      await expect(lateCheckpoint?.({ allocation: "stale" })).rejects.toThrow(
        "no longer owns",
      );
      updateHost(harness.db, harness.hub, host.id, {
        machineOperationId: operationId,
      });
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      release.resolve();
      await sweepProviderMachine(harness.deps, host.id);
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: host.id,
          resource: { allocation: "one" },
        }),
      );
    }));
});

describe("machine retirement", () => {
  it.each([1, 2])(
    "retires each of %i machines only after every project and shared environment releases it",
    async (machineCount) =>
      withTestHarness(async (harness) => {
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        installMachineProvider({ ephemeral: true, remove });
        const machineIds = Array.from({ length: machineCount }, () => {
          const id = createHostId();
          const now = Date.now();
          harness.db
            .insert(hosts)
            .values({
              id,
              name: id,
              type: "ephemeral",
              machineProviderId: "test-machine",
              phase: "active",
              resource: { allocation: id },
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return id;
        });
        const projects = ["alpha", "beta"].map(
          (name) =>
            seedProjectWithSource(harness.deps, {
              hostId: machineIds[0],
              path: `/tmp/${name}`,
            }).project,
        );
        const allocations = machineIds.map((hostId) => ({
          hostId,
          environments: projects.flatMap((project) =>
            ["checkout", "worktree"].map((kind) => {
              const environment = createEnvironment(harness.db, harness.hub, {
                projectId: project.id,
                hostId,
                path: `/tmp/${hostId}/${project.id}/${kind}`,
                providerOwnsPath: false,
                status: "ready",
                environmentProvider: null,
              });
              return {
                environment,
                threads: Array.from({ length: 2 }, () =>
                  seedThread(harness.deps, {
                    projectId: project.id,
                    environmentId: environment.id,
                    status: "idle",
                  }),
                ),
              };
            }),
          ),
        }));
        for (const allocation of allocations) {
          updateHost(harness.db, harness.hub, allocation.hostId, {
            launchKey: allocation.environments[0].threads[0].id,
          });
          const owners = allocation.environments.flatMap(
            (entry) => entry.threads,
          );
          for (const [index, thread] of owners.entries()) {
            expect(
              requestAutomaticMachineRemoval(harness.deps, allocation.hostId),
            ).toBe(false);
            archiveThread(harness.db, harness.hub, thread.id);
            expect(
              requestAutomaticMachineRemoval(harness.deps, allocation.hostId),
            ).toBe(index === owners.length - 1);
          }
          await sweepProviderMachine(harness.deps, allocation.hostId);
          expect(getHost(harness.db, allocation.hostId)).toMatchObject({
            phase: "destroyed",
            teardownAttempt: 1,
            teardownStatus: "removed",
            resource: null,
          });
          for (const entry of allocation.environments) {
            expect(
              getEnvironment(harness.db, entry.environment.id)?.status,
            ).toBe("destroyed");
          }
          for (const other of allocations.slice(
            allocations.indexOf(allocation) + 1,
          )) {
            expect(getHost(harness.db, other.hostId)?.phase).toBe("active");
            for (const entry of other.environments) {
              expect(
                getEnvironment(harness.db, entry.environment.id)?.status,
              ).toBe("ready");
            }
          }
        }
        expect(remove).toHaveBeenCalledTimes(machineCount);
      }),
  );

  it("preserves explicit removal of a machine with an unattached pending start", async () =>
    withTestHarness(async (harness) => {
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installMachineProvider({ ephemeral: true, remove });
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "pending",
      });
      setThreadStartupContext(harness.db, {
        threadId: thread.id,
        startupContext: JSON.stringify({
          kind: "pending",
          environmentIntent: {
            type: "provider",
            machine: { type: "existing", hostId: host.id },
          },
        }),
      });
      updateHost(harness.db, harness.hub, host.id, {
        type: "ephemeral",
        machineProviderId: "test-machine",
        resource: {},
      });
      expect(requestAutomaticMachineRemoval(harness.deps, host.id)).toBe(false);
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      await sweepProviderMachine(harness.deps, host.id);
      expect(remove).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
    }));

  it("keeps a persistent machine with no threads", async () =>
    withTestHarness(async (harness) => {
      installMachineProvider();
      const { host } = seedHostSession(harness.deps);
      updateHost(harness.db, harness.hub, host.id, {
        machineProviderId: "test-machine",
        type: "persistent",
        phase: "active",
        resource: { allocation: "persistent" },
      });
      expect(requestAutomaticMachineRemoval(harness.deps, host.id)).toBe(false);
      expect(getHost(harness.db, host.id)?.phase).toBe("active");
    }));

  it("waits for in-flight cleanup before a second sweep completes", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const remove = vi.fn(async () => {
        started.resolve();
        await release.promise;
        return { status: "removed" as const };
      });
      installMachineProvider({ remove });
      const { host } = seedHostSession(harness.deps);
      updateHost(harness.db, harness.hub, host.id, {
        machineProviderId: "test-machine",
        resource: { allocation: "cancelled" },
        phase: "active",
      });
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      const first = sweepProviderMachine(harness.deps, host.id);
      await started.promise;
      let settled = false;
      const second = sweepProviderMachine(harness.deps, host.id).then(() => {
        settled = true;
      });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
      } finally {
        release.resolve();
        await Promise.all([first, second]);
      }
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
      expect(remove).toHaveBeenCalledOnce();
    }));

  it("retries failed teardown at removeRetryAt", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const remove = vi
        .fn()
        .mockResolvedValueOnce({ status: "failed" as const, message: "busy" })
        .mockResolvedValueOnce({ status: "removed" as const });
      installMachineProvider({ remove });
      const id = createHostId();
      harness.db
        .insert(hosts)
        .values({
          id,
          name: "Remove me",
          type: "ephemeral",
          machineProviderId: "test-machine",
          phase: "active",
          resource: { allocation: "one" },
          createdAt: 1,
          updatedAt: 1,
        })
        .run();

      await sweepMachineLifecycles(harness.deps);
      expect(getHost(harness.db, id)).toMatchObject({
        phase: "removing",
        removeRetryAt: 80_000,
        teardownStatus: "failed",
      });
      vi.setSystemTime(79_999);
      await sweepMachineLifecycles(harness.deps);
      expect(remove).toHaveBeenCalledOnce();
      vi.setSystemTime(80_000);
      await sweepMachineLifecycles(harness.deps);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(getHost(harness.db, id)?.phase).toBe("destroyed");
    }));
});

describe("machine suspension", () => {
  it("returns the durable resuming phase from an explicit resume request", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const target = seedHostSession(harness.deps, { id: "explicit-resume" });
      installMachineProvider({
        suspend: async () => ({ resource: { id: "owned" } }),
        resume: async () => {
          started.resolve();
          await release.promise;
          return { resource: { id: "owned" } };
        },
      });
      updateHost(harness.db, harness.hub, target.host.id, {
        machineProviderId: "test-machine",
        phase: "suspended",
        resource: { id: "owned" },
        suspendedAt: Date.now(),
      });
      harness.hub.unregisterDaemon(target.session.id);
      const notifyHost = vi.spyOn(harness.hub, "notifyHost");

      const response = await harness.app.request(
        `/api/v1/hosts/${target.host.id}/resume`,
        { method: "POST" },
      );
      await started.promise;
      try {
        expect(response.status).toBe(202);
        expect(await readJson(response)).toMatchObject({
          lifecycle: { phase: "resuming" },
        });
        expect(getHost(harness.db, target.host.id)?.phase).toBe("resuming");
        expect(notifyHost).toHaveBeenCalledWith(target.host.id, [
          "host-disconnected",
        ]);
      } finally {
        release.resolve();
      }

      await expect
        .poll(() => getHost(harness.db, target.host.id)?.phase)
        .toBe("active");
    }));

  it("rejects each persisted provisioning state and suspends after all clear", async () =>
    withTestHarness(async (harness) => {
      const source = seedHostSession(harness.deps, { id: "setup-source" });
      const target = seedHostSession(harness.deps, { id: "setup-target" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: source.host.id,
      });
      const suspend = vi.fn(async () => ({ resource: { id: "owned" } }));
      installMachineProvider({
        suspend,
        resume: async () => ({ resource: { id: "owned" } }),
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
      });
      updateHost(harness.db, harness.hub, target.host.id, {
        machineProviderId: "test-machine",
        launchKey: thread.id,
        resource: { id: "owned" },
      });

      const expectBusy = async () => {
        const response = await harness.app.request(
          `/api/v1/hosts/${target.host.id}/suspend`,
          { method: "POST" },
        );
        expect(response.status).toBe(409);
        expect(await readJson(response)).toMatchObject({
          code: "machine_busy",
          message:
            "Wait for thread provisioning to finish before suspending this machine.",
        });
        expect(getHost(harness.db, target.host.id)?.phase).toBe("active");
        expect(suspend).not.toHaveBeenCalled();
      };

      await expectBusy();
      archiveThread(harness.db, harness.hub, thread.id);

      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: target.host.id,
        path: "/tmp/provisioning-environment",
        providerOwnsPath: false,
        status: "provisioning",
        environmentProvider: null,
      });
      await expectBusy();
      harness.db
        .update(environments)
        .set({ status: "ready" })
        .where(eq(environments.id, environment.id))
        .run();

      const setup = ensureProjectSourceOnHost(harness.deps, {
        projectId: project.id,
        projectName: project.name,
        hostId: target.host.id,
        remoteUrl: "https://example.test/team/project.git",
      }).then(
        () => null,
        (error: unknown) => error,
      );
      const path = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "project.clone_default_path",
      );
      expect(
        hasPendingProjectSourceSetupOnHost(harness.db, target.host.id),
      ).toBe(true);
      await expectBusy();

      await reportQueuedCommandError(harness, path, {
        errorCode: "git_auth_failed",
        errorMessage: "Stop project setup",
      });
      expect(await setup).toBeInstanceOf(Error);
      expect(
        hasPendingProjectSourceSetupOnHost(harness.db, target.host.id),
      ).toBe(false);

      await requestMachineSuspension(harness.deps, target.host.id);
      expect(suspend).toHaveBeenCalledOnce();
      expect(getHost(harness.db, target.host.id)?.phase).toBe("suspended");
    }));
});

it.each(["null result", "null checkpoint", "missing name"])(
  "rejects a provider's %s and retains a cleanup path",
  async (invalid) =>
    withTestHarness(async (harness) => {
      const reconcileCleanup = vi.fn(async () => ({
        status: "removed" as const,
      }));
      const record = installMachineProvider({ reconcileCleanup });
      Reflect.set(
        record.provider,
        "create",
        async (
          context: Parameters<PluginMachineProviderDeclaration["create"]>[0],
        ) => {
          if (invalid === "null checkpoint")
            await Reflect.apply(context.checkpoint, undefined, [null]);
          if (invalid === "missing name")
            return { status: "created", resource: {} };
          return { status: "created", name: "Invalid machine", resource: null };
        },
      );
      const host = await submitMachine(harness.deps, {
        key: "invalid-resource",
        machineProviderId: record.provider.id,
        inputs: null,
      });
      await expect
        .poll(() => getHost(harness.db, host.id)?.phase)
        .toBe("removing");
      expect(getHost(harness.db, host.id)?.teardownStatus).toBe("failed");
      expect(getHost(harness.db, host.id)?.resource).toBeNull();
      requestMachineRemoval(harness.deps, host.id);
      await sweepProviderMachine(harness.deps, host.id);
      expect(reconcileCleanup).toHaveBeenCalledWith({
        key: "invalid-resource",
        report: expect.any(Object),
        signal: expect.any(AbortSignal),
      });
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
    }),
);
