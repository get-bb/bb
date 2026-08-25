/**
 * The provider registry: the single server-side source of provider metadata.
 *
 * Plugin declarations (`bb.providers.register`) are the ONLY source. The
 * core catalog seed is gone, so a provider exists exactly while some enabled
 * plugin declares it — disabling a provider plugin removes its provider
 * rather than degrading it to a core entry.
 *
 * The registry holds DECLARATIONS — static metadata a provider asserts about
 * itself (identity, branding, capabilities, composer actions). Availability
 * stays computed (host probes, plugin health), and session-behavior facts
 * stay in the bridge handshake; neither belongs here.
 *
 * Ids are flat: the first live registration of an id wins and a later one
 * from another plugin is refused. No id is reserved ahead of time and no
 * core table ranks providers — listing order is plugin install order (the
 * bundled first-party plugins install first, in their bundled order) under
 * the user's own `providerOrder` setting, and the default provider is the
 * user's `defaultProviderId` setting or the first available entry.
 */
import type {
  ProviderNativeRoots,
  AvailableModel,
  ExtensionKind,
  JsonValue,
  PermissionMode,
  ProviderFork,
  ProviderInfo,
  ReasoningLevel,
} from "@bb/domain";
import { parseExtensionKind } from "@bb/domain";
import type {
  PluginProviderExtensionKindDeclaration,
  PluginProviderOptionsContext,
} from "@get-bb/plugin-sdk";
import { providerAlreadyRegisteredMessage } from "@get-bb/plugin-sdk/internal/host-policy";

/**
 * Backend-only provider facts, the server-side half of a declaration (the
 * client-facing half is `ProviderInfo`). Kept here rather than in a shared
 * package because only the registry and its policy accessors read it.
 */
export interface ProviderServerCapabilities {
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
 * Where a registration sits in plugin install order. Bundled first-party
 * plugins rank by their position in the bundled plugin list (they install
 * first, at bootstrap); every other plugin ranks by the time it was
 * installed. Ties keep registration sequence.
 */
export interface ProviderInstallRank {
  /** Position in the bundled plugin list, or null for a non-bundled plugin. */
  bundledIndex: number | null;
  /** Epoch ms the plugin row was installed. */
  installedAt: number;
}

/**
 * The payload validators a provider declared for its extension kinds, keyed
 * by the kind's local name (the namespaced kind is `"<pluginId>/<name>"`,
 * see `parseExtensionKind`). Server-only: the event ingest route validates
 * every `extension` item and `extension.state` payload against these before
 * persisting it, so clients never see a payload the plugin did not vouch
 * for. Schemas are code, so they live here rather than on `ProviderInfo`.
 */
export type ProviderExtensionKindSchemas = Readonly<
  Record<string, PluginProviderExtensionKindDeclaration>
>;

export interface ProviderRegistration {
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
  /** Opaque provider-owned statics forwarded to this registration's bridge. */
  bridgeOptions: Readonly<Record<string, JsonValue>>;
  extensionKinds: ProviderExtensionKindSchemas;
  visibility: "always" | "installed";
  /** The plugin that registered this provider; its bridge artifact runs it. */
  pluginId: string;
  /**
   * Declared cold-cache fallback models (`models.fallback`), in
   * the model-list wire shape. Offered only while no probe has completed or
   * when one fails transiently; the live `model/list` result always wins.
   */
  fallbackModels: readonly AvailableModel[];
  /**
   * Daemon environment variable names the bridge may read
   * (`env.passthrough`); the daemon forwards exactly these past
   * its `BB_*` spawn sanitization. Empty when the provider declared none.
   */
  envPassthrough: readonly string[];
  /**
   * Directories this provider's own agent reads skills from, relative to the
   * target host's home directory or to the workspace. Declared by the plugin;
   * core never guesses a provider's skill layout.
   */
  nativeSkillRoots: ProviderNativeRoots;
  /**
   * Directories the agent reads its own slash commands from, in the same
   * shape. Declared by the plugin; core never guesses a command layout.
   */
  nativeCommandRoots: ProviderNativeRoots;
  /**
   * The plugin's `bb.host` entry resolves more roots per host and workspace
   * (`resolveNativeRoots`); the listing asks it and scans the answer beside
   * the declared roots.
   */
  resolvesNativeRoots: boolean;
  /**
   * The plugin's per-command options hook, bound to this declaration and to
   * the plugin's own settings (read at call time) and validated (bounded
   * plain JSON). The result rides the command as `providerOptions`, opaque to
   * core. Throws with the plugin named when the hook throws or returns
   * non-JSON.
   */
  deriveProviderOptions: (
    context: Omit<PluginProviderOptionsContext, "settings">,
  ) => Readonly<Record<string, JsonValue>>;
  /**
   * Immutable byte snapshot of the declared provider icon, read from the
   * plugin root at registration time and served by the provider-logo route.
   * Present only for plugin-sourced entries whose declaration has an icon
   * that resolved to a readable file with a supported extension, or names
   * one of the plugin's declared icons (`"<pluginId>/<name>"`).
   */
  icon?: { bytes: Uint8Array; contentType: string };
  /**
   * The names the owning plugin declares under
   * `bb.branding.experimental_icons`, the set a namespaced presentation glyph
   * (`"<pluginId>/<name>"`) on this provider's rows must name. Read at ingest
   * (`internal/presentation-icons.ts`); a plugin that declares none has an
   * empty set, so every namespaced glyph it emits is rejected.
   */
  iconNames: ReadonlySet<string>;
}

export interface ProviderRegistryService {
  /**
   * Registered provider metadata: ids the user pinned in `providerOrder`
   * lead in that order, then the rest by plugin install order.
   */
  list(): ProviderRegistration[];
  /**
   * The id the user chose as default, or null when they chose none or the
   * choice names a provider that is not registered — callers then fall back
   * to the first available entry of {@link list}.
   */
  getUserDefaultProviderId(): string | null;
  get(providerId: string): ProviderRegistration | null;
  /**
   * Monotonic revision of the live registration set. Plugin lifecycle
   * notifications use it to distinguish provider changes from unrelated
   * plugin changes without broadcasting every intermediate reload step.
   */
  getRegistrationRevision(): number;
  /**
   * Policy accessors: one answer per question, from the provider's own
   * registration. Null when the id belongs to no registered provider.
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
   * its native compaction command. Answered from the provider's own
   * projected server capabilities.
   */
  supportsManualCompaction(providerId: string): boolean;
  /**
   * The declared validators for one namespaced extension kind, found through
   * the kind's plugin-id prefix (a plugin's providers share one namespace).
   * Null when no live registration from that plugin declares the name — an
   * undeclared kind is rejected at ingest exactly like a failing payload.
   */
  getExtensionKindSchemas(
    kind: ExtensionKind,
  ): PluginProviderExtensionKindDeclaration | null;
  /**
   * Adds a plugin-registered provider. Rejects id collisions with any live
   * registration — the first registration wins and a plugin cannot shadow
   * another plugin's provider. The disposer removes the registration (plugin
   * reload/disable), which really does remove the provider: with no seed
   * underneath, a disabled provider plugin leaves no entry behind.
   */
  register(
    registration: ProviderRegistration & {
      /** Omitted by tests that do not care about order: ranks last. */
      installRank?: ProviderInstallRank;
    },
  ): { dispose(): void };
  /**
   * Resolves as soon as the requested provider's plugin has registered, or
   * when plugin startup settles without it.
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
const REGISTRATIONS_SETTLED_TIMEOUT_MS = 30_000;

interface ProviderRegistryDeps {
  /**
   * The user's picker order and default provider (app settings), read on
   * every listing so a settings change applies to the next request. Omitted
   * by tests and pre-config construction: install order, no pinned default.
   */
  readUserProviderPreferences?: () => {
    providerOrder: readonly string[];
    defaultProviderId: string | null;
  };
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
  const registrationRanks = new Map<
    ProviderRegistration,
    { installRank: ProviderInstallRank | null; sequence: number }
  >();
  const providerRegistrationWaiters = new Map<string, Set<() => void>>();
  let registrationRevision = 0;
  let registrationSequence = 0;

  function compareInstallRank(
    a: ProviderRegistration,
    b: ProviderRegistration,
  ): number {
    const rankA = registrationRanks.get(a);
    const rankB = registrationRanks.get(b);
    const installA = rankA?.installRank ?? null;
    const installB = rankB?.installRank ?? null;
    if (installA !== null || installB !== null) {
      if (installA === null) return 1;
      if (installB === null) return -1;
      const bundledA = installA.bundledIndex;
      const bundledB = installB.bundledIndex;
      if (bundledA !== null || bundledB !== null) {
        if (bundledA === null) return 1;
        if (bundledB === null) return -1;
        if (bundledA !== bundledB) return bundledA - bundledB;
      } else if (installA.installedAt !== installB.installedAt) {
        return installA.installedAt - installB.installedAt;
      }
    }
    return (rankA?.sequence ?? 0) - (rankB?.sequence ?? 0);
  }
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

  function hasProviderRegistration(providerId: string): boolean {
    return pluginRegistrations.has(providerId);
  }

  function releaseProviderRegistrationWaiters(providerId: string): void {
    const waiters = providerRegistrationWaiters.get(providerId);
    if (waiters === undefined) return;
    providerRegistrationWaiters.delete(providerId);
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
      const entries = [...pluginRegistrations.values()].sort(
        compareInstallRank,
      );
      const userOrder = deps.readUserProviderPreferences?.().providerOrder ?? [];
      if (userOrder.length === 0) {
        return entries;
      }
      const pinned = (entry: ProviderRegistration): number => {
        const index = userOrder.indexOf(entry.info.id);
        return index === -1 ? userOrder.length : index;
      };
      // Stable sort keeps install order within the unpinned tail.
      return entries.sort((a, b) => pinned(a) - pinned(b));
    },

    getUserDefaultProviderId() {
      const preferred =
        deps.readUserProviderPreferences?.().defaultProviderId ?? null;
      if (preferred === null || !pluginRegistrations.has(preferred)) {
        return null;
      }
      return preferred;
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
      return null;
    },

    getSupportedPermissionModes(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.permissionModes;
      }
      return null;
    },

    supportsFork(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.supportsFork;
      }
      return false;
    },

    supportsSessionRewind(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.supportsSessionRewind;
      }
      return false;
    },

    supportsManualCompaction(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.serverCapabilities.supportsManualCompaction;
      }
      return false;
    },

    getExtensionKindSchemas(kind) {
      const { pluginId, name } = parseExtensionKind(kind);
      for (const registration of pluginRegistrations.values()) {
        if (registration.pluginId !== pluginId) {
          continue;
        }
        const declared = registration.extensionKinds[name];
        if (declared !== undefined) {
          return declared;
        }
      }
      return null;
    },

    register(registration) {
      const providerId = registration.info.id;
      if (pluginRegistrations.has(providerId)) {
        throw new Error(providerAlreadyRegisteredMessage(providerId));
      }
      // Every field arrives filled: the declaration validator and the
      // registration builder are the one place defaults are decided.
      const { installRank, ...entry } = registration;
      pluginRegistrations.set(providerId, entry);
      registrationSequence += 1;
      registrationRanks.set(entry, {
        installRank: installRank ?? null,
        sequence: registrationSequence,
      });
      registrationRevision += 1;
      releaseProviderRegistrationWaiters(providerId);
      return {
        dispose() {
          if (pluginRegistrations.get(providerId) === entry) {
            pluginRegistrations.delete(providerId);
            registrationRanks.delete(entry);
            registrationRevision += 1;
          }
        },
      };
    },

    async whenProviderRegistered(providerId) {
      if (hasProviderRegistration(providerId) || settle === null) {
        return;
      }
      const key = providerId;
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
