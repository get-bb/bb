import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod/mini";
import {
  usageSnapshotSchema,
  type ProviderUsage,
  type UsageMachine,
  type UsageProvider,
  type UsageSnapshot,
} from "./usage-schema.js";

const TINT_COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([-+.%\w\s,/]*\)|[a-z]{3,20})$/iu;

export const providerUsageRpcContract = defineRpcContract({
  getUsage: {
    input: z.union([
      z.null(),
      z.strictObject({ force: z.boolean() }),
      z.strictObject({
        force: z.boolean(),
        machineIds: z.nullable(z.array(z.string().check(z.minLength(1)))),
        maxAgeMs: z.number().check(z.int(), z.nonnegative()),
      }),
    ]),
    output: usageSnapshotSchema,
  },
});

const LEGACY_CACHE_MAX_AGE_MS = 15 * 60_000;
const DIRTY_CACHE_MAX_AGE_MS = 2 * 60_000;
const EVENT_DEBOUNCE_MS = 5_000;

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
  usage: Awaited<
    ReturnType<BbPluginApi["sdk"]["system"]["usageLimits"]>
  >[string],
): ProviderUsage | null {
  if (usage === undefined) return null;
  switch (usage.status) {
    case "ok":
      return {
        status: "ok",
        planLabel: usage.planLabel,
        windows: usage.windows.map((window) => ({
          label: window.label,
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt,
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
      return { status: "error", message: usage.message };
  }
}

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];
type Provider = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["list"]>
>[number];

function normalizedProvider(
  provider: Provider,
  usage: Awaited<ReturnType<BbPluginApi["sdk"]["system"]["usageLimits"]>>,
): UsageProvider {
  return {
    id: provider.id,
    displayName: provider.displayName,
    logoUrl: provider.logoUrl,
    iconGlyph: provider.icon?.glyph ?? null,
    iconTint: normalizedTint(provider.strings?.iconTint),
    signInHint:
      provider.strings?.signInHint ??
      "Sign in to " + provider.displayName + ", then reload usage.",
    expiredHint:
      provider.strings?.expiredHint ??
      "Your " +
        provider.displayName +
        " session expired. Sign in again, then reload usage.",
    usage: normalizedUsage(usage[provider.id]),
  };
}

async function loadMachineUsage(
  bb: BbPluginApi,
  host: Host,
): Promise<UsageMachine> {
  const providersPromise = bb.sdk.providers.list({
    hostId: host.id,
    capability: "usage",
  });
  if (host.status === "disconnected") {
    try {
      const providers = await providersPromise;
      return {
        id: host.id,
        displayName: host.name,
        status: host.status,
        providers: providers.map((provider) =>
          normalizedProvider(provider, {}),
        ),
        error: null,
      };
    } catch {
      return {
        id: host.id,
        displayName: host.name,
        status: host.status,
        providers: [],
        error: "Provider information could not be loaded for this machine.",
      };
    }
  }
  const [providersResult, usageResult] = await Promise.allSettled([
    providersPromise,
    bb.sdk.system.usageLimits({ hostId: host.id }),
  ]);
  if (providersResult.status === "rejected") {
    return {
      id: host.id,
      displayName: host.name,
      status: host.status,
      providers: [],
      error: "Provider information could not be loaded for this machine.",
    };
  }
  if (usageResult.status === "rejected") {
    return {
      id: host.id,
      displayName: host.name,
      status: host.status,
      providers: providersResult.value.map((provider) =>
        normalizedProvider(provider, {}),
      ),
      error: "Usage could not be loaded for this machine.",
    };
  }
  return {
    id: host.id,
    displayName: host.name,
    status: host.status,
    providers: providersResult.value.map((provider) =>
      normalizedProvider(provider, usageResult.value),
    ),
    error: null,
  };
}

export default function providerUsagePlugin(bb: BbPluginApi): void {
  const cache = new Map<string, MachineCacheEntry>();
  const pendingByMachine = new Map<string, PendingMachineUsage>();
  const eventTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const environmentHosts = new Map<string, string | null>();
  let disposed = false;

  const readMachine = async (
    host: Host,
    request: UsageRequest,
    targeted: boolean,
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
      !targeted ||
      (!request.force &&
        cached !== undefined &&
        !hostChanged &&
        Date.now() - cached.loadedAt < effectiveMaxAgeMs)
    ) {
      if (cached !== undefined) {
        cached.machine = {
          ...cached.machine,
          displayName: host.name,
          status: host.status,
        };
        return cached.machine;
      }
    }
    const pending = pendingByMachine.get(host.id);
    if (pending !== undefined) {
      if (!request.force || pending.force) return pending.promise;
      await pending.promise;
      return readMachine(host, request, targeted);
    }
    const next = loadMachineUsage(bb, host)
      .then((machine) => {
        const scheduledRefresh = eventTimers.get(host.id);
        if (scheduledRefresh !== undefined) {
          clearTimeout(scheduledRefresh);
          eventTimers.delete(host.id);
        }
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
    const hosts = await bb.sdk.hosts.list();
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
        ),
      ),
    );
    const machines: UsageMachine[] = [];
    for (const host of hosts) {
      const entry = cache.get(host.id);
      if (entry === undefined) {
        throw new Error("Provider usage cache is missing " + host.name + ".");
      }
      machines.push(entry.machine);
    }
    return { machines };
  };

  const eventRefreshDelay = (machineId: string): number => {
    const cached = cache.get(machineId);
    if (cached === undefined) return EVENT_DEBOUNCE_MS;
    return Math.max(
      EVENT_DEBOUNCE_MS,
      cached.loadedAt + DIRTY_CACHE_MAX_AGE_MS - Date.now(),
    );
  };

  const scheduleEventRefresh = (machineId: string | null): void => {
    const timerKey = machineId ?? "*";
    if (machineId === null) {
      for (const entry of cache.values()) entry.dirty = true;
    } else {
      const entry = cache.get(machineId);
      if (entry !== undefined) entry.dirty = true;
    }
    const currentTimer = eventTimers.get(timerKey);
    if (currentTimer !== undefined) clearTimeout(currentTimer);
    const delay =
      machineId === null
        ? Math.max(
            EVENT_DEBOUNCE_MS,
            ...[...cache.values()].map(
              (entry) => entry.loadedAt + DIRTY_CACHE_MAX_AGE_MS - Date.now(),
            ),
          )
        : eventRefreshDelay(machineId);
    const timer = setTimeout(() => {
      eventTimers.delete(timerKey);
      if (disposed) return;
      void readUsage({
        force: false,
        machineIds: machineId === null ? null : [machineId],
        maxAgeMs: DIRTY_CACHE_MAX_AGE_MS,
      }).catch((cause) => {
        bb.log.warn(
          "Provider usage event refresh failed: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
    }, delay);
    eventTimers.set(timerKey, timer);
  };

  const scheduleForThread = async (environmentId: string | null) => {
    if (environmentId === null) {
      scheduleEventRefresh(null);
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
    scheduleEventRefresh(hostId);
  };

  bb.rpc.register(providerUsageRpcContract, {
    getUsage: (input) => {
      if (input === null) {
        return readUsage({
          force: false,
          machineIds: null,
          maxAgeMs: LEGACY_CACHE_MAX_AGE_MS,
        });
      }
      if (!("machineIds" in input)) {
        return readUsage({
          force: input.force,
          machineIds: null,
          maxAgeMs: LEGACY_CACHE_MAX_AGE_MS,
        });
      }
      return readUsage(input);
    },
  });
  bb.events.on("thread.idle", ({ thread }) =>
    scheduleForThread(thread.environmentId),
  );
  bb.events.on("thread.failed", ({ thread }) =>
    scheduleForThread(thread.environmentId),
  );
  bb.onDispose(() => {
    disposed = true;
    for (const timer of eventTimers.values()) clearTimeout(timer);
    eventTimers.clear();
  });
}
