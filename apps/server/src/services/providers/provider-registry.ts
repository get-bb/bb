/**
 * The provider registry: the single server-side source of provider metadata.
 *
 * Plugin declarations (bb.agents.experimental_registerProvider) are the ONLY
 * source. The core catalog seed is gone, so a provider exists exactly while
 * some enabled plugin declares it — disabling a provider plugin removes its
 * provider rather than degrading it to a core entry.
 *
 * The registry holds DECLARATIONS — static metadata a provider asserts about
 * itself (identity, branding, capabilities, composer actions). Availability
 * stays computed (host probes, plugin health), and session-behavior facts
 * stay in the bridge handshake; neither belongs here.
 */
import {
  ACP_TIER_CAPABILITIES,
  getAcpProviderServerCapabilities,
  isAcpProviderId,
} from "./acp-provider-tier.js";
import type {
  PermissionMode,
  ProviderFork,
  ProviderInfo,
  ReasoningLevel,
} from "@bb/domain";

/**
 * Backend-only provider facts, the server-side half of a declaration (the
 * client-facing half is `ProviderInfo`). Kept here rather than in a shared
 * package because only the registry and its policy accessors read it.
 */
export interface ProviderServerCapabilities {
  /**
   * Whether sessions get the Workflows feature (dynamic multi-agent
   * orchestration). The Workflow tool's own opt-in rules govern actual use.
   */
  supportsWorkflows: boolean;
  /**
   * The coarse, ordered per-provider reasoning ladder. Used as a fallback when
   * a precise per-model `supportedReasoningEfforts` set is unavailable.
   */
  reasoningLevels: readonly ReasoningLevel[];
  /**
   * The declared fork ladder, unprojected. `ProviderInfo` carries the two
   * booleans clients gate on; the daemon needs the ladder itself, because the
   * bridge handshake narrows against it.
   */
  fork: ProviderFork;
  /**
   * Whether BB can explicitly request context compaction. Backend-only: it
   * gates a server-composed builtin `/compact` prompt, and no client reads it.
   */
  supportsManualCompaction: boolean;
}

/**
 * Listing order is product policy, so the server states it instead of
 * inheriting it from plugin load order (which is alphabetical by plugin id
 * and, worse, moves a provider to the end when it is disabled and re-enabled).
 * Ids named here lead, in this order; everything else follows by registration.
 * The first entry is also the product default provider.
 */
export const PRODUCT_PROVIDER_ORDER: readonly string[] = [
  "codex",
  "claude-code",
  "pi",
  "acp-cursor",
];

export type ProviderRegistrationSource = { kind: "plugin"; pluginId: string };

/**
 * First-party provider ids, each reserved to the official plugin that owns it.
 *
 * These ids are not just names. `pi` is executed by the bridge inside the
 * daemon bundle no matter who declares it, so a third-party plugin claiming
 * that id would supply the metadata for somebody else's implementation; the
 * others are the ids threads, defaults, and product ordering are written
 * against. Reservation holds even while the owning plugin is disabled —
 * otherwise disabling Codex would open "codex" for anyone to claim, and
 * re-enabling it would fail.
 */
const RESERVED_PROVIDER_ID_OWNERS: Readonly<Record<string, string>> = {
  codex: "provider-codex",
  "claude-code": "provider-claude-code",
  pi: "provider-pi",
};

/** The plugin that owns the whole `acp-*` tier, ids included. */
const ACP_TIER_OWNER_PLUGIN_ID = "provider-acp";

/**
 * Why this plugin may not claim this provider id, or null when it may. The
 * live-collision check is separate: this one answers for ids no plugin has
 * registered (yet, or right now).
 */
export function reservedProviderIdProblem(args: {
  pluginId: string;
  providerId: string;
}): string | null {
  const owner = isAcpProviderId(args.providerId)
    ? ACP_TIER_OWNER_PLUGIN_ID
    : RESERVED_PROVIDER_ID_OWNERS[args.providerId];
  if (owner === undefined || owner === args.pluginId) {
    return null;
  }
  return `Provider "${args.providerId}" is reserved for the "${owner}" plugin${
    isAcpProviderId(args.providerId)
      ? ' (the "acp-" prefix names bb\'s ACP tier)'
      : ""
  }.`;
}

export interface ProviderRegistration {
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
  source: ProviderRegistrationSource;
  /**
   * Immutable byte snapshot of the declared provider icon, read from the
   * plugin root at registration time and served by the provider-logo route.
   * Present only for plugin-sourced entries whose declaration has an icon
   * that resolved to a readable file with a supported extension.
   */
  icon?: { bytes: Uint8Array; contentType: string };
}

export interface ProviderRegistryService {
  /** Registered provider metadata in {@link PRODUCT_PROVIDER_ORDER}, then the rest by registration. */
  list(): ProviderRegistration[];
  get(providerId: string): ProviderRegistration | null;
  /**
   * Monotonic revision of the live registration set. Plugin lifecycle
   * notifications use it to distinguish provider changes from unrelated
   * plugin changes without broadcasting every intermediate reload step.
   */
  getRegistrationRevision(): number;
  /**
   * Policy accessors: one answer per question, covering registered providers
   * plus the dynamic ACP tier (acp-* ids resolved from launch specs are never
   * registered — they fall back to the shared ACP capability set, exactly as
   * the catalog helpers did). Null when the id belongs to no known provider.
   */
  getServerCapabilities(providerId: string): ProviderServerCapabilities | null;
  getSupportedPermissionModes(
    providerId: string,
  ): readonly PermissionMode[] | null;
  supportsFork(providerId: string): boolean;
  /**
   * Whether the provider can recreate a session at an earlier point, which is
   * what edit-past-message rewind needs. Fork is not enough: ACP clones whole
   * sessions tip-only.
   */
  supportsSessionRewind(providerId: string): boolean;
  /**
   * Whether BB can explicitly request context compaction — today by sending a
   * standalone builtin `/compact` prompt, which the provider's bridge maps to
   * its native compaction command. Registered providers answer from their
   * projected server capabilities; dynamic ACP ids are per-agent rather than
   * per-tier, so they answer from the resolved agent's own declaration via
   * {@link ProviderRegistryDeps.resolveAcpAgentCapabilities}.
   */
  supportsManualCompaction(providerId: string): boolean;
  /**
   * Adds a plugin-registered provider. Rejects id collisions with any live
   * registration — a plugin cannot shadow another plugin's provider — and
   * first-party ids claimed by a plugin that does not own them
   * ({@link reservedProviderIdProblem}). The
   * disposer removes the registration (plugin reload/disable), which really
   * does remove the provider: with no seed underneath, a disabled provider
   * plugin leaves no entry behind.
   */
  register(
    registration: Omit<ProviderRegistration, "source"> & { pluginId: string },
  ): { dispose(): void };
  /**
   * Resolves as soon as the requested provider's plugin has registered, or
   * when plugin startup settles without it. Dynamic `acp-*` ids share the ACP
   * tier registration, since those per-agent ids are resolved from config and
   * are never registered individually.
   *
   * Use this for a request already scoped to one provider. Full provider
   * listings still use {@link whenRegistrationsSettled} so their roster is
   * complete rather than reflecting a partially loaded plugin set.
   */
  whenProviderRegistered(providerId: string): Promise<void>;
  /**
   * Resolves once provider registrations have settled — that is, once plugin
   * startup finished (or failed). Providers exist only while their plugin is
   * loaded, and the HTTP listener deliberately starts serving before plugins
   * load, so anything that routes work by provider must wait for this: on that
   * boot window the registry is still empty and an unscoped request would
   * fail with "no provider available". Picker/model requests already scoped
   * to a provider use {@link whenProviderRegistered} so unrelated plugins do
   * not hold them behind this full-startup gate.
   *
   * Bounded by {@link REGISTRATIONS_SETTLED_TIMEOUT_MS} so a stuck plugin
   * cannot wedge requests, and so a plugin's own loopback SDK call during
   * startup cannot deadlock against its load.
   */
  whenRegistrationsSettled(): Promise<void>;
  /** Called once by the server after plugin startup settles. */
  markRegistrationsSettled(): void;
}

/**
 * A boot-time turn waits this long for plugins at most; past it the request
 * proceeds against whatever registered, which is the pre-gate behavior.
 */
export const REGISTRATIONS_SETTLED_TIMEOUT_MS = 30_000;

/**
 * The dynamic ACP tier is resolved from config at request time, so the
 * registry cannot hold those declarations. It takes a resolver instead; an
 * omitted resolver answers "no ACP agent declares anything", which is what
 * tests and pre-config construction want.
 */
export interface ProviderRegistryDeps {
  resolveAcpAgentCapabilities?: (
    providerId: string,
  ) => { supportsManualCompaction: boolean } | null;
  /**
   * Defaults to settled: only the real server defers, because only there do
   * registrations arrive asynchronously from plugin startup.
   */
  deferRegistrationsSettled?: boolean;
}

export function createProviderRegistryService(
  deps: ProviderRegistryDeps = {},
): ProviderRegistryService {
  const pluginRegistrations = new Map<string, ProviderRegistration>();
  const providerRegistrationWaiters = new Map<string, Set<() => void>>();
  let registrationRevision = 0;
  let settle: (() => void) | null = null;
  const settled: Promise<void> =
    deps.deferRegistrationsSettled === true
      ? new Promise<void>((resolve) => {
          settle = resolve;
        })
      : Promise.resolve();

  function getRegistration(providerId: string): ProviderRegistration | null {
    return pluginRegistrations.get(providerId) ?? null;
  }

  function registrationWaiterKey(providerId: string): string {
    return isAcpProviderId(providerId) ? ACP_TIER_OWNER_PLUGIN_ID : providerId;
  }

  function hasProviderRegistration(providerId: string): boolean {
    if (!isAcpProviderId(providerId)) {
      return pluginRegistrations.has(providerId);
    }
    for (const registeredProviderId of pluginRegistrations.keys()) {
      if (isAcpProviderId(registeredProviderId)) {
        return true;
      }
    }
    return false;
  }

  function releaseProviderRegistrationWaiters(providerId: string): void {
    const key = registrationWaiterKey(providerId);
    const waiters = providerRegistrationWaiters.get(key);
    if (waiters === undefined) return;
    providerRegistrationWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }

  function releaseAllProviderRegistrationWaiters(): void {
    for (const waiters of providerRegistrationWaiters.values()) {
      for (const resolve of waiters) resolve();
    }
    providerRegistrationWaiters.clear();
  }

  async function waitUntilSettledOrTimeout(
    readiness: Promise<void>,
  ): Promise<void> {
    if (settle === null) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      readiness,
      settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, REGISTRATIONS_SETTLED_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  return {
    list() {
      const entries = [...pluginRegistrations.values()];
      const rank = (entry: ProviderRegistration): number => {
        const index = PRODUCT_PROVIDER_ORDER.indexOf(entry.info.id);
        return index === -1 ? PRODUCT_PROVIDER_ORDER.length : index;
      };
      // Stable sort keeps registration order within the unranked tail.
      return entries.sort((a, b) => rank(a) - rank(b));
    },

    get(providerId) {
      return getRegistration(providerId);
    },

    getRegistrationRevision() {
      return registrationRevision;
    },

    getServerCapabilities(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.serverCapabilities;
      }
      if (isAcpProviderId(providerId)) {
        return getAcpProviderServerCapabilities(providerId);
      }
      return null;
    },

    getSupportedPermissionModes(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.permissionModes;
      }
      if (isAcpProviderId(providerId)) {
        return ACP_TIER_CAPABILITIES.permissionModes;
      }
      return null;
    },

    supportsFork(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.supportsFork;
      }
      if (isAcpProviderId(providerId)) {
        return ACP_TIER_CAPABILITIES.supportsFork;
      }
      return false;
    },

    supportsSessionRewind(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.supportsSessionRewind;
      }
      if (isAcpProviderId(providerId)) {
        return ACP_TIER_CAPABILITIES.supportsSessionRewind;
      }
      return false;
    },

    supportsManualCompaction(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.serverCapabilities.supportsManualCompaction;
      }
      if (isAcpProviderId(providerId)) {
        return (
          deps.resolveAcpAgentCapabilities?.(providerId)
            ?.supportsManualCompaction ?? false
        );
      }
      return false;
    },

    register(registration) {
      const providerId = registration.info.id;
      const reserved = reservedProviderIdProblem({
        pluginId: registration.pluginId,
        providerId,
      });
      if (reserved !== null) {
        throw new Error(reserved);
      }
      if (pluginRegistrations.has(providerId)) {
        throw new Error(
          `Provider "${providerId}" is already registered; a plugin cannot shadow an existing provider.`,
        );
      }
      const entry: ProviderRegistration = {
        info: registration.info,
        serverCapabilities: registration.serverCapabilities,
        source: { kind: "plugin", pluginId: registration.pluginId },
        ...(registration.icon === undefined ? {} : { icon: registration.icon }),
      };
      pluginRegistrations.set(providerId, entry);
      registrationRevision += 1;
      releaseProviderRegistrationWaiters(providerId);
      return {
        dispose() {
          if (pluginRegistrations.get(providerId) === entry) {
            pluginRegistrations.delete(providerId);
            registrationRevision += 1;
          }
        },
      };
    },

    async whenProviderRegistered(providerId) {
      if (hasProviderRegistration(providerId) || settle === null) {
        return;
      }
      const key = registrationWaiterKey(providerId);
      let release!: () => void;
      const registered = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiters = providerRegistrationWaiters.get(key) ?? new Set();
      waiters.add(release);
      providerRegistrationWaiters.set(key, waiters);
      try {
        await waitUntilSettledOrTimeout(registered);
      } finally {
        const currentWaiters = providerRegistrationWaiters.get(key);
        currentWaiters?.delete(release);
        if (currentWaiters?.size === 0) {
          providerRegistrationWaiters.delete(key);
        }
      }
    },

    async whenRegistrationsSettled() {
      await waitUntilSettledOrTimeout(settled);
    },

    markRegistrationsSettled() {
      settle?.();
      settle = null;
      releaseAllProviderRegistrationWaiters();
    },
  };
}
