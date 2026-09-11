import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  usageSourceRpcContract,
  usageListMethod,
  usageFetchMethod,
  usageMeasurementSchema,
  usagePlanSchema,
  usageWindowKindSchema,
  type UsageMeasurement,
} from "./src/usage-contract.js";

const locatorSchema = z.tuple([z.string().min(1), z.string().min(1)]);
const metadataSchema = z.object({
  accountKey: z.string().min(1).nullable().catch(null),
  plan: usagePlanSchema.nullable().catch(null),
});
const windowMetadataSchema = z.object({
  kind: usageWindowKindSchema.catch("custom"),
  model: z.string().nullable().catch(null),
});

export default function usageSourcesPlugin(bb: BbPluginApi) {
  const cache = new Map<string, UsageMeasurement>();
  const pending = new Map<
    string,
    { refresh: boolean; promise: Promise<UsageMeasurement> }
  >();
  const load = async (
    resourceId: string,
    refresh: boolean,
  ): Promise<UsageMeasurement> => {
    const [hostId, providerId] = locatorSchema.parse(JSON.parse(resourceId));
    const host = (await bb.sdk.hosts.list()).find((host) => host.id === hostId);
    if (!host) throw new Error("Usage resource no longer exists.");
    const previous = cache.get(resourceId);
    const unavailable = (message: string) =>
      usageMeasurementSchema.parse({
        accountKey: previous?.accountKey ?? null,
        observedAt: previous?.observedAt ?? null,
        usage: {
          status: "error",
          accountEmail: null,
          planLabel: null,
          message,
        },
      });
    if (host.status === "disconnected")
      return unavailable("Machine is disconnected.");
    const providers = await bb.sdk.providers.list({
      hostId,
      capability: "usage",
    });
    if (!providers.some((provider) => provider.id === providerId))
      throw new Error("Usage resource no longer exists.");
    if (
      !refresh &&
      previous?.usage.status === "ok" &&
      previous.observedAt !== null &&
      Date.now() - previous.observedAt < 60_000
    )
      return previous;
    const promise = (async () => {
      try {
        const result = await bb.sdk.system.usageLimits({ hostId, providerId });
        const usage = result[providerId];
        if (!usage) throw new Error("Provider returned no usage information.");
        const metadata = metadataSchema.parse(usage);
        const value = usageMeasurementSchema.parse({
          accountKey: metadata.accountKey,
          observedAt:
            usage.status === "ok" ? Date.now() : (previous?.observedAt ?? null),
          usage: {
            accountEmail: null,
            planLabel: null,
            ...usage,
            plan: metadata.plan,
            ...(usage.status === "ok"
              ? {
                  windows: usage.windows.map((window, index) => ({
                    ...window,
                    ...windowMetadataSchema.parse(window),
                    id: `${index}:${window.label}`,
                    cost: window.cost ?? null,
                  })),
                }
              : {}),
          },
        });
        cache.set(resourceId, value);
        return value;
      } catch {
        return unavailable("Usage could not be collected from this machine.");
      }
    })();
    return promise;
  };
  const collect = async (
    resourceId: string,
    refresh: boolean,
  ): Promise<UsageMeasurement> => {
    const running = pending.get(resourceId);
    if (running) {
      if (!refresh || running.refresh) return running.promise;
      await running.promise.catch(() => undefined);
      return collect(resourceId, refresh);
    }
    const promise = load(resourceId, refresh).finally(() =>
      pending.delete(resourceId),
    );
    pending.set(resourceId, { refresh, promise });
    return promise;
  };
  bb.rpc.register(
    usageSourceRpcContract,
    {
      async [usageListMethod]() {
        const hosts = await bb.sdk.hosts.list();
        const resources = (
          await Promise.all(
            hosts.map(async (host) => {
              const providers = await bb.sdk.providers.list({
                hostId: host.id,
                capability: "usage",
              });
              return providers.map((provider) => {
                const id = JSON.stringify([host.id, provider.id]);
                return {
                  id,
                  accountKey: cache.get(id)?.accountKey ?? null,
                  providerId: provider.id,
                  label: provider.displayName,
                  scope: {
                    kind: "host" as const,
                    hostId: host.id,
                    hostName: host.name,
                  },
                };
              });
            }),
          )
        ).flat();
        const ids = new Set(resources.map((resource) => resource.id));
        for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
        return { resources };
      },
      [usageFetchMethod]: ({ resourceId, refresh }) =>
        collect(resourceId, refresh),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Host-local usage from providers declaring maintenance.usage. Inventory reads provider metadata only. Independent of display plugins.",
    },
  );
}
