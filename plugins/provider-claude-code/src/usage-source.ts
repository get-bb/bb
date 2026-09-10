import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  usageInputSchema,
  usageSnapshotSchema,
  type UsageSnapshot,
} from "./usage-contract.js";

const contract = defineRpcContract({
  "provider-usage.v1.get": {
    experimental_description:
      "Returns local Claude Code account usage for each host. refresh=true requests fresh collection. Host failures are returned individually; observedAt remains the time of the last successful measurement.",
    input: usageInputSchema,
    output: usageSnapshotSchema,
  },
});

export function registerUsageSource(bb: BbPluginApi) {
  const cache = new Map<string, UsageSnapshot["resources"][number]>();
  const pending = new Map<
    string,
    Promise<UsageSnapshot["resources"][number]>
  >();
  bb.rpc.register(
    contract,
    {
      async "provider-usage.v1.get"({ refresh }) {
        const hosts = await bb.sdk.hosts.list();
        for (const id of cache.keys())
          if (!hosts.some((host) => host.id === id)) cache.delete(id);
        const resources: UsageSnapshot["resources"] = [];
        for (let offset = 0; offset < hosts.length; offset += 3) {
          resources.push(
            ...(await Promise.all(
              hosts.slice(offset, offset + 3).map(async (host) => {
                const previous = cache.get(host.id);
                const base = {
                  id: host.id,
                  providerId: "claude-code",
                  label: "Claude Code",
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
                const load = (async (): Promise<
                  UsageSnapshot["resources"][number]
                > => {
                  try {
                    const result = await bb.sdk.system.usageLimits({
                      hostId: host.id,
                      providerId: "claude-code",
                    });
                    const usage = result["claude-code"];
                    if (usage === undefined)
                      throw new Error(
                        "Provider returned no usage information.",
                      );
                    const resource = {
                      ...base,
                      observedAt:
                        usage.status === "ok" ? Date.now() : base.observedAt,
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
                        message:
                          "Usage could not be collected from this machine.",
                      },
                    };
                  }
                })().finally(() => pending.delete(host.id));
                pending.set(host.id, load);
                return load;
              }),
            )),
          );
        }
        return { resources };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Claude Code usage from host-local credentials. Independent of pooled accounts and display plugins.",
    },
  );
}
