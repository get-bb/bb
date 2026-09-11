import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  usageSourceRpcContract,
  usageListMethod,
  usageFetchMethod,
  type UsageResource,
} from "./usage-contract.js";
export function registerUsageSource(bb: BbPluginApi) {
  const cache = new Map<string, UsageResource>();
  const pending = new Map<string, Promise<UsageResource>>();
  bb.rpc.register(
    usageSourceRpcContract,
    {
      async [usageListMethod]() {
        const hosts = await bb.sdk.hosts.list();
        for (const id of cache.keys())
          if (!hosts.some((host) => host.id === id)) cache.delete(id);
        return {
          resources: hosts.map((host) => ({
            id: host.id,
            providerId: "codex",
            label: "Codex",
            scope: {
              kind: "host" as const,
              hostId: host.id,
              hostName: host.name,
            },
          })),
        };
      },
      async [usageFetchMethod]({ resourceId, refresh }) {
        const host = (await bb.sdk.hosts.list()).find(
          (host) => host.id === resourceId,
        );
        if (!host) throw new Error("Usage resource no longer exists.");
        const previous = cache.get(host.id);
        const base = {
          id: host.id,
          providerId: "codex",
          label: "Codex",
          scope: {
            kind: "host" as const,
            hostId: host.id,
            hostName: host.name,
          },
          observedAt: previous?.observedAt ?? null,
        };
        if (host.status === "disconnected") {
          return {
            ...base,
            usage: {
              status: "error" as const,
              accountEmail: null,
              planLabel: null,
              message: "Machine is disconnected.",
            },
          };
        }
        if (
          !refresh &&
          previous?.usage.status === "ok" &&
          previous.observedAt !== null &&
          Date.now() - previous.observedAt < 60_000
        ) {
          return { ...previous, scope: base.scope };
        }
        const running = pending.get(host.id);
        if (running !== undefined) return running;
        const load = (async (): Promise<UsageResource> => {
          try {
            const result = await bb.sdk.system.usageLimits({
              hostId: host.id,
              providerId: "codex",
            });
            const usage = result["codex"];
            if (usage === undefined)
              throw new Error("Provider returned no usage information.");
            const resource = {
              ...base,
              observedAt: usage.status === "ok" ? Date.now() : base.observedAt,
              usage:
                usage.status === "ok"
                  ? {
                      ...usage,
                      windows: usage.windows.map((window, index) => ({
                        ...window,
                        id: `${index}:${window.label}`,
                        model: null,
                        cost: window.cost ?? null,
                      })),
                    }
                  : usage.status === "error"
                    ? usage
                    : {
                        status: usage.status,
                        accountEmail: null,
                        planLabel: null,
                      },
            };
            cache.set(host.id, resource);
            return resource;
          } catch {
            return {
              ...base,
              usage: {
                status: "error",
                accountEmail: null,
                planLabel: null,
                message: "Usage could not be collected from this machine.",
              },
            };
          }
        })().finally(() => pending.delete(host.id));
        pending.set(host.id, load);
        return load;
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Codex usage from host-local credentials. Inventory never collects usage.",
    },
  );
}
