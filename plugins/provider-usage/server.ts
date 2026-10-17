import { createResourceReadCache } from "./resource-read-cache.js";
import {
  normalizeUsageMeasurement,
  selectUsageResources,
} from "./usage-normalization.js";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod/mini";
import {
  usageSnapshotSchema,
  type ProviderUsage,
  type UsageMachine,
  type UsageProvider,
  type UsageSnapshot,
} from "./usage-schema.js";

import {
  usageListMethod,
  usageFetchMethod,
  type UsageResourceList,
  type UsageMeasurement,
  usageSourceRpcContract,
  type UsageResource as Resource,
} from "./usage-source-contract.js";

interface SourceResult {
  pluginId: string;
  label: string | null;
  resources: UsageResourceList["resources"];
  error: string | null;
}

const TINT_COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([-+.%\w\s,/]*\)|[a-z]{3,20})$/iu;

const usageRequestSchema = z.strictObject({
  force: z.boolean(),
  machineIds: z.nullable(z.array(z.string().check(z.minLength(1)))),
  providerIds: z.array(z.string().check(z.minLength(1))),
  maxAgeMs: z.number().check(z.int(), z.nonnegative()),
});
const usageTags = (request: z.infer<typeof usageRequestSchema>) => [
  "inventory",
  ...(request.providerIds.length
    ? [
        "usage",
        ...(request.machineIds?.map((id) => `usage:${id}`) ?? ["usage:all"]),
      ]
    : []),
];
export const providerUsageRpcContract = defineRpcContract({
  getUsage: {
    input: usageRequestSchema,
    output: usageSnapshotSchema,
    tags: usageTags,
    invalidates: (input) => (input.force ? ["inventory", "usage"] : []),
  },
  refreshUsage: {
    input: z.omit(usageRequestSchema, { force: true }),
    output: usageSnapshotSchema,
    invalidates: () => ["inventory", "usage"],
  },
});

export type UsageRequest = z.infer<
  typeof providerUsageRpcContract.getUsage.input
>;
function normalizedTint(
  tint: { light: string; dark: string } | undefined,
): { light: string; dark: string } | null {
  if (
    tint === undefined ||
    !TINT_COLOR_PATTERN.test(tint.light.trim()) ||
    !TINT_COLOR_PATTERN.test(tint.dark.trim())
  ) {
    return null;
  }
  return { light: tint.light.trim(), dark: tint.dark.trim() };
}

function normalizedUsage(
  usage: Resource["usage"] | undefined,
): ProviderUsage | null {
  if (usage === undefined) return null;
  switch (usage.status) {
    case "ok":
      return {
        status: "ok",
        accountEmail: usage.accountEmail || null,
        planLabel: usage.planLabel || null,
        windows: usage.windows.map((window) => ({
          label: window.label,
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt || null,
          cost: window.cost ?? null,
        })),
      };
    case "not_installed":
      return { status: "not_installed" };
    case "unauthenticated":
      return { status: "unauthenticated" };
    case "expired":
      return { status: "expired" };
    case "error":
      return {
        status: "error",
        message: usage.message || "Usage could not be collected.",
      };
  }
}

type Provider = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["list"]>
>[number];

function normalizedProvider(
  provider: Pick<
    Provider,
    "id" | "displayName" | "logoUrl" | "icon" | "strings"
  >,
  usage: Resource["usage"] | undefined,
): UsageProvider {
  return {
    id: provider.id,
    providerId: provider.id,
    accountLabel: null,
    displayName: provider.displayName,
    logoUrl: provider.logoUrl,
    icon: provider.icon ?? null,
    strings: { iconTint: normalizedTint(provider.strings?.iconTint) },
    signInHint:
      provider.strings?.signInHint ??
      "Sign in to " + provider.displayName + ", then reload usage.",
    expiredHint:
      provider.strings?.expiredHint ??
      "Your " +
        provider.displayName +
        " session expired. Sign in again, then reload usage.",
    usage: normalizedUsage(usage),
  };
}

function resourceProvider(
  resource: UsageResourceList["resources"][number],
  measurement: UsageMeasurement | undefined,
  pluginId: string,
  providers: Provider[],
): UsageProvider {
  const metadata = providers.find(
    (provider) => provider.id === resource.providerId,
  );
  return {
    ...normalizedProvider(
      metadata ?? {
        id: resource.providerId,
        displayName: resource.providerId,
        logoUrl: null,
      },
      measurement?.usage,
    ),
    ...(resource.scope.kind === "shared"
      ? {
          signInHint:
            "Sign in to this account in the source plugin’s settings, then reload usage.",
          expiredHint:
            "This account’s session expired. Sign in again in the source plugin’s settings, then reload usage.",
        }
      : {}),
    id: `${pluginId}:${resource.id}`,
    accountLabel:
      resource.scope.kind === "shared"
        ? (measurement?.usage.accountEmail ?? resource.label)
        : null,
  };
}

export default function providerUsagePlugin(bb: BbPluginApi): void {
  const keyOf = (pluginId: string, resourceId: string) =>
    JSON.stringify([pluginId, resourceId]);
  const resourceKeySchema = z.tuple([z.string(), z.string()]);
  const discoveries = createResourceReadCache(async (_key, _force, signal) =>
    bb.sdk.plugins.experimental_discoverRpc({
      method: usageListMethod,
      signal,
    }),
  );
  const inventories = createResourceReadCache(
    async (pluginId, _force, signal) =>
      bb.sdk.plugins.callRpc({
        pluginId,
        method: usageListMethod,
        input: {},
        outputSchema: usageSourceRpcContract[usageListMethod].output,
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      }),
  );
  const measurements = createResourceReadCache(async (key, force, signal) => {
    const [pluginId, resourceId] = resourceKeySchema.parse(JSON.parse(key));
    const raw = await bb.sdk.plugins.callRpc({
      pluginId,
      method: usageFetchMethod,
      input: { resourceId, refresh: force },
      outputSchema: usageSourceRpcContract[usageFetchMethod].output,
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    const value = normalizeUsageMeasurement(raw);
    if (value.usage.status === "error")
      throw new Error("Usage could not be refreshed.");
    return value;
  });
  bb.onDispose(() => {
    discoveries.dispose();
    inventories.dispose();
    measurements.dispose();
    snapshots.dispose();
  });
  const collectUsage = async (
    request: UsageRequest,
  ): Promise<UsageSnapshot> => {
    const hostId = request.machineIds?.find((id) => !id.startsWith("source:"));
    const [hosts, sources, providers, config] = await Promise.all([
      bb.sdk.hosts
        .list()
        .then((hosts) => hosts.filter((host) => host.type !== "ephemeral")),
      discoveries
        .read("sources", { force: request.force, maxAgeMs: 0 })
        .then(({ value, error }) => {
          if (error || !value)
            throw error ?? new Error("Usage sources could not be listed.");
          return value;
        }),
      bb.sdk.providers
        .list(
          hostId === undefined
            ? { capability: "usage" }
            : { capability: "usage", hostId },
        )
        .catch(() => []),
      bb.sdk.system.config().catch(() => null),
    ]);
    hosts.sort(
      (a, b) =>
        Number(b.id === config?.primaryHostId) -
        Number(a.id === config?.primaryHostId),
    );
    inventories.retain(new Set(sources.map((source) => source.pluginId)));
    const sourceResults = new Map<string, SourceResult>();
    for (let offset = 0; offset < sources.length; offset += 3) {
      await Promise.all(
        sources.slice(offset, offset + 3).map(async (source) => {
          const result = await inventories.read(source.pluginId, {
            force: request.force,
            maxAgeMs: 0,
          });
          sourceResults.set(source.pluginId, {
            pluginId: source.pluginId,
            label: result.value?.label ?? null,
            resources: result.value?.resources ?? [],
            error: result.error ? "Usage resources could not be listed." : null,
          });
        }),
      );
    }
    measurements.retain(
      new Set(
        [...sourceResults.values()].flatMap((source) =>
          source.resources.map((resource) =>
            keyOf(source.pluginId, resource.id),
          ),
        ),
      ),
    );
    const selected = [...sourceResults.values()].flatMap((source) =>
      source.resources
        .filter((resource) => {
          const machineId =
            resource.scope.kind === "shared"
              ? `source:${source.pluginId}`
              : resource.scope.hostId;
          return (
            request.providerIds.includes(resource.providerId) &&
            (request.machineIds === null ||
              request.machineIds.includes(machineId)) &&
            (resource.scope.kind === "shared" ||
              hosts.some(
                (host) =>
                  resource.scope.kind === "host" &&
                  host.id === resource.scope.hostId &&
                  host.status === "connected",
              ))
          );
        })
        .map((resource) => ({ source, resource })),
    );
    for (let offset = 0; offset < selected.length; offset += 3) {
      await Promise.all(
        selected.slice(offset, offset + 3).map(async ({ source, resource }) => {
          const key = keyOf(source.pluginId, resource.id);
          await measurements.read(key, {
            force: request.force,
            maxAgeMs: request.maxAgeMs,
          });
        }),
      );
    }
    const machines: UsageMachine[] = hosts.map((host) => ({
      id: host.id,
      displayName: host.name,
      status: host.status,
      providers: [],
      error: null,
    }));
    const candidates: Array<{
      source: SourceResult;
      resource: UsageResourceList["resources"][number];
      machineId: string;
    }> = [];
    for (const source of sourceResults.values()) {
      const hasShared =
        source.label !== null ||
        source.resources.some((resource) => resource.scope.kind === "shared");
      if (hasShared || (source.error !== null && source.resources.length === 0))
        machines.push({
          id: `source:${source.pluginId}`,
          displayName:
            source.label ??
            sources.find((item) => item.pluginId === source.pluginId)
              ?.displayName ??
            source.pluginId,
          status: "connected",
          providers: [],
          error: source.error,
        });
      for (const resource of source.resources) {
        const machineId =
          resource.scope.kind === "shared"
            ? `source:${source.pluginId}`
            : resource.scope.hostId;
        candidates.push({ source, resource, machineId });
      }
    }
    for (const machine of machines) {
      const visible = selectUsageResources(
        candidates.filter((candidate) => candidate.machineId === machine.id),
        ({ source, resource }) => ({
          ...resource,
          accountKey:
            measurements.peek(keyOf(source.pluginId, resource.id))?.value
              ?.accountKey ?? resource.accountKey,
        }),
      );
      for (const { source, resource } of visible) {
        const key = keyOf(source.pluginId, resource.id);
        const cached = measurements.peek(key);
        machine.providers.push(
          resourceProvider(resource, cached?.value, source.pluginId, providers),
        );
        if (source.error !== null || cached?.error)
          machine.error = "Some usage could not be refreshed.";
      }
    }
    const providerOrder = new Map(
      providers.map((provider, index) => [provider.id, index]),
    );
    for (const machine of machines)
      machine.providers.sort(
        (a, b) =>
          (providerOrder.get(a.providerId) ?? Number.MAX_SAFE_INTEGER) -
          (providerOrder.get(b.providerId) ?? Number.MAX_SAFE_INTEGER),
      );
    return { machines };
  };
  const snapshots = createResourceReadCache((key) =>
    collectUsage(usageRequestSchema.parse(JSON.parse(key))),
  );
  const readUsage = async (request: UsageRequest): Promise<UsageSnapshot> => {
    const result = await snapshots.read(JSON.stringify(request), {
      force: request.force,
      maxAgeMs: 0,
    });
    if (result.error || !result.value)
      throw result.error ?? new Error("Usage could not be loaded.");
    return result.value;
  };
  bb.rpc.register(providerUsageRpcContract, {
    getUsage: readUsage,
    refreshUsage: (request) => readUsage({ ...request, force: true }),
  });
  bb.rpc.experimental_whileWatched("getUsage", (read, signal) => {
    if (!("input" in read)) return;
    const request = usageRequestSchema.parse(read.input);
    const measurementTags = usageTags(request).filter(
      (tag) => tag !== "inventory" && tag !== "usage",
    );
    const timer = setInterval(
      () => {
        if (measurementTags.length) measurements.expire();
        bb.rpc.experimental_invalidate(
          measurementTags.length ? measurementTags : ["inventory"],
        );
      },
      measurementTags.length ? Math.max(1_000, request.maxAgeMs) : 30 * 60_000,
    );
    signal.addEventListener("abort", () => clearInterval(timer), {
      once: true,
    });
  });
  bb.background.service("usage-inventories", {
    async start(signal) {
      const sources = new Map<string, () => void>();
      const invalidate = () => {
        snapshots.invalidate();
        discoveries.invalidate();
        inventories.invalidate();
        bb.rpc.experimental_invalidate(["inventory"]);
      };
      const stopHosts = bb.sdk.subscribe({
        event: "host:changed",
        callback: invalidate,
      });
      const stopSystem = bb.sdk.subscribe({
        event: "system:changed",
        callback: (event) => {
          if (
            event.changes.includes("config-changed") ||
            event.changes.includes("provider-registrations-changed")
          )
            invalidate();
        },
      });
      const stopDiscovery = bb.sdk.plugins.experimental_watchDiscovery({
        method: usageListMethod,
        signal,
        onChange: (next) => {
          const ids = new Set(next.map((source) => source.pluginId));
          for (const [id, stop] of sources)
            if (!ids.has(id)) {
              stop();
              sources.delete(id);
            }
          inventories.retain(ids);
          measurements.retain(
            new Set(
              [...ids].flatMap((id) =>
                (inventories.peek(id)?.value?.resources ?? []).map((resource) =>
                  keyOf(id, resource.id),
                ),
              ),
            ),
          );
          for (const id of ids)
            if (!sources.has(id))
              sources.set(
                id,
                bb.sdk.plugins.experimental_watchRpc({
                  pluginId: id,
                  method: usageListMethod,
                  input: {},
                  outputSchema: usageSourceRpcContract[usageListMethod].output,
                  signal,
                  onChange: (inventory) => {
                    measurements.retain(
                      new Set(
                        inventory.resources.map((resource) =>
                          keyOf(id, resource.id),
                        ),
                      ),
                      (key) =>
                        resourceKeySchema.parse(JSON.parse(key))[0] === id,
                    );
                    invalidate();
                  },
                  onError: invalidate,
                }),
              );
          invalidate();
        },
        onError: invalidate,
      });
      try {
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
      } finally {
        stopHosts();
        stopSystem();
        stopDiscovery();
        for (const stop of sources.values()) stop();
      }
    },
  });
  const markDirty = () => {
    snapshots.invalidate();
    measurements.invalidate();
    bb.rpc.experimental_invalidate(["usage"]);
  };
  bb.events.on("thread.idle", markDirty);
  bb.events.on("thread.failed", markDirty);
}
