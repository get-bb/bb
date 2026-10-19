import { errorMessage } from "./error-message.js";
import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type {
  ModalSandboxClient,
  ModalSandboxHandle,
} from "./providers/modal/client.js";

const prefix = "allocations/";
const retrySchema = z.object({
  failures: z.number().int().min(0).max(7),
  nextAttemptAt: z.number().finite(),
});
const retryKey = (key: string) => `allocation-retries/${key}`;
const allocationSchema = z.object({
  accountIdentity: z.string().min(1),
  appName: z.string().min(1),
  name: z.string().min(1),
  sandboxId: z.string().min(1).nullable(),
  expiresAt: z.number().finite(),
});
export type ModalAllocation = z.infer<typeof allocationSchema>;

export function modalAllocations(
  bb: Pick<BbPluginApi, "storage" | "log">,
  now: () => number,
) {
  const allocating = new Set<string>();
  const keyForId = (id: string) => `${prefix}sandbox/${id}`;
  async function remember(allocation: ModalAllocation & { sandboxId: string }) {
    const key = keyForId(allocation.sandboxId);
    await bb.storage.kv.set(key, allocation);
    return key;
  }
  async function remove(key: string) {
    await bb.storage.kv.delete(key);
    await bb.storage.kv.delete(retryKey(key));
  }
  async function forget(sandboxId: string) {
    await remove(keyForId(sandboxId));
  }
  async function readRetry(key: string) {
    const value = await bb.storage.kv.get<unknown>(retryKey(key));
    return value === undefined
      ? { failures: 0, nextAttemptAt: 0 }
      : retrySchema.parse(value);
  }
  return {
    remember,
    forget,
    keys: () => bb.storage.kv.list(prefix),
    read: async (key: string) => {
      const value = await bb.storage.kv.get<unknown>(key);
      return value === undefined ? null : allocationSchema.parse(value);
    },
    remove,
    async ready(key: string, at: number) {
      return (await readRetry(key)).nextAttemptAt <= at;
    },
    async failed(key: string, at: number) {
      const retry = await readRetry(key);
      await bb.storage.kv.set(retryKey(key), {
        failures: Math.min(retry.failures + 1, 7),
        nextAttemptAt:
          at + Math.min(3_600_000, 60_000 * 2 ** Math.min(retry.failures, 6)),
      });
    },
    async succeeded(key: string) {
      if ((await readRetry(key)).failures > 0)
        await bb.storage.kv.delete(retryKey(key));
    },
    isAllocating: (key: string) => allocating.has(key),
    wrap(client: ModalSandboxClient): ModalSandboxClient {
      function wrapHandle(sandbox: ModalSandboxHandle): ModalSandboxHandle {
        return {
          ...sandbox,
          async terminate() {
            await sandbox.terminate();
            try {
              if ((await client.fromId(sandbox.sandboxId)) === null)
                await forget(sandbox.sandboxId);
            } catch (error) {
              bb.log.warn(
                `Modal stopped ${sandbox.sandboxId}; allocation tracking will retry: ${errorMessage(error)}`,
              );
            }
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
            await remove(key);
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
