import { registerAccount } from "./account.js";
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
  modalMachineResourceSchema,
  type ModalMachineResource,
} from "./lifecycle.js";

export const PROVIDER_ID = "modal-sandbox";

const allocationSchema = z
  .object({
    appName: z.string().min(1),
    sandboxId: z.string().min(1).nullable(),
    resource: modalMachineResourceSchema.nullable().default(null),
    accountIdentity: z.string().nullable().default(null),
  })
  .strict();

const HOST_CONNECT_TIMEOUT_MS = 240_000;
const HOST_POLL_INTERVAL_MS = 3_000;
const DAEMON_STOP_TIMEOUT_MS = 60_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;
const PRESERVATION_LEAD_MS = 15 * 60_000;
const DRAIN_AND_SAVE_MS =
  5 * 60_000 + DAEMON_STOP_TIMEOUT_MS + SNAPSHOT_TIMEOUT_MS;
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

    registerAccount(bb, async () => {
      const resolved = await currentSettings();
      if (!resolved.ok) return { available: false, message: resolved.message };
      try {
        await backendFor(resolved.settings).accountIdentity();
        return {
          available: true,
          message: `Connected to Modal (${resolved.settings.appName})`,
        };
      } catch (error) {
        return { available: false, message: errorMessage(error) };
      }
    });

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
          throw new Error("Select a project before creating a Modal machine");
        machineInputsSchema.parse(context.inputs ?? {});
        context.signal.throwIfAborted();
        await bb.experimental_machines.prepareEnrollment({ key: context.key });
        const accountIdentity = await backend.accountIdentity();
        context.signal.throwIfAborted();
        const appName = resolved.settings.appName;
        let sandbox = await backend.fromName(appName, context.key);
        const intentKey = `allocation/${context.key}`;
        const stored = await bb.storage.kv.get<unknown>(intentKey);
        const intent =
          stored === undefined ? null : allocationSchema.parse(stored);
        if (
          intent?.accountIdentity &&
          intent.accountIdentity !== accountIdentity
        )
          throw new Error("Allocation account differs from the pinned account");
        if (intent && intent.appName !== appName)
          throw new Error("Allocation key belongs to a different Modal app");
        if (sandbox === null && stored !== undefined) {
          return {
            status: "failed",
            failure: "transient",
            message:
              "Modal allocation intent is unresolved; reconcile its name before retrying.",
          };
        }
        let imageId = intent?.resource?.imageId ?? null;
        if (sandbox === null) {
          context.report.step("Preparing the standard Modal image…");
          imageId = await backend.ensureStandardImage({
            appName,
            signal: context.signal,
            report: context.report,
          });
          context.signal.throwIfAborted();
          await bb.storage.kv.set(intentKey, {
            appName,
            sandboxId: null,
            resource: null,
            accountIdentity,
          });
          context.report.step("Creating the Modal sandbox…");
          sandbox = await backend.create({
            appName,
            name: context.key,
            image: { type: "image", imageId },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resolved.settings.cpu,
            memoryMiB: resolved.settings.memoryMiB,
            tags: { bbMachineKey: context.key },
          });
        }
        const allocation: ModalMachineResource = intent?.resource ?? {
          version: 5,
          imageId,
          accountIdentity,
          appName,
          cpu: resolved.settings.cpu,
          memoryMiB: resolved.settings.memoryMiB,
          expiresAt: deps.now() + resolved.settings.timeoutMs,
          key: context.key,
          sandboxId: sandbox.sandboxId,
          snapshotImageId: null,
          snapshotSandboxId: null,
          pendingSnapshotImageIds: [],
        };
        await context.checkpoint(allocation);
        await bb.storage.kv.set(intentKey, {
          appName,
          sandboxId: sandbox.sandboxId,
          resource: allocation,
          accountIdentity,
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
      if (
        resource.accountIdentity !== null &&
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
      return backendFor(resolved).fromName(
        resource.appName ?? resolved.appName,
        resource.key,
      );
    }

    async function deletePendingSnapshots(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
      checkpoint?: (resource: ModalMachineResource) => void,
    ): Promise<ModalMachineResource> {
      if (
        resource.accountIdentity !== null &&
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
        checkpoint?.(current);
      }
      return current;
    }

    bb.experimental_machines.register({
      id: PROVIDER_ID,
      displayName: "Modal sandbox",
      icon: "./modal-logo.svg",
      environmentRow: {
        displayName: "New sandbox",
        environmentProviderId: "project-checkout",
      },
      async availability() {
        const resolved = await currentSettings();
        return resolved.ok
          ? { status: "available" }
          : { status: "setup-required", message: resolved.message };
      },
      create: launch,
      async reconcileCleanup(context) {
        const stored = await bb.storage.kv.get<unknown>(
          `allocation/${context.key}`,
        );
        if (stored === undefined) {
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
            (await backendFor(resolved.settings).accountIdentity())
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
        return { status: "removed" };
      },
      async experimental_details(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        context.signal.throwIfAborted();
        const sandbox = await findSandbox(resource, resolved.settings);
        const observation =
          sandbox === null
            ? null
            : await backendFor(resolved.settings).observe({
                sandboxId: sandbox.sandboxId,
                appName: resource.appName ?? resolved.settings.appName,
                key: resource.key,
              });
        const state = observation?.running
          ? "running"
          : resource.sandboxId === null && resource.snapshotImageId !== null
            ? "suspended"
            : "missing";
        const expiresAt = observation?.expiresAt ?? null;
        return {
          summary:
            state === "missing"
              ? "Modal compute is missing. Changes since the last saved image may be lost; automatic recovery is refused."
              : state === "running" &&
                  expiresAt !== null &&
                  expiresAt - deps.now() <= DRAIN_AND_SAVE_MS
                ? "Modal compute expires too soon to guarantee preservation."
                : `Modal machine is ${state}.`,
          values: {
            state,
            expiresAt,
            snapshotImageId: resource.snapshotImageId,
          },
        };
      },
      async experimental_idleSuspendMs() {
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        return resolved.settings.idleMs;
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
        const remainingMs = () =>
          resource.expiresAt !== null
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
        context.checkpoint(checkpoint);
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
        let expiresAt = resource.expiresAt;
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
          expiresAt = null;
          sandbox = await backendFor(resolved.settings).create({
            appName: resource.appName ?? resolved.settings.appName,
            name: resource.key,
            image: {
              type: "snapshot",
              imageId: resource.snapshotImageId,
            },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resource.cpu,
            memoryMiB: resource.memoryMiB,
            tags: { bbMachineKey: resource.key },
          });
        }
        resource = { ...resource, sandboxId: sandbox.sandboxId, expiresAt };
        await context.checkpoint(resource);
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: resource.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "install" },
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

    bb.background.schedule(
      "preserve-expiring-machines",
      "* * * * *",
      async () => {
        const failures: string[] = [];
        for (const host of await bb.sdk.hosts.list()) {
          if (
            host.machineProviderId !== PROVIDER_ID ||
            host.lifecycle.phase !== "active"
          )
            continue;
          try {
            const details = await bb.sdk.hosts.experimental_providerDetails({
              hostId: host.id,
            });
            const state = z
              .object({
                state: z.enum(["running", "suspended", "missing"]),
                expiresAt: z.number().nullable(),
              })
              .parse(details?.values);
            if (state.state !== "running" || state.expiresAt === null) continue;
            const remaining = state.expiresAt - deps.now();
            if (remaining > PRESERVATION_LEAD_MS) continue;
            if (remaining <= DRAIN_AND_SAVE_MS)
              throw new Error(
                "Too little time remains for coordinated drain and filesystem preservation",
              );
            await bb.sdk.hosts.suspend({ hostId: host.id });
          } catch (error) {
            failures.push(`${host.id}: ${errorMessage(error)}`);
          }
        }
        if (failures.length) throw new Error(failures.join("; "));
      },
    );

    const loaded = await currentSettings();
    if (!loaded.ok) bb.status.needsConfiguration(loaded.message);
  };
}

const machineInputsSchema = z.object({}).strict();

export default createModalSandboxPlugin({
  backendFactory: createModalBackend,
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
