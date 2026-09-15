import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ModalAllocations } from "./allocations.js";
import type { ModalSandboxClient } from "./providers/modal/client.js";
import { readModalMachineResource } from "./providers/modal/resource.js";
import { PROVIDER_ID } from "./provider-id.js";
import { errorMessage } from "./error-message.js";

export async function sweepModalAllocations(
  bb: BbPluginApi,
  allocations: ModalAllocations,
  client: ModalSandboxClient,
  now: number,
): Promise<void> {
  const keys = await allocations.keys();
  if (keys.length === 0) return;
  const accountIdentity = await client.accountIdentity();
  const hosts = await bb.sdk.hosts.list();
  const owners = new Map<string, (typeof hosts)[number]>();
  for (const host of hosts) {
    if (host.machineProviderId !== PROVIDER_ID) continue;
    try {
      const stored = await bb.experimental_machines.getResource(host.id);
      if (stored === null) continue;
      const resource = readModalMachineResource(stored);
      if (resource.accountIdentity === accountIdentity)
        owners.set(JSON.stringify([resource.appName, resource.key]), host);
    } catch (error) {
      bb.log.warn(
        `Modal allocation owner lookup failed for ${host.id}: ${errorMessage(error)}`,
      );
    }
  }
  for (const key of keys) {
    try {
      if (allocations.isAllocating(key)) continue;
      const allocation = await allocations.read(key);
      if (allocation === null || allocation.accountIdentity !== accountIdentity)
        continue;
      const sandbox =
        allocation.sandboxId === null
          ? await client.fromName(allocation.appName, allocation.name)
          : await client.fromId(allocation.sandboxId);
      if (sandbox === null) {
        if (allocation.sandboxId !== null || now >= allocation.expiresAt)
          await allocations.remove(key);
        continue;
      }
      if (allocation.sandboxId === null) {
        await allocations.remember({
          ...allocation,
          sandboxId: sandbox.sandboxId,
        });
        await allocations.remove(key);
      }
      const owner = owners.get(
        JSON.stringify([allocation.appName, allocation.name]),
      );
      if (owner === undefined) {
        bb.log.warn(
          `Tracked Modal sandbox ${sandbox.sandboxId} has no matching machine; retaining it for inspection`,
        );
        continue;
      }
      if (owner.lifecycle.phase === "suspended")
        await bb.sdk.hosts.experimental_reconcile({ hostId: owner.id });
    } catch (error) {
      bb.log.warn(
        `Modal allocation sweep failed for ${key}: ${errorMessage(error)}`,
      );
    }
  }
}
