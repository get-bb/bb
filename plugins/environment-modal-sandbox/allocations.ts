import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type {
  ModalSandboxClient,
  ModalSandboxHandle,
} from "./providers/modal/client.js";

const prefix = "allocations/";
const allocationSchema = z.object({
  accountIdentity: z.string().min(1),
  appName: z.string().min(1),
  name: z.string().min(1),
  sandboxId: z.string().min(1).nullable(),
  expiresAt: z.number().finite(),
});
export type ModalAllocation = z.infer<typeof allocationSchema>;

export function modalAllocations(
  bb: Pick<BbPluginApi, "storage">,
  now: () => number,
) {
  const allocating = new Set<string>();
  const keyForId = (id: string) => `${prefix}sandbox/${id}`;
  async function remember(allocation: ModalAllocation & { sandboxId: string }) {
    await bb.storage.kv.set(keyForId(allocation.sandboxId), allocation);
  }
  async function forget(sandboxId: string) {
    await bb.storage.kv.delete(keyForId(sandboxId));
  }
  return {
    remember,
    forget,
    keys: () => bb.storage.kv.list(prefix),
    read: async (key: string) => {
      const value = await bb.storage.kv.get<unknown>(key);
      return value === undefined ? null : allocationSchema.parse(value);
    },
    remove: (key: string) => bb.storage.kv.delete(key),
    isAllocating: (key: string) => allocating.has(key),
    wrap(client: ModalSandboxClient): ModalSandboxClient {
      function wrapHandle(sandbox: ModalSandboxHandle): ModalSandboxHandle {
        return {
          ...sandbox,
          async terminate() {
            await sandbox.terminate();
            if ((await client.fromId(sandbox.sandboxId)) === null)
              await forget(sandbox.sandboxId);
          },
        };
      }
      return {
        ...client,
        async create(request) {
          if (!request.tags.bbMachineKey || request.tags.bbDebug === "true")
            return client.create(request);
          const accountIdentity = await client.accountIdentity();
          const key = `${prefix}pending/${createHash("sha256")
            .update(
              JSON.stringify([accountIdentity, request.appName, request.name]),
            )
            .digest("hex")}`;
          const allocation: ModalAllocation = {
            accountIdentity,
            appName: request.appName,
            name: request.name,
            sandboxId: null,
            expiresAt: now() + request.timeoutMs,
          };
          allocating.add(key);
          try {
            await bb.storage.kv.set(key, allocation);
            const sandbox = await client.create(request);
            await remember({ ...allocation, sandboxId: sandbox.sandboxId });
            await bb.storage.kv.delete(key);
            return wrapHandle(sandbox);
          } finally {
            allocating.delete(key);
          }
        },
        async fromId(id) {
          const sandbox = await client.fromId(id);
          return sandbox === null ? null : wrapHandle(sandbox);
        },
        async fromName(appName, name) {
          const sandbox = await client.fromName(appName, name);
          return sandbox === null ? null : wrapHandle(sandbox);
        },
        async *listByKey(key) {
          for await (const sandbox of client.listByKey(key))
            yield wrapHandle(sandbox);
        },
      };
    },
  };
}
export type ModalAllocations = ReturnType<typeof modalAllocations>;
