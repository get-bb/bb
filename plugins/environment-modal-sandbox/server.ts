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
  type ModalMachineResource,
} from "./lifecycle.js";

export const PROVIDER_ID = "modal-sandbox";

const allocationSchema = z
  .object({
    appName: z.string().min(1),
    sandboxId: z.string().min(1).nullable(),
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
        context.signal.throwIfAborted();
        await bb.experimental_machines.prepareEnrollment({ key: context.key });
        context.signal.throwIfAborted();
        let sandbox = await backend.fromName(
          resolved.settings.appName,
          context.key,
        );
        const intentKey = `allocation/${context.key}`;
        const stored = await bb.storage.kv.get<unknown>(intentKey);
        if (sandbox === null && stored !== undefined) {
          allocationSchema.parse(stored);
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
            appName: resolved.settings.appName,
            sandboxId: null,
          });
          context.report.step("Creating the Modal sandbox…");
          sandbox = await backend.create({
            appName: resolved.settings.appName,
            name: context.key,
            image: { type: "registry", reference: resolved.settings.image },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resolved.settings.cpu,
            memoryMiB: resolved.settings.memoryMiB,
            tags: { bbMachineKey: context.key },
          });
        }
        const allocation: ModalMachineResource = {
          version: 3,
          key: context.key,
          sandboxId: sandbox.sandboxId,
          snapshotImageId: null,
          pendingSnapshotImageIds: [],
        };
        await context.checkpoint(allocation);
        await bb.storage.kv.set(intentKey, {
          appName: resolved.settings.appName,
          sandboxId: sandbox.sandboxId,
        });
        context.signal.throwIfAborted();
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: context.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "install" },
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
      if (resource.sandboxId !== null) {
        const byId = await backendFor(resolved).fromId(resource.sandboxId);
        if (byId !== null) return byId;
      }
      return backendFor(resolved).fromName(resolved.appName, resource.key);
    }

    async function deletePendingSnapshots(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
      checkpoint?: (resource: ModalMachineResource) => void,
    ): Promise<ModalMachineResource> {
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
        displayName: "Modal sandbox",
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
      create: launch,
      async experimental_reconcileCleanup(context) {
        const stored = await bb.storage.kv.get<unknown>(
          `allocation/${context.key}`,
        );
        if (stored === undefined) return { status: "removed" };
        const intent = allocationSchema.parse(stored);
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { status: "failed", message: resolved.message };
        context.signal.throwIfAborted();
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
        return { status: "removed" };
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
        context.report.step("Stopping the bb machine…");
        const stopped = await sandbox.exec(
          [
            "sh",
            "-c",
            'bb_bin=$(command -v bb || true); if [ -z "$bb_bin" ]; then bb_bin="$HOME/.local/bin/bb"; fi; exec "$bb_bin" machine stop --host-id "$1"',
            "sh",
            context.hostId,
          ],
          { timeoutMs: DAEMON_STOP_TIMEOUT_MS, signal: context.signal },
        );
        if (stopped.exitCode !== 0)
          throw new Error(
            `Stopping the bb machine exited ${stopped.exitCode}: ${stopped.stderr}`,
          );
        await waitForHostDisconnection(context.hostId, context.signal);
        context.report.step("Saving the Modal filesystem…");
        const snapshotImageId = await sandbox.snapshotFilesystem({
          timeoutMs: SNAPSHOT_TIMEOUT_MS,
          ttlMs: null,
        });
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
        context.checkpoint(checkpoint);
        await sandbox.terminate();
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
            appName: resolved.settings.appName,
            name: resource.key,
            image: {
              type: "snapshot",
              imageId: resource.snapshotImageId,
            },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resolved.settings.cpu,
            memoryMiB: resolved.settings.memoryMiB,
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
