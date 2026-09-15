import { modalAllocations } from "./allocations.js";
import { sweepModalAllocations } from "./allocation-sweep.js";
import { debugSandbox } from "./debug-sandbox.js";
import { imageDefinition } from "./image-definition.js";
import { registerRpcAndCli } from "./account.js";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveSettings, SETTING_DESCRIPTORS } from "./configuration.js";
import {
  createModalSandboxClient,
  type ModalSandboxClientFactory,
} from "./providers/modal/client.js";
import { modalLaunchOptions } from "./launch-options.js";
import { createModalSandboxBackend } from "./providers/modal/backend.js";
import { registerSandboxBackend } from "./providers/register.js";
import { SANDBOX_LIFETIME_MS } from "./configuration.js";
import { errorMessage } from "./error-message.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
}

export interface ModalSandboxDeps {
  clientFactory: ModalSandboxClientFactory;
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

    async function currentSettings() {
      return resolveSettings(await settings.get());
    }

    const allocations = modalAllocations(bb, deps.now);
    const backend = createModalSandboxBackend({
      clientFactory: (credentials) =>
        allocations.wrap(deps.clientFactory(credentials)),
      currentSettings,
      launchOptions,
      now: deps.now,
      sleep: deps.sleep,
    });

    bb.onDispose(() => backend.close());

    const debug = debugSandbox(bb, image, () => backend.debugContext());

    async function inspectMachine({ hostId }: { hostId: string }) {
      const stored = await bb.experimental_machines.getResource(hostId);
      if (stored === null)
        throw new Error("No provider resource for this machine.");
      return backend.inspect(backend.parseResource(stored));
    }

    registerRpcAndCli(
      bb,
      image,
      launchOptions,
      () => backend.connectionStatus(),
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
        host.machineProviderId === backend.definition.id &&
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
            host.machineProviderId !== backend.definition.id ||
            host.lifecycle.phase !== "active"
          )
            continue;
          const resource = await bb.experimental_machines.getResource(host.id);
          if (
            resource !== null &&
            backend.allocationKey(backend.parseResource(resource)) === thread.id
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
      if (!resolved.ok) return;
      const { client } = await backend.debugContext();
      await sweepModalAllocations(bb, allocations, client, deps.now());
      if (resolved.settings.idleMs === null) return;
      const hosts = await bb.sdk.hosts.list();
      for (const host of hosts) {
        if (
          host.machineProviderId !== backend.definition.id ||
          host.lifecycle.phase !== "active"
        )
          continue;
        try {
          const stored = await bb.storage.kv.get<unknown>(idleKey(host.id));
          const lastActivity =
            stored === undefined ? null : z.number().finite().parse(stored);
          if (lastActivity === null) {
            await bumpIdle(host.id);
            continue;
          }
          if (deps.now() < lastActivity + resolved.settings.idleMs) continue;
          await bb.sdk.hosts.experimental_suspend({ hostId: host.id });
        } catch (error) {
          if (hasErrorCode(error, "machine_busy")) continue;
          const current = await bb.sdk.hosts
            .get({ hostId: host.id })
            .catch(() => null);
          if (
            current?.lifecycle.phase === "suspending" ||
            current?.lifecycle.phase === "suspended" ||
            current?.lifecycle.phase === "resuming"
          ) {
            continue;
          }
          bb.log.warn(
            `Idle pause failed for ${host.id}: ${errorMessage(error)}`,
          );
        }
      }
    });

    registerSandboxBackend(bb, backend, {
      now: deps.now,
      onConnected: bumpIdle,
    });

    for (const host of await bb.sdk.hosts.list()) {
      if (host.machineProviderId !== backend.definition.id) continue;
      try {
        const stored = await bb.experimental_machines.getResource(host.id);
        if (stored === null) continue;
        const resource = backend.parseResource(stored);
        if (resource.sandboxId !== null)
          await allocations.remember({
            accountIdentity: resource.accountIdentity,
            appName: resource.appName,
            name: resource.key,
            sandboxId: resource.sandboxId,
            expiresAt: deps.now() + SANDBOX_LIFETIME_MS,
          });
      } catch (error) {
        bb.log.warn(
          `Modal allocation import failed for ${host.id}: ${errorMessage(error)}`,
        );
      }
    }

    const loaded = await currentSettings();
    if (!loaded.ok) bb.status.needsConfiguration(loaded.message);
  };
}

export default createModalSandboxPlugin({
  clientFactory: createModalSandboxClient,
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
