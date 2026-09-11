import { debugSandbox } from "./debug-sandbox.js";
import { imageDefinition } from "./image-definition.js";
import { registerRpcAndCli } from "./account.js";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderCreateResult,
} from "@get-bb/plugin-sdk/machine-provider";
import {
  resolveSettings,
  SANDBOX_LIFETIME_MS,
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
  type ModalMachineResource,
} from "./lifecycle.js";
import { PROVIDER_ID } from "./provider-id.js";
import {
  modalLaunchOptions,
  type ModalImage,
  type ModalLaunchOptions,
  type SandboxPreset,
} from "./launch-options.js";

export { PROVIDER_ID } from "./provider-id.js";
export const modalMachineInputsSchema = z
  .object({
    preset: z.string().trim().min(1).optional(),
    image: z.string().trim().min(1).optional(),
  })
  .strict();

type ModalMachineInputs = z.infer<typeof modalMachineInputsSchema>;

function resolveLaunchSelection(
  inputs: ModalMachineInputs,
  options: ModalLaunchOptions,
): { preset: SandboxPreset | null; image: ModalImage } {
  const presetName = inputs.preset ?? options.presets[0]?.name;
  const preset =
    presetName === undefined
      ? null
      : (options.presets.find((entry) => entry.name === presetName) ?? null);
  if (presetName !== undefined && preset === null) {
    throw new Error(
      `The Modal sandbox preset "${presetName}" is not configured.`,
    );
  }
  const imageName = inputs.image ?? options.images[0]?.name;
  const image = options.images.find((entry) => entry.name === imageName);
  if (image === undefined) {
    throw new Error(`The Modal image "${imageName ?? ""}" is not configured.`);
  }
  return { preset, image };
}

const MODAL_API_RETRY_LIMIT = 3;
const MODAL_API_RETRY_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
}

export interface ModalSandboxDeps {
  backendFactory: SandboxBackendFactory;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
}

export function createModalSandboxPlugin(
  deps: ModalSandboxDeps,
): (bb: BbPluginApi) => Promise<void> {
  return async (bb) => {
    const image = imageDefinition(bb);
    const launchOptions = modalLaunchOptions(bb, image);
    const settings = bb.settings.define(SETTING_DESCRIPTORS);
    let cachedBackend: { token: string; backend: SandboxBackend } | null = null;

    bb.onDispose(() => cachedBackend?.backend.close());

    async function currentSettings(): Promise<
      { ok: true; settings: ResolvedSettings } | { ok: false; message: string }
    > {
      return resolveSettings(await settings.get());
    }

    function backendFor(resolved: ResolvedSettings): SandboxBackend {
      const token = `${resolved.tokenId}:${resolved.tokenSecret}`;
      if (cachedBackend?.token === token) return cachedBackend.backend;
      cachedBackend?.backend.close();
      const backend = deps.backendFactory({
        tokenId: resolved.tokenId,
        tokenSecret: resolved.tokenSecret,
      });
      cachedBackend = { token, backend };
      return backend;
    }

    const debug = debugSandbox(bb, image, async () => {
      const resolved = await currentSettings();
      if (!resolved.ok) throw new Error(resolved.message);
      return {
        backend: backendFor(resolved.settings),
        settings: resolved.settings,
      };
    });

    async function inspectMachine({ hostId }: { hostId: string }) {
      const stored = await bb.experimental_machines.getResource(hostId);
      if (stored === null)
        throw new Error("No provider resource for this machine.");
      const resource = readModalMachineResource(stored);
      const resolved = await currentSettings();
      if (!resolved.ok) throw new Error(resolved.message);
      const sandbox = await findSandbox(resource, resolved.settings);
      const observation =
        sandbox === null
          ? null
          : await backendFor(resolved.settings).observe({
              sandboxId: sandbox.sandboxId,
              appName: resource.appName,
              key: resource.key,
            });
      const state: "running" | "suspended" | "missing" = observation?.running
        ? "running"
        : resource.sandboxId === null && resource.snapshotImageId !== null
          ? "suspended"
          : "missing";
      const expiresAt = observation?.expiresAt ?? null;
      return {
        summary:
          state === "missing"
            ? "Modal compute is missing. Changes since the last saved image may be lost; automatic recovery is refused."
            : `Modal machine is ${state}.`,
        values: {
          state,
          expiresAt,
          snapshotImageId: resource.snapshotImageId,
        },
      };
    }

    registerRpcAndCli(
      bb,
      image,
      launchOptions,
      async () => {
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { available: false, message: resolved.message };
        try {
          await backendFor(resolved.settings).accountIdentity();
          return {
            available: true,
            message: `Connected to Modal (${resolved.settings.appName})`,
          };
        } catch (error) {
          return { available: false, message: errorMessage(error) };
        }
      },
      debug,
      inspectMachine,
    );

    const idleKey = (hostId: string) => `idle/${hostId}`;
    async function bumpIdle(hostId: string): Promise<void> {
      await bb.storage.kv.set(idleKey(hostId), deps.now());
    }
    async function bumpOwnedMachine(hostId: string): Promise<void> {
      const host = await bb.sdk.hosts.get({ hostId });
      if (
        host.machineProviderId === PROVIDER_ID &&
        host.lifecycle.phase === "active"
      ) {
        await bumpIdle(hostId);
      }
    }
    bb.events.on("experimental_thread.events", async ({ thread }) => {
      if (thread.status !== "starting" && thread.status !== "active") return;
      if (thread.environmentId === null) {
        const hosts = await bb.sdk.hosts.list();
        for (const host of hosts) {
          if (
            host.machineProviderId !== PROVIDER_ID ||
            host.lifecycle.phase !== "active"
          )
            continue;
          const resource = await bb.experimental_machines.getResource(host.id);
          if (
            resource !== null &&
            readModalMachineResource(resource).key === thread.id
          ) {
            await bumpIdle(host.id);
            return;
          }
        }
        return;
      }
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      await bumpOwnedMachine(environment.hostId);
    });
    bb.events.on("experimental_terminal.input", async ({ terminal }) => {
      await bumpOwnedMachine(terminal.hostId);
    });
    bb.background.schedule("pause-idle-machines", "* * * * *", async () => {
      const resolved = await currentSettings();
      if (!resolved.ok || resolved.settings.idleMs === null) return;
      const hosts = await bb.sdk.hosts.list();
      for (const host of hosts) {
        if (
          host.machineProviderId !== PROVIDER_ID ||
          host.lifecycle.phase !== "active"
        )
          continue;
        const stored = await bb.storage.kv.get<unknown>(idleKey(host.id));
        const lastActivity =
          stored === undefined ? null : z.number().finite().parse(stored);
        if (lastActivity === null) {
          await bumpIdle(host.id);
          continue;
        }
        if (deps.now() < lastActivity + resolved.settings.idleMs) continue;
        try {
          await bb.sdk.hosts.experimental_suspend({ hostId: host.id });
        } catch (error) {
          if (hasErrorCode(error, "machine_busy")) continue;
          const current = await bb.sdk.hosts
            .get({ hostId: host.id })
            .catch(() => null);
          if (
            current?.lifecycle.phase === "suspending" ||
            current?.lifecycle.phase === "suspended"
          ) {
            continue;
          }
          bb.log.warn(
            `Idle pause failed for ${host.id}: ${errorMessage(error)}`,
          );
        }
      }
    });

    async function retryModalApi<T>(
      operation: () => Promise<T>,
      signal: AbortSignal,
    ): Promise<T> {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          signal.throwIfAborted();
          if (attempt >= MODAL_API_RETRY_LIMIT) throw error;
          await deps.sleep(MODAL_API_RETRY_MS * attempt);
        }
      }
    }

    async function launch(
      context: PluginMachineProviderCreateContext,
    ): Promise<PluginMachineProviderCreateResult> {
      const inputs = modalMachineInputsSchema.parse(context.inputs);
      const resolved = await currentSettings();
      if (!resolved.ok) {
        return {
          status: "failed",
          message: resolved.message,
        };
      }
      const backend = backendFor(resolved.settings);
      try {
        const selection = resolveLaunchSelection(
          inputs,
          await launchOptions.get(),
        );
        context.signal.throwIfAborted();
        const accountIdentity = await retryModalApi(
          () => backend.accountIdentity(),
          context.signal,
        );
        context.signal.throwIfAborted();
        const appName = resolved.settings.appName;
        context.report.step(
          selection.image.source === "dockerfile"
            ? `Preparing the ${selection.image.name} Modal image…`
            : `Using the ${selection.image.name} Modal image…`,
        );
        const selectedImage = selection.image;
        const imageId =
          selectedImage.source === "image-id"
            ? selectedImage.imageId
            : await retryModalApi(
                () =>
                  backend.ensureStandardImage({
                    appName,
                    displayName: selectedImage.name,
                    dockerfile: selectedImage.dockerfile,
                    signal: context.signal,
                    report: context.report,
                  }),
                context.signal,
              );
        context.signal.throwIfAborted();
        context.report.step("Creating the Modal Sandbox…");
        const sandbox = await retryModalApi(async () => {
          const existing = await backend.fromName(appName, context.key);
          return (
            existing ??
            backend.create({
              appName,
              name: context.key,
              image: { type: "image", imageId },
              timeoutMs: SANDBOX_LIFETIME_MS,
              cpu: selection.preset?.cpu ?? null,
              memoryMiB: selection.preset?.memoryMiB ?? null,
              tags: { bbMachineKey: context.key },
            })
          );
        }, context.signal);
        context.report.log(
          `Modal sandbox ${sandbox.sandboxId} uses image ${imageId}\n`,
        );
        const allocation: ModalMachineResource = {
          imageId,
          accountIdentity,
          appName,
          cpu: selection.preset?.cpu ?? 0.125,
          memoryMiB: selection.preset?.memoryMiB ?? 128,
          key: context.key,
          sandboxId: sandbox.sandboxId,
          snapshotImageId: null,
          snapshotSandboxId: null,
          pendingSnapshotImageIds: [],
        };
        await context.checkpoint(allocation);
        context.signal.throwIfAborted();
        const connectStartedAt = deps.now();
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: context.key,
          executor: createSandboxExecutor(sandbox),
          report: context.report,
          signal: context.signal,
        });
        context.report.log(
          `Modal daemon connected in ${deps.now() - connectStartedAt} ms\n`,
        );
        context.signal.throwIfAborted();
        await bumpIdle(hostId);
        return {
          status: "created",
          name: `Modal sandbox ${hostId.replace(/[^a-z0-9]/giu, "").slice(-6)}`,
          resource: allocation,
        };
      } catch (error) {
        context.signal.throwIfAborted();
        return {
          status: "failed",
          message: errorMessage(error),
        };
      }
    }

    async function findSandbox(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
    ): Promise<SandboxHandle | null> {
      if (
        resource.accountIdentity !==
        (await backendFor(resolved).accountIdentity())
      )
        throw new Error(
          "Restore the machine’s pinned Modal account before lifecycle operations",
        );
      if (resource.sandboxId !== null) {
        const byId = await backendFor(resolved).fromId(resource.sandboxId);
        if (byId !== null) return byId;
      }
      return backendFor(resolved).fromName(resource.appName, resource.key);
    }

    async function deletePendingSnapshots(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
      checkpoint?: (resource: ModalMachineResource) => Promise<void>,
    ): Promise<ModalMachineResource> {
      if (
        resource.accountIdentity !==
        (await backendFor(resolved).accountIdentity())
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
        await checkpoint?.(current);
      }
      return current;
    }

    bb.experimental_environments.register({
      id: PROVIDER_ID,
      displayName: "Modal Sandbox",
      icon: "./modal-logo.svg",
      machineProviderId: PROVIDER_ID,
      environmentProviderId: "project-checkout",
    });

    bb.experimental_machines.register({
      id: PROVIDER_ID,
      displayName: "Modal Sandbox",
      description: "Create a sandbox in your Modal account.",
      icon: "./modal-logo.svg",
      ephemeral: true,
      inputs: modalMachineInputsSchema,
      async validate({ inputs }) {
        try {
          resolveLaunchSelection(inputs, await launchOptions.get());
          return { action: "accept" };
        } catch (error) {
          return { action: "refuse", message: errorMessage(error) };
        }
      },
      async availability() {
        const resolved = await currentSettings();
        return resolved.ok
          ? { status: "available" }
          : { status: "setup-required", message: resolved.message };
      },
      create: launch,
      async reconcileCleanup(context) {
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { status: "failed", message: resolved.message };
        context.signal.throwIfAborted();
        const backend = backendFor(resolved.settings);
        const sandbox = await backend.fromName(
          resolved.settings.appName,
          context.key,
        );
        await sandbox?.terminate();
        return { status: "removed" };
      },
      async suspend(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        const sandbox = await findSandbox(resource, resolved.settings);
        if (sandbox === null) {
          if (
            resource.sandboxId !== null &&
            resource.snapshotSandboxId !== resource.sandboxId
          )
            throw new Error(
              "Modal compute is missing. Refusing automatic recovery from a potentially stale snapshot.",
            );
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
        context.report.step("Saving the Modal filesystem…");
        const snapshotStartedAt = deps.now();
        const snapshotImageId = await sandbox.snapshotFilesystem({
          timeoutMs: SNAPSHOT_TIMEOUT_MS,
          ttlMs: null,
        });
        context.report.log(
          `Saved Modal filesystem snapshot ${snapshotImageId} in ${deps.now() - snapshotStartedAt} ms`,
        );
        const checkpoint = {
          ...resource,
          snapshotImageId,
          snapshotSandboxId: sandbox.sandboxId,
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
        await context.checkpoint(checkpoint);
        await sandbox.terminate();
        context.report.log(
          `Terminated Modal sandbox ${sandbox.sandboxId} after its durable filesystem checkpoint`,
        );
        const suspended = { ...checkpoint, sandboxId: null };
        await context.checkpoint(suspended);
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
          if (
            resource.sandboxId !== null &&
            resource.snapshotSandboxId !== resource.sandboxId
          )
            throw new Error(
              "Modal compute is missing. Refusing automatic recovery from a potentially stale snapshot.",
            );
          if (resource.snapshotImageId === null) {
            throw new Error("The Modal sandbox has no restorable snapshot.");
          }
          context.report.step("Restoring the Modal sandbox…");
          sandbox = await backendFor(resolved.settings).create({
            appName: resource.appName,
            name: resource.key,
            image: {
              type: "snapshot",
              imageId: resource.snapshotImageId,
            },
            timeoutMs: SANDBOX_LIFETIME_MS,
            cpu: resource.cpu,
            memoryMiB: resource.memoryMiB,
            tags: { bbMachineKey: resource.key },
          });
          context.report.log(
            `Restored Modal sandbox ${sandbox.sandboxId} from image ${resource.snapshotImageId}\n`,
          );
        }
        resource = { ...resource, sandboxId: sandbox.sandboxId };
        await context.checkpoint(resource);
        const connectStartedAt = deps.now();
        await bb.experimental_machines.bootstrap({
          key: resource.key,
          executor: createSandboxExecutor(sandbox),
          report: context.report,
          signal: context.signal,
        });
        context.report.log(
          `Modal daemon connected in ${deps.now() - connectStartedAt} ms\n`,
        );
        await bumpIdle(context.hostId);
        return {
          resource: {
            ...resource,
            sandboxId: sandbox.sandboxId,
          },
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

export default createModalSandboxPlugin({
  backendFactory: createModalBackend,
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
