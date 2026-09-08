import { hash, resourcesSchema, policySchema } from "./catalogue/model.js";
import { createWorkerImageBackend } from "./catalogue/worker.js";
export { runImageBuildWorker } from "./catalogue/worker.js";
import type { ImageBackendFactory } from "./catalogue/backend.js";
import {
  createCatalogueService,
  accountIdentity,
} from "./catalogue/service.js";
import { registerCatalogueCli } from "./catalogue/cli.js";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderCreateResult,
} from "@get-bb/plugin-sdk/machine-provider";
import {
  resolveSettings,
  SETTING_DESCRIPTORS,
  type ResolvedSettings,
} from "./configuration.js";
import {
  createModalBackend,
  createSandboxExecutor,
  type SandboxBackend,
  type SandboxBackendFactory,
  type SandboxHandle,
} from "./sandbox-backend.js";
import {
  readModalMachineResource,
  pinnedResourceSchema,
  type ModalMachineResource,
} from "./lifecycle.js";

export const PROVIDER_ID = "modal-sandbox";

const allocationSchema = z
  .object({
    appName: z.string().min(1),
    sandboxId: z.string().min(1).nullable(),
    resource: pinnedResourceSchema.nullable().default(null),
    accountIdentity: z.string().nullable().default(null),
  })
  .strict();

const HOST_CONNECT_TIMEOUT_MS = 240_000;
const HOST_POLL_INTERVAL_MS = 3_000;
const DAEMON_STOP_TIMEOUT_MS = 60_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;
const REMOVE_RETRY_MS = 30_000;
const RETIRE_GRACE_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_IDLE_MS = 15 * 60_000;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ModalSandboxDeps {
  backendFactory: SandboxBackendFactory;
  imageBackendFactory?: ImageBackendFactory;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
}

export function createModalSandboxPlugin(
  deps: ModalSandboxDeps,
): (bb: BbPluginApi) => Promise<void> {
  return async (bb) => {
    const settings = bb.settings.define(SETTING_DESCRIPTORS);
    let cachedBackend: { token: string; backend: SandboxBackend } | null = null;

    async function currentSettings(): Promise<
      { ok: true; settings: ResolvedSettings } | { ok: false; message: string }
    > {
      return resolveSettings(await settings.get());
    }

    const catalogue = createCatalogueService(
      bb,
      async () => {
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        return resolved.settings;
      },
      deps.imageBackendFactory ?? createWorkerImageBackend(import.meta.url),
      deps.now,
    );
    registerCatalogueCli(bb, catalogue);

    function backendFor(resolved: ResolvedSettings): SandboxBackend {
      const token = `${resolved.tokenId}:${resolved.tokenSecret}`;
      if (cachedBackend?.token === token) return cachedBackend.backend;
      const backend = deps.backendFactory({
        tokenId: resolved.tokenId,
        tokenSecret: resolved.tokenSecret,
      });
      cachedBackend = { token, backend };
      return backend;
    }

    async function waitForHostDisconnection(
      hostId: string,
      signal: AbortSignal,
    ): Promise<void> {
      const deadline = deps.now() + HOST_CONNECT_TIMEOUT_MS;
      for (;;) {
        signal.throwIfAborted();
        const host = (await bb.sdk.hosts.list()).find(
          (candidate) => candidate.id === hostId,
        );
        if (host?.status !== "connected") return;
        if (deps.now() >= deadline) {
          throw new Error(`host ${hostId} remained connected after suspension`);
        }
        await deps.sleep(HOST_POLL_INTERVAL_MS);
      }
    }

    async function launch(
      context: PluginMachineProviderCreateContext,
    ): Promise<PluginMachineProviderCreateResult> {
      const resolved = await currentSettings();
      if (!resolved.ok) {
        return {
          status: "failed",
          failure: "terminal",
          message: resolved.message,
        };
      }
      const backend = backendFor(resolved.settings);
      try {
        if (!context.project)
          throw new Error("Modal image launches require a project");
        const inputs = machineInputsSchema.parse(context.inputs ?? {});
        const configured = catalogue.store.project(context.project.id);
        const buildId = inputs.buildId ?? configured.usableBuildId;
        if (!buildId)
          throw new Error(
            "Verify and promote a project image, or provide an explicit ready build ID",
          );
        const build = catalogue.store.build(buildId);
        if (
          build.projectId !== context.project.id ||
          build.state !== "ready" ||
          !build.imageId
        )
          throw new Error("Choose a ready build for this project");
        if (
          build.accountIdentity !==
          (await accountIdentity(resolved.settings, catalogue.backendFactory))
        )
          throw new Error(
            "Build belongs to a different Modal account; restore its account configuration",
          );
        if (
          !(await catalogue
            .backendFactory(resolved.settings)
            .resolve(build.imageId))
        )
          throw new Error(
            "Selected Modal image is missing; explicitly rebuild before launch",
          );
        if (inputs.appName && inputs.appName !== build.appName)
          throw new Error(
            "The selected build is pinned to a different Modal app",
          );
        const project = {
          ...configured,
          resources: resourcesSchema.parse({
            ...configured.resources,
            ...inputs.resources,
          }),
          policy: policySchema.parse({
            ...configured.policy,
            ...inputs.policy,
          }),
        };
        context.signal.throwIfAborted();
        await bb.experimental_machines.prepareEnrollment({ key: context.key });
        catalogue.store.reference(buildId, "allocation", context.key);
        context.signal.throwIfAborted();
        let sandbox = await backend.fromName(build.appName, context.key);
        const intentKey = `allocation/${context.key}`;
        const stored = await bb.storage.kv.get<unknown>(intentKey);
        const intent =
          stored === undefined ? null : allocationSchema.parse(stored);
        if (
          intent?.accountIdentity &&
          intent.accountIdentity !== build.accountIdentity
        )
          throw new Error("Allocation account differs from the pinned account");
        if (intent?.resource && intent.resource.buildId !== buildId)
          throw new Error("Allocation key belongs to a different image build");
        if (sandbox === null && stored !== undefined) {
          return {
            status: "failed",
            failure: "transient",
            message:
              "Modal allocation intent is unresolved; reconcile its name before retrying.",
          };
        }
        if (sandbox === null) {
          context.signal.throwIfAborted();
          await bb.storage.kv.set(intentKey, {
            appName: build.appName,
            sandboxId: null,
            resource: null,
            accountIdentity: build.accountIdentity,
          });
          context.report.step("Creating the Modal sandbox…");
          sandbox = await backend.create({
            appName: build.appName,
            name: context.key,
            image: { type: "image", imageId: build.imageId },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: project.policy.lifetimeMinutes * 60000,
            cpu: project.resources.cpuCores,
            memoryMiB: project.resources.memoryMiB,
            tags: { bbMachineKey: context.key },
          });
        }
        const allocation: ModalMachineResource = intent?.resource ?? {
          version: 4,
          buildId,
          imageId: build.imageId,
          accountRef: "default",
          accountIdentity: build.accountIdentity,
          appName: build.appName,
          resources: project.resources,
          policy: project.policy,
          policyRevision: project.revision,
          expiresAt: deps.now() + project.policy.lifetimeMinutes * 60000,
          key: context.key,
          sandboxId: sandbox.sandboxId,
          snapshotImageId: null,
          pendingSnapshotImageIds: [],
        };
        await context.checkpoint(allocation);
        await bb.storage.kv.set(intentKey, {
          appName: build.appName,
          sandboxId: sandbox.sandboxId,
          resource: allocation,
          accountIdentity: build.accountIdentity,
        });
        context.signal.throwIfAborted();
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: context.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "preinstalled" },
          report: context.report,
          signal: context.signal,
        });
        context.signal.throwIfAborted();
        return { status: "created", hostId, resource: allocation };
      } catch (error) {
        context.signal.throwIfAborted();
        return {
          status: "failed",
          failure: "transient",
          message: errorMessage(error),
        };
      }
    }

    async function findSandbox(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
    ): Promise<SandboxHandle | null> {
      if (
        resource.version === 4 &&
        resource.accountIdentity !==
          (await accountIdentity(resolved, catalogue.backendFactory))
      )
        throw new Error(
          "Restore the machine’s pinned Modal account before lifecycle operations",
        );
      if (resource.sandboxId !== null) {
        const byId = await backendFor(resolved).fromId(resource.sandboxId);
        if (byId !== null) return byId;
      }
      return backendFor(resolved).fromName(
        resource.version === 4 ? resource.appName : resolved.appName,
        resource.key,
      );
    }

    async function deletePendingSnapshots(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
      checkpoint?: (resource: ModalMachineResource) => void,
    ): Promise<ModalMachineResource> {
      if (
        resource.version === 4 &&
        resource.accountIdentity !==
          (await accountIdentity(resolved, catalogue.backendFactory))
      )
        throw new Error(
          "Restore the machine’s pinned Modal account before snapshot cleanup",
        );
      let current = resource;
      for (const imageId of resource.pendingSnapshotImageIds) {
        if (imageId === resource.snapshotImageId) continue;
        await backendFor(resolved).deleteSnapshot(imageId);
        current = {
          ...current,
          pendingSnapshotImageIds: current.pendingSnapshotImageIds.filter(
            (candidate) => candidate !== imageId,
          ),
        };
        checkpoint?.(current);
      }
      return current;
    }

    const configuredAtRegistration = await currentSettings();
    bb.experimental_machines.register({
      id: PROVIDER_ID,
      displayName: "Modal sandbox",
      icon: "./modal-logo.svg",
      environmentRow: {
        displayName: "New sandbox",
        environmentProviderId: "project-checkout",
      },
      policy: {
        idleSuspendMs: configuredAtRegistration.ok
          ? configuredAtRegistration.settings.idleMs
          : DEFAULT_IDLE_MS,
        retire: { after: "last-thread", graceMs: RETIRE_GRACE_MS },
        removeRetryMs: REMOVE_RETRY_MS,
      },
      async availability() {
        const resolved = await currentSettings();
        return resolved.ok
          ? { status: "available" }
          : { status: "setup-required", message: resolved.message };
      },
      inputs: machineInputsSchema,
      create: launch,
      async experimental_reconcileCleanup(context) {
        const stored = await bb.storage.kv.get<unknown>(
          `allocation/${context.key}`,
        );
        if (stored === undefined) {
          catalogue.store.release("allocation", context.key);
          return { status: "removed" };
        }
        const intent = allocationSchema.parse(stored);
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { status: "failed", message: resolved.message };
        context.signal.throwIfAborted();
        if (
          intent.accountIdentity &&
          intent.accountIdentity !==
            (await accountIdentity(resolved.settings, catalogue.backendFactory))
        )
          return {
            status: "failed",
            message: "Restore the allocation’s pinned account before cleanup",
          };
        const backend = backendFor(resolved.settings);
        const sandbox =
          intent.sandboxId === null
            ? await backend.fromName(intent.appName, context.key)
            : await backend.fromId(intent.sandboxId);
        if (sandbox === null && intent.sandboxId === null)
          return {
            status: "failed",
            message:
              "Modal allocation intent is unresolved; retry name reconciliation.",
          };
        if (sandbox !== null) {
          await bb.storage.kv.set(`allocation/${context.key}`, {
            ...intent,
            sandboxId: sandbox.sandboxId,
          });
          await sandbox.terminate();
        }
        catalogue.store.release("allocation", context.key);
        return { status: "removed" };
      },
      async experimental_observe(context) {
        let resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        context.signal.throwIfAborted();
        const sandbox = await findSandbox(resource, resolved.settings);
        if (resource.version === 4) {
          const project = catalogue.store.project(
            catalogue.store.build(resource.buildId).projectId,
          );
          if (project.revision !== resource.policyRevision)
            resource = {
              ...resource,
              policy: project.policy,
              policyRevision: project.revision,
            };
        }
        if (sandbox === null)
          return {
            state:
              resource.sandboxId === null && resource.snapshotImageId !== null
                ? "suspended"
                : "missing",
            expiresAt: null,
            resource,
          };
        const observed = await backendFor(resolved.settings).observe({
          sandboxId: sandbox.sandboxId,
          appName:
            resource.version === 4
              ? resource.appName
              : resolved.settings.appName,
          key: resource.key,
        });
        return {
          state: observed.running ? "running" : "missing",
          expiresAt: observed.expiresAt,
          resource:
            resource.version === 4
              ? { ...resource, expiresAt: observed.expiresAt }
              : resource,
        };
      },
      async experimental_policy(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        const project =
          resource.version === 4
            ? catalogue.store.project(
                catalogue.store.build(resource.buildId).projectId,
              )
            : null;
        const policy =
          resource.version === 4
            ? project !== null && project.revision !== resource.policyRevision
              ? project.policy
              : resource.policy
            : null;
        const lifetime =
          policy === null
            ? resolved.settings.timeoutMs
            : policy.lifetimeMinutes * 60_000;
        return {
          idleSuspendMs:
            policy === null
              ? resolved.settings.idleMs
              : policy.idleMinutes === 0
                ? null
                : policy.idleMinutes * 60_000,
          retireAfterMs:
            policy === null
              ? 30 * 24 * 60 * 60_000
              : policy.retentionDays * 24 * 60 * 60_000,
          deadlineLeadMs: Math.min(15 * 60_000, Math.floor(lifetime / 2)),
        };
      },
      async suspend(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        const sandbox = await findSandbox(resource, resolved.settings);
        if (sandbox === null) {
          if (resource.snapshotImageId === null) {
            throw new Error("The Modal sandbox has no restorable snapshot.");
          }
          return {
            resource: await deletePendingSnapshots(
              resource,
              resolved.settings,
              context.checkpoint,
            ),
          };
        }
        const remainingMs = () =>
          resource.version === 4 && resource.expiresAt !== null
            ? Math.max(1, Math.floor(resource.expiresAt - deps.now()))
            : SNAPSHOT_TIMEOUT_MS + DAEMON_STOP_TIMEOUT_MS;
        const preservationSignal = AbortSignal.any([
          context.signal,
          AbortSignal.timeout(remainingMs()),
        ]);
        context.report.step("Stopping the bb machine…");
        const stopped = await sandbox.exec(
          [
            "sh",
            "-c",
            'bb_bin=$(command -v bb || true); if [ -z "$bb_bin" ]; then bb_bin="$HOME/.local/bin/bb"; fi; exec "$bb_bin" machine stop --host-id "$1"',
            "sh",
            context.hostId,
          ],
          {
            timeoutMs: Math.min(
              DAEMON_STOP_TIMEOUT_MS,
              Math.max(1, Math.floor(remainingMs() / 3)),
            ),
            signal: preservationSignal,
          },
        );
        if (stopped.exitCode !== 0)
          throw new Error(
            `Stopping the bb machine exited ${stopped.exitCode}: ${stopped.stderr}`,
          );
        await waitForHostDisconnection(context.hostId, preservationSignal);
        context.report.step("Saving the Modal filesystem…");
        const snapshotStartedAt = deps.now();
        const snapshotImageId = await sandbox.snapshotFilesystem({
          timeoutMs: Math.min(
            SNAPSHOT_TIMEOUT_MS,
            Math.max(1, remainingMs() - 10_000),
          ),
          ttlMs: null,
        });
        context.report.log(
          JSON.stringify({
            phase: "snapshot",
            imageId: snapshotImageId,
            elapsedMs: deps.now() - snapshotStartedAt,
          }),
        );
        const checkpoint = {
          ...resource,
          snapshotImageId,
          pendingSnapshotImageIds: [
            ...new Set([
              ...resource.pendingSnapshotImageIds,
              ...(resource.snapshotImageId === null ||
              resource.snapshotImageId === snapshotImageId
                ? []
                : [resource.snapshotImageId]),
            ]),
          ],
        } satisfies ModalMachineResource;
        context.checkpoint(checkpoint, deps.now());
        await sandbox.terminate();
        context.report.log(
          `Terminated Modal sandbox ${sandbox.sandboxId} after its durable filesystem checkpoint`,
        );
        const suspended = { ...checkpoint, sandboxId: null };
        context.checkpoint(suspended);
        return {
          resource: await deletePendingSnapshots(
            suspended,
            resolved.settings,
            context.checkpoint,
          ),
        };
      },
      async resume(context) {
        let resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        resource = await deletePendingSnapshots(resource, resolved.settings);
        let sandbox = await findSandbox(resource, resolved.settings);
        if (sandbox === null) {
          if (resource.snapshotImageId === null) {
            throw new Error("The Modal sandbox has no restorable snapshot.");
          }
          context.report.step("Restoring the Modal sandbox…");
          sandbox = await backendFor(resolved.settings).create({
            appName:
              resource.version === 4
                ? resource.appName
                : resolved.settings.appName,
            name: resource.key,
            image: {
              type: "snapshot",
              imageId: resource.snapshotImageId,
            },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs:
              resource.version === 4
                ? resource.policy.lifetimeMinutes * 60000
                : resolved.settings.timeoutMs,
            cpu:
              resource.version === 4
                ? resource.resources.cpuCores
                : resolved.settings.cpu,
            memoryMiB:
              resource.version === 4
                ? resource.resources.memoryMiB
                : resolved.settings.memoryMiB,
            tags: { bbMachineKey: resource.key },
          });
        }
        resource = { ...resource, sandboxId: sandbox.sandboxId };
        await context.checkpoint(resource);
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: resource.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "preinstalled" },
          report: context.report,
          signal: context.signal,
        });
        if (hostId !== context.hostId) {
          throw new Error(
            "Modal bootstrap returned a different machine identity.",
          );
        }
        return {
          resource: { ...resource, sandboxId: sandbox.sandboxId },
        };
      },
      async remove(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { status: "failed", message: resolved.message };
        try {
          const sandbox = await findSandbox(resource, resolved.settings);
          await sandbox?.terminate();
          const snapshots = new Set(resource.pendingSnapshotImageIds);
          if (resource.snapshotImageId !== null) {
            snapshots.add(resource.snapshotImageId);
          }
          for (const imageId of snapshots) {
            await backendFor(resolved.settings).deleteSnapshot(imageId);
          }
          catalogue.store.release("allocation", resource.key);
          return { status: "removed" };
        } catch (error) {
          return { status: "failed", message: errorMessage(error) };
        }
      },
    });

    const loaded = await currentSettings();
    if (!loaded.ok) bb.status.needsConfiguration(loaded.message);
  };
}

const machineInputsSchema = z
  .object({
    buildId: z.string().min(1).optional(),
    accountRef: z.literal("default").default("default"),
    appName: z.string().min(1).optional(),
    resources: resourcesSchema.partial().optional(),
    policy: policySchema.partial().optional(),
  })
  .strict();

export default createModalSandboxPlugin({
  backendFactory: createModalBackend,
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
