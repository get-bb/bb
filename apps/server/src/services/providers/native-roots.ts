/**
 * The native roots one provider listing scans on one host: the skill and
 * command roots the provider's plugin declared, plus the roots the plugin
 * resolved for that host and workspace through its `bb.host` entry
 * (`resolveNativeRoots`, declared by `resolvesNativeRoots`).
 *
 * Resolution is a plugin-host RPC per (plugin, provider, host, cwd), so the
 * answers are cached for a short window and shared between concurrent
 * callers. A failed call — no live artifact, a transport error, a malformed
 * answer — is logged once per window with the plugin and provider named and
 * yields no resolved roots: a vendor file the plugin cannot read must never
 * fail the listing.
 *
 * A listing spends one command timeout in total: `createProviderListingBudget`
 * hands the resolver call and the daemon scan that follows the time that is
 * left, so a slow plugin cannot double the wait.
 */
import {
  EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  providerNativeRootsAreEmpty,
  providerResolvedNativeRootsSchema,
  type ProviderNativeRootSet,
  type ProviderResolvedNativeRoots,
} from "@bb/domain";
import type {
  HostDaemonOnlineRpcResultForCommand,
  HostDaemonRetryableOnlineRpcCommand,
} from "@bb/host-daemon-contract";
import { experimental_nativeRootsHostContract } from "@get-bb/plugin-sdk/host";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import {
  callHostRetryableOnlineRpc,
  hostCommandTimeoutError,
} from "../hosts/online-rpc.js";
import { callPluginHostRpc } from "../plugins/plugin-host-rpc.js";
import type { ProviderRegistration } from "./provider-registry.js";

/** How long one resolved answer serves listings before the plugin is asked again. */
export const PROVIDER_NATIVE_ROOTS_CACHE_TTL_MS = 10_000;

interface CacheEntry {
  pluginId: string;
  /** The registry revision the answer was resolved under. */
  registrationRevision: number;
  expiresAt: number;
  value: Promise<ProviderResolvedNativeRoots>;
}

/**
 * Resolved native roots per (plugin, provider, host, cwd). Entries expire
 * after the TTL, on `invalidate`, and when the provider registration set
 * changes (a plugin reload re-registers its providers with a new artifact, so
 * the revision is the re-registration signal).
 */
export interface ProviderNativeRootsCache {
  /** Drop every cached answer, or only one plugin's. */
  invalidate(pluginId?: string): void;
  /** @internal The cached or in-flight answer for a key, or undefined. */
  lookup(
    key: string,
    registrationRevision: number,
  ): Promise<ProviderResolvedNativeRoots> | undefined;
  /** @internal Record an in-flight answer for a key. */
  store(
    key: string,
    entry: {
      pluginId: string;
      registrationRevision: number;
      value: Promise<ProviderResolvedNativeRoots>;
    },
  ): void;
}

export function createProviderNativeRootsCache(
  options: { now?: () => number; ttlMs?: number } = {},
): ProviderNativeRootsCache {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? PROVIDER_NATIVE_ROOTS_CACHE_TTL_MS;
  const entries = new Map<string, CacheEntry>();
  return {
    invalidate(pluginId) {
      if (pluginId === undefined) {
        entries.clear();
        return;
      }
      for (const [key, entry] of entries) {
        if (entry.pluginId === pluginId) entries.delete(key);
      }
    },
    lookup(key, registrationRevision) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (
        entry.registrationRevision !== registrationRevision ||
        entry.expiresAt <= now()
      ) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    store(key, entry) {
      const stored: CacheEntry = { ...entry, expiresAt: now() + ttlMs };
      entries.set(key, stored);
      // The window runs from the answer, not from the call: a cold call that
      // is slower than the TTL would otherwise expire while in flight and
      // the next caller would start a second one.
      const restamp = (): void => {
        if (entries.get(key) === stored) stored.expiresAt = now() + ttlMs;
      };
      void entry.value.then(restamp, restamp);
    },
  };
}

/**
 * Under this much remaining time the next step is not attempted: the listing
 * answers the `command_timeout` a slow daemon scan would have produced.
 */
export const PROVIDER_LISTING_BUDGET_FLOOR_MS = 1_000;

/**
 * One deadline for one provider listing. The resolver call and the daemon
 * scan each take what is left, so the listing never waits longer than one
 * command timeout in total.
 */
export interface ProviderListingBudget {
  /**
   * The time left for the next step. Throws the 504 `command_timeout` a
   * daemon timeout raises when less than the floor remains.
   */
  remainingMs(): number;
}

export function createProviderListingBudget(
  options: { totalMs?: number; now?: () => number } = {},
): ProviderListingBudget {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.totalMs ?? COMMAND_TIMEOUT_MS);
  return {
    remainingMs() {
      const remaining = deadline - now();
      if (remaining < PROVIDER_LISTING_BUDGET_FLOOR_MS) {
        throw hostCommandTimeoutError();
      }
      return remaining;
    },
  };
}

export type ProviderNativeRootsDeps = WorkSessionDeps &
  Pick<AppDeps, "logger" | "providerNativeRoots">;

/**
 * Whether a listing has anything to scan for this provider: it declared a
 * skill or command root, or its plugin resolves roots per host. A provider
 * without either contributes nothing to a listing, so the daemon roundtrip
 * is skipped for it.
 */
export function providerHasNativeRootSurface(
  registration: ProviderRegistration,
): boolean {
  return (
    registration.resolvesNativeRoots ||
    !providerNativeRootsAreEmpty(registration.nativeSkillRoots) ||
    !providerNativeRootsAreEmpty(registration.nativeCommandRoots)
  );
}

function cacheKey(args: {
  pluginId: string;
  providerId: string;
  hostId: string;
  cwd: string | null;
}): string {
  return JSON.stringify([
    args.pluginId,
    args.providerId,
    args.hostId,
    args.cwd ?? "",
  ]);
}

interface ResolveNativeRootsArgs {
  registration: ProviderRegistration;
  hostId: string;
  cwd: string | null;
  /** The plugin call's budget: what the listing has left for this step. */
  timeoutMs: number;
}

async function callResolveNativeRoots(
  deps: ProviderNativeRootsDeps,
  args: ResolveNativeRootsArgs,
): Promise<ProviderResolvedNativeRoots> {
  const { registration } = args;
  const pluginId = registration.pluginId;
  const providerId = registration.info.id;
  const fields = { pluginId, providerId, hostId: args.hostId, cwd: args.cwd };
  const artifact = deps.pluginHostArtifacts.get(pluginId);
  if (artifact === undefined) {
    deps.logger.warn(
      fields,
      `Plugin "${pluginId}" resolves native roots for provider "${providerId}" but has no live bb.host artifact; listing its declared roots only`,
    );
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  }
  try {
    // The transport validates the answer against the contract's output
    // schema; this parse is where the typed value is claimed.
    return providerResolvedNativeRootsSchema.parse(
      await callPluginHostRpc(deps, {
        pluginId,
        contract: experimental_nativeRootsHostContract,
        method: "resolveNativeRoots",
        input: { providerId, cwd: args.cwd },
        hostId: args.hostId,
        timeoutMs: args.timeoutMs,
        artifact,
      }),
    );
  } catch (error) {
    deps.logger.warn(
      { ...fields, err: error },
      `Plugin "${pluginId}" failed to resolve native roots for provider "${providerId}"; listing its declared roots only`,
    );
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  }
}

/**
 * The plugin-resolved roots for one provider on one host and workspace,
 * cached per (plugin, provider, host, cwd). Empty when the registration does
 * not resolve roots.
 */
export async function resolveProviderResolvedNativeRoots(
  deps: ProviderNativeRootsDeps,
  args: ResolveNativeRootsArgs,
): Promise<ProviderResolvedNativeRoots> {
  const { registration } = args;
  if (!registration.resolvesNativeRoots) {
    return EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
  }
  const pluginId = registration.pluginId;
  const key = cacheKey({
    pluginId,
    providerId: registration.info.id,
    hostId: args.hostId,
    cwd: args.cwd,
  });
  const registrationRevision =
    deps.providerRegistry.getRegistrationRevision();
  const cached = deps.providerNativeRoots.lookup(key, registrationRevision);
  if (cached !== undefined) {
    return cached;
  }
  const value = callResolveNativeRoots(deps, args);
  deps.providerNativeRoots.store(key, {
    pluginId,
    registrationRevision,
    value,
  });
  return value;
}

/**
 * Everything `host.list_commands` / `host.list_skills` scans for this
 * provider: the declared skill and command roots straight from the
 * registration, and the plugin-resolved roots for this host and workspace.
 */
export async function resolveProviderNativeRootSet(
  deps: ProviderNativeRootsDeps,
  args: ResolveNativeRootsArgs,
): Promise<ProviderNativeRootSet> {
  const { registration } = args;
  const resolved = await resolveProviderResolvedNativeRoots(deps, args);
  return {
    skills: {
      user: [...registration.nativeSkillRoots.user],
      project: [...registration.nativeSkillRoots.project],
    },
    commands: {
      user: [...registration.nativeCommandRoots.user],
      project: [...registration.nativeCommandRoots.project],
    },
    resolved: {
      skills: [...resolved.skills],
      commands: [...resolved.commands],
    },
  };
}

type ProviderNativeRootScanType = "host.list_commands" | "host.list_skills";
type ProviderNativeRootScanResult<TType extends ProviderNativeRootScanType> =
  HostDaemonOnlineRpcResultForCommand<
    Extract<HostDaemonRetryableOnlineRpcCommand, { type: TType }>
  >;

interface ScanProviderNativeRootsArgs {
  registration: ProviderRegistration;
  hostId: string;
  cwd: string | null;
}

/**
 * Resolve this provider's native roots for one host and workspace and have
 * the daemon scan them: `host.list_commands` for the typeahead command list,
 * `host.list_skills` for the skill listing. The resolver call and the daemon
 * scan share one command timeout.
 */
export function scanProviderNativeRoots(
  deps: ProviderNativeRootsDeps,
  args: ScanProviderNativeRootsArgs & { type: "host.list_commands" },
): Promise<ProviderNativeRootScanResult<"host.list_commands">>;
export function scanProviderNativeRoots(
  deps: ProviderNativeRootsDeps,
  args: ScanProviderNativeRootsArgs & { type: "host.list_skills" },
): Promise<ProviderNativeRootScanResult<"host.list_skills">>;
export async function scanProviderNativeRoots(
  deps: ProviderNativeRootsDeps,
  args: ScanProviderNativeRootsArgs & { type: ProviderNativeRootScanType },
): Promise<ProviderNativeRootScanResult<ProviderNativeRootScanType>> {
  const budget = createProviderListingBudget();
  const nativeRoots = await resolveProviderNativeRootSet(deps, {
    registration: args.registration,
    hostId: args.hostId,
    cwd: args.cwd,
    timeoutMs: budget.remainingMs(),
  });
  const scan = {
    providerId: args.registration.info.id,
    cwd: args.cwd,
    nativeRoots,
  };
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: budget.remainingMs(),
    command:
      args.type === "host.list_commands"
        ? { type: "host.list_commands", ...scan }
        : { type: "host.list_skills", ...scan },
  });
}
