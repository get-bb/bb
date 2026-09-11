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
  usageSourceMethod,
  usageSourceRpcContract,
  type UsageSnapshot as SourceSnapshot,
} from "./usage-source-contract.js";

type Resource = SourceSnapshot["resources"][number];
interface SourceResult {
  pluginId: string;
  resources: Resource[];
  error: string | null;
}

const TINT_COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([-+.%\w\s,/]*\)|[a-z]{3,20})$/iu;

export const providerUsageRpcContract = defineRpcContract({
  getUsage: {
    input: z.strictObject({
      force: z.boolean(),
      machineIds: z.nullable(z.array(z.string().check(z.minLength(1)))),
      maxAgeMs: z.number().check(z.int(), z.nonnegative()),
    }),
    output: usageSnapshotSchema,
  },
});

const DIRTY_CACHE_MAX_AGE_MS = 2 * 60_000;

interface UsageRequest {
  force: boolean;
  machineIds: string[] | null;
  maxAgeMs: number;
}

interface MachineCacheEntry {
  dirty: boolean;
  loadedAt: number;
  machine: UsageMachine;
}

interface PendingMachineUsage {
  force: boolean;
  promise: Promise<UsageMachine>;
}

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

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];
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
  resource: Resource,
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
      resource.usage,
    ),
    id: `${pluginId}:${resource.id}`,
    accountLabel: resource.scope.kind === "shared" ? resource.usage.accountEmail : null,
  };
}

async function loadMachineUsage(
  bb: BbPluginApi,
  host: Host,
  readSources: () => Promise<SourceResult[]>,
): Promise<UsageMachine> {
  const [metadata, sources] = await Promise.allSettled([
    bb.sdk.providers.list({ hostId: host.id, capability: "usage" }),
    host.status === "disconnected" ? Promise.resolve([]) : readSources(),
  ]);
  const providers = metadata.status === "fulfilled" ? metadata.value : [];
  const results = sources.status === "fulfilled" ? sources.value : [];
  const providerOrder = new Map(
    providers.map((provider, index) => [provider.id, index]),
  );
  const resources = results
    .flatMap((source) =>
      source.resources
        .filter(
          (resource) =>
            resource.scope.kind === "host" && resource.scope.hostId === host.id,
        )
        .map((resource) => ({ pluginId: source.pluginId, resource })),
    )
    .sort(
      (left, right) =>
        (providerOrder.get(left.resource.providerId) ?? providers.length) -
        (providerOrder.get(right.resource.providerId) ?? providers.length),
    )
    .map(({ pluginId, resource }) =>
      resourceProvider(resource, pluginId, providers),
    );
  return {
    id: host.id,
    displayName: host.name,
    status: host.status,
    providers:
      host.status === "disconnected"
        ? providers.map((provider) => normalizedProvider(provider, undefined))
        : resources,
    error:
      sources.status === "rejected"
        ? "Usage sources could not be discovered."
        : null,
  };
}

export default function providerUsagePlugin(bb: BbPluginApi): void {
  const cache = new Map<string, MachineCacheEntry>();
  const pendingByMachine = new Map<string, PendingMachineUsage>();
  let sourceResults: SourceResult[] = [];
  let sourceLoadedAt = 0;
  let sourceSignature = "";
  let sharedDirty = false;
  const environmentHosts = new Map<string, string | null>();

  const readMachine = async (
    host: Host,
    request: UsageRequest,
    targeted: boolean,
    readSources: () => Promise<SourceResult[]>,
  ): Promise<UsageMachine> => {
    const cached = cache.get(host.id);
    const effectiveMaxAgeMs =
      cached?.dirty === true
        ? Math.min(request.maxAgeMs, DIRTY_CACHE_MAX_AGE_MS)
        : request.maxAgeMs;
    const hostChanged =
      cached !== undefined &&
      (cached.machine.status !== host.status ||
        cached.machine.displayName !== host.name);
    if (
      cached !== undefined &&
      (!targeted ||
        (!request.force &&
          !hostChanged &&
          Date.now() - cached.loadedAt < effectiveMaxAgeMs))
    ) {
      cached.machine = {
        ...cached.machine,
        displayName: host.name,
        status: host.status,
      };
      return cached.machine;
    }
    const pending = pendingByMachine.get(host.id);
    if (pending !== undefined) {
      if (!request.force || pending.force) return pending.promise;
      await pending.promise;
      return readMachine(host, request, targeted, readSources);
    }
    const next = loadMachineUsage(bb, host, readSources)
      .then((machine) => {
        cache.set(host.id, {
          dirty: false,
          loadedAt: Date.now(),
          machine,
        });
        return machine;
      })
      .finally(() => {
        pendingByMachine.delete(host.id);
      });
    pendingByMachine.set(host.id, { force: request.force, promise: next });
    return next;
  };

  const readUsage = async (request: UsageRequest): Promise<UsageSnapshot> => {
    const [hosts, sources] = await Promise.all([
      bb.sdk.hosts.list(),
      bb.sdk.plugins.experimental_discoverRpc({ method: usageSourceMethod }),
    ]);
    const signature = JSON.stringify(sources);
    if (signature !== sourceSignature) {
      cache.clear();
      sourceResults = [];
      sourceLoadedAt = 0;
      sourceSignature = signature;
    }
    let pendingSources: Promise<SourceResult[]> | undefined;
    const readSources = () =>
      (pendingSources ??= (async () => {
        const results: SourceResult[] = [];
        for (let offset = 0; offset < sources.length; offset += 3) {
          results.push(
            ...(await Promise.all(
              sources
                .slice(offset, offset + 3)
                .map(async (source): Promise<SourceResult> => {
                  try {
                    const snapshot = await bb.sdk.plugins.callRpc({
                      pluginId: source.pluginId,
                      method: usageSourceMethod,
                      input: { refresh: request.force },
                      outputSchema:
                        usageSourceRpcContract[usageSourceMethod].output,
                      signal: AbortSignal.timeout(45_000),
                    });
                    return {
                      pluginId: source.pluginId,
                      resources: snapshot.resources,
                      error: null,
                    };
                  } catch {
                    return {
                      pluginId: source.pluginId,
                      resources: [],
                      error:
                        "Usage could not be loaded from " +
                        source.pluginId +
                        ".",
                    };
                  }
                }),
            )),
          );
        }
        sourceResults = results;
        sourceLoadedAt = Date.now();
        sharedDirty = false;
        return results;
      })());
    const hostIds = new Set(hosts.map((host) => host.id));
    for (const machineId of cache.keys()) {
      if (!hostIds.has(machineId)) cache.delete(machineId);
    }
    const targetedIds =
      request.machineIds === null ? null : new Set(request.machineIds);
    await Promise.all(
      hosts.map((host) =>
        readMachine(
          host,
          request,
          targetedIds === null ||
            targetedIds.has(host.id) ||
            !cache.has(host.id),
          readSources,
        ),
      ),
    );
    const sharedTargeted =
      request.machineIds === null ||
      request.machineIds.some((id) => id.startsWith("source:"));
    if (
      sourceLoadedAt === 0 ||
      (sharedTargeted &&
        (request.force ||
          Date.now() - sourceLoadedAt >=
            (sharedDirty
              ? Math.min(request.maxAgeMs, DIRTY_CACHE_MAX_AGE_MS)
              : request.maxAgeMs)))
    ) {
      await readSources();
    }
    const machines: UsageMachine[] = [];
    for (const host of hosts) {
      const entry = cache.get(host.id);
      if (entry === undefined) {
        throw new Error("Provider usage cache is missing " + host.name + ".");
      }
      machines.push(entry.machine);
    }
    const sharedProviders = sourceResults.some((source) =>
      source.resources.some((resource) => resource.scope.kind === "shared"),
    )
      ? await bb.sdk.providers.list({ capability: "usage" }).catch(() => [])
      : [];
    for (const source of sourceResults) {
      const shared = source.resources.filter(
        (resource) => resource.scope.kind === "shared",
      );
      if (
        shared.length === 0 &&
        source.resources.length > 0 &&
        source.error === null
      )
        continue;
      machines.push({
        id: `source:${source.pluginId}`,
        displayName:
          sources.find((entry) => entry.pluginId === source.pluginId)
            ?.displayName ?? source.pluginId,
        status: "connected",
        providers: shared.map((resource) =>
          resourceProvider(resource, source.pluginId, sharedProviders),
        ),
        error: source.error,
      });
    }
    return { machines };
  };

  const markDirty = (machineId: string | null): void => {
    sharedDirty = true;
    if (machineId === null) {
      for (const entry of cache.values()) entry.dirty = true;
    } else {
      const entry = cache.get(machineId);
      if (entry !== undefined) entry.dirty = true;
    }
  };

  const markDirtyForThread = async (environmentId: string | null) => {
    if (environmentId === null) {
      markDirty(null);
      return;
    }
    let hostId = environmentHosts.get(environmentId);
    if (hostId === undefined) {
      try {
        const environment = await bb.sdk.environments.get({ environmentId });
        hostId = environment.hostId;
      } catch {
        hostId = null;
      }
      environmentHosts.set(environmentId, hostId);
    }
    markDirty(hostId);
  };

  bb.rpc.register(providerUsageRpcContract, {
    getUsage: readUsage,
  });
  bb.events.on("thread.idle", ({ thread }) =>
    markDirtyForThread(thread.environmentId),
  );
  bb.events.on("thread.failed", ({ thread }) =>
    markDirtyForThread(thread.environmentId),
  );
}
