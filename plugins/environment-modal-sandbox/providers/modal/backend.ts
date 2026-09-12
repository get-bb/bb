import { z } from "zod";
import {
  SANDBOX_LIFETIME_MS,
  type ResolvedSettings,
  type SettingsResolution,
} from "../../configuration.js";
import type {
  ModalImage,
  ModalLaunchOptionsStore,
  SandboxPreset,
} from "../../launch-options.js";
import { PROVIDER_ID } from "../../provider-id.js";
import { errorMessage } from "../../error-message.js";
import {
  readModalMachineResource,
  type ModalMachineResource,
} from "./resource.js";
import {
  createModalSandboxExecutor,
  type ModalSandboxClient,
  type ModalSandboxClientFactory,
  type ModalSandboxHandle,
} from "./client.js";
import type {
  SandboxBackend,
  SandboxLifecycleContext,
  SandboxOperationContext,
  SandboxResourceContext,
} from "../sandbox-backend.js";

export const modalMachineInputsSchema = z
  .object({
    preset: z.string().trim().min(1).optional(),
    image: z.string().trim().min(1).optional(),
  })
  .strict();

export type ModalMachineInputs = z.infer<typeof modalMachineInputsSchema>;

export interface ModalMachineInspection {
  summary: string;
  values: {
    state: "running" | "suspended" | "missing";
    expiresAt: number | null;
    snapshotImageId: string | null;
  };
}

export interface ModalConnectionStatus {
  available: boolean;
  message: string;
}

export interface ModalSandboxBackend extends SandboxBackend<
  ModalMachineInputs,
  ModalMachineResource
> {
  connectionStatus(): Promise<ModalConnectionStatus>;
  debugContext(): Promise<{
    client: ModalSandboxClient;
    settings: ResolvedSettings;
  }>;
  inspect(resource: ModalMachineResource): Promise<ModalMachineInspection>;
}

export interface ModalSandboxBackendDeps {
  clientFactory: ModalSandboxClientFactory;
  currentSettings: () => Promise<SettingsResolution>;
  launchOptions: ModalLaunchOptionsStore;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
}

const MODAL_API_RETRY_LIMIT = 3;
const MODAL_API_RETRY_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;

function requireRestorableSnapshot(resource: ModalMachineResource): string {
  if (
    resource.sandboxId !== null &&
    resource.snapshotSandboxId !== resource.sandboxId
  ) {
    throw new Error(
      "Modal compute is missing. Refusing automatic recovery from a potentially stale snapshot.",
    );
  }
  if (resource.snapshotImageId === null) {
    throw new Error("The Modal sandbox has no restorable snapshot.");
  }
  return resource.snapshotImageId;
}

function resolveLaunchSelection(
  inputs: ModalMachineInputs,
  options: Awaited<ReturnType<ModalLaunchOptionsStore["get"]>>,
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

export function createModalSandboxBackend(
  deps: ModalSandboxBackendDeps,
): ModalSandboxBackend {
  let cachedClient: { token: string; client: ModalSandboxClient } | null = null;

  async function requireSettings(): Promise<ResolvedSettings> {
    const resolved = await deps.currentSettings();
    if (!resolved.ok) throw new Error(resolved.message);
    return resolved.settings;
  }

  function clientFor(resolved: ResolvedSettings): ModalSandboxClient {
    const token = `${resolved.tokenId}:${resolved.tokenSecret}`;
    if (cachedClient?.token === token) return cachedClient.client;
    cachedClient?.client.close();
    const client = deps.clientFactory({
      tokenId: resolved.tokenId,
      tokenSecret: resolved.tokenSecret,
    });
    cachedClient = { token, client };
    return client;
  }

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

  async function findSandbox(
    resource: ModalMachineResource,
    resolved: ResolvedSettings,
  ): Promise<ModalSandboxHandle | null> {
    const client = clientFor(resolved);
    if (resource.accountIdentity !== (await client.accountIdentity())) {
      throw new Error(
        "Restore the machine’s pinned Modal account before lifecycle operations",
      );
    }
    if (resource.sandboxId !== null) {
      const byId = await client.fromId(resource.sandboxId);
      if (byId !== null) return byId;
    }
    return client.fromName(resource.appName, resource.key);
  }

  async function deletePendingSnapshots(
    resource: ModalMachineResource,
    resolved: ResolvedSettings,
    checkpoint?: (resource: ModalMachineResource) => Promise<void>,
  ): Promise<ModalMachineResource> {
    const client = clientFor(resolved);
    if (resource.accountIdentity !== (await client.accountIdentity())) {
      throw new Error(
        "Restore the machine’s pinned Modal account before snapshot cleanup",
      );
    }
    let current = resource;
    for (const imageId of resource.pendingSnapshotImageIds) {
      if (imageId === resource.snapshotImageId) continue;
      await client.deleteSnapshot(imageId);
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

  return {
    definition: {
      id: PROVIDER_ID,
      displayName: "Modal Sandbox",
      description: "Create a sandbox in your Modal account.",
      environmentDescription:
        "Create a project checkout in a new Modal sandbox.",
      runtimeName: "Modal",
      icon: "./modal-logo.svg",
      ephemeral: true,
      inputs: modalMachineInputsSchema,
    },
    parseInputs(value) {
      return modalMachineInputsSchema.parse(value);
    },
    parseResource: readModalMachineResource,
    allocationKey(resource) {
      return resource.key;
    },
    async availability() {
      const resolved = await deps.currentSettings();
      return resolved.ok
        ? { status: "available" }
        : { status: "setup-required", message: resolved.message };
    },
    async validate(inputs) {
      try {
        resolveLaunchSelection(inputs, await deps.launchOptions.get());
        return { action: "accept" };
      } catch (error) {
        return { action: "refuse", message: errorMessage(error) };
      }
    },
    async create(context) {
      const resolved = await requireSettings();
      const client = clientFor(resolved);
      const selection = resolveLaunchSelection(
        context.inputs,
        await deps.launchOptions.get(),
      );
      context.signal.throwIfAborted();
      const accountIdentity = await retryModalApi(
        () => client.accountIdentity(),
        context.signal,
      );
      context.signal.throwIfAborted();
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
                client.ensureModalImage({
                  appName: resolved.appName,
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
        const existing = await client.fromName(resolved.appName, context.key);
        return (
          existing ??
          client.create({
            appName: resolved.appName,
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
      const resource: ModalMachineResource = {
        imageId,
        accountIdentity,
        appName: resolved.appName,
        cpu: selection.preset?.cpu ?? 0.125,
        memoryMiB: selection.preset?.memoryMiB ?? 128,
        key: context.key,
        sandboxId: sandbox.sandboxId,
        snapshotImageId: null,
        snapshotSandboxId: null,
        pendingSnapshotImageIds: [],
      };
      await context.checkpoint(resource);
      context.signal.throwIfAborted();
      return { resource, executor: createModalSandboxExecutor(sandbox) };
    },
    async reconcileCleanup(context: SandboxOperationContext & { key: string }) {
      const resolved = await requireSettings();
      context.signal.throwIfAborted();
      const client = clientFor(resolved);
      for await (const sandbox of client.listByKey(context.key)) {
        context.signal.throwIfAborted();
        await sandbox.terminate();
        if ((await client.fromId(sandbox.sandboxId)) !== null) {
          throw new Error(
            "The Modal allocation is still present; retry cleanup.",
          );
        }
      }
      context.signal.throwIfAborted();
    },
    async suspend(
      context: SandboxLifecycleContext<ModalMachineResource>,
    ): Promise<ModalMachineResource> {
      const resolved = await requireSettings();
      const sandbox = await findSandbox(context.resource, resolved);
      if (sandbox === null) {
        requireRestorableSnapshot(context.resource);
        return deletePendingSnapshots(
          context.resource,
          resolved,
          context.checkpoint,
        );
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
        ...context.resource,
        snapshotImageId,
        snapshotSandboxId: sandbox.sandboxId,
        pendingSnapshotImageIds: [
          ...new Set([
            ...context.resource.pendingSnapshotImageIds,
            ...(context.resource.snapshotImageId === null ||
            context.resource.snapshotImageId === snapshotImageId
              ? []
              : [context.resource.snapshotImageId]),
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
      return deletePendingSnapshots(suspended, resolved, context.checkpoint);
    },
    async resume(context) {
      const resolved = await requireSettings();
      let resource = await deletePendingSnapshots(context.resource, resolved);
      let sandbox = await findSandbox(resource, resolved);
      if (sandbox === null) {
        const snapshotImageId = requireRestorableSnapshot(resource);
        context.report.step("Restoring the Modal sandbox…");
        sandbox = await clientFor(resolved).create({
          appName: resource.appName,
          name: resource.key,
          image: { type: "snapshot", imageId: snapshotImageId },
          timeoutMs: SANDBOX_LIFETIME_MS,
          cpu: resource.cpu,
          memoryMiB: resource.memoryMiB,
          tags: { bbMachineKey: resource.key },
        });
        context.report.log(
          `Restored Modal sandbox ${sandbox.sandboxId} from image ${snapshotImageId}\n`,
        );
      }
      resource = { ...resource, sandboxId: sandbox.sandboxId };
      await context.checkpoint(resource);
      return { resource, executor: createModalSandboxExecutor(sandbox) };
    },
    async remove(
      context: SandboxResourceContext<ModalMachineResource>,
    ): Promise<void> {
      const resolved = await requireSettings();
      const sandbox = await findSandbox(context.resource, resolved);
      await sandbox?.terminate();
      const snapshots = new Set(context.resource.pendingSnapshotImageIds);
      if (context.resource.snapshotImageId !== null) {
        snapshots.add(context.resource.snapshotImageId);
      }
      for (const imageId of snapshots) {
        await clientFor(resolved).deleteSnapshot(imageId);
      }
    },
    displayName({ hostId }) {
      return `Modal sandbox ${hostId.replace(/[^a-z0-9]/giu, "").slice(-6)}`;
    },
    close() {
      cachedClient?.client.close();
      cachedClient = null;
    },
    async connectionStatus() {
      const resolved = await deps.currentSettings();
      if (!resolved.ok) return { available: false, message: resolved.message };
      try {
        await clientFor(resolved.settings).accountIdentity();
        return {
          available: true,
          message: `Connected to Modal (${resolved.settings.appName})`,
        };
      } catch (error) {
        return { available: false, message: errorMessage(error) };
      }
    },
    async debugContext() {
      const settings = await requireSettings();
      return { client: clientFor(settings), settings };
    },
    async inspect(resource) {
      const resolved = await requireSettings();
      const sandbox = await findSandbox(resource, resolved);
      const observation =
        sandbox === null
          ? null
          : await clientFor(resolved).observe({
              sandboxId: sandbox.sandboxId,
              appName: resource.appName,
              key: resource.key,
            });
      const state: "running" | "suspended" | "missing" = observation?.running
        ? "running"
        : resource.sandboxId === null && resource.snapshotImageId !== null
          ? "suspended"
          : "missing";
      return {
        summary:
          state === "missing"
            ? "Modal compute is missing. Changes since the last saved image may be lost; automatic recovery is refused."
            : `Modal machine is ${state}.`,
        values: {
          state,
          expiresAt: observation?.expiresAt ?? null,
          snapshotImageId: resource.snapshotImageId,
        },
      };
    },
  };
}
