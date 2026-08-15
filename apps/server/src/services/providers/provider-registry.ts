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
  buildAcpProviderInfo,
  getAcpProviderServerCapabilities,
  isAcpProviderId,
} from "./acp-provider-tier.js";
import type { PermissionMode, ProviderInfo, ReasoningLevel } from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

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
   * Whether this provider backs host-daemon-routed AI services (voice
   * transcription and structured inference) via its `*.voice.transcribe` /
   * `*.inference.complete` daemon commands.
   */
  backsHostDaemonAiServices: boolean;
  /**
   * The coarse, ordered per-provider reasoning ladder. Used as a fallback when
   * a precise per-model `supportedReasoningEfforts` set is unavailable.
   */
  reasoningLevels: readonly ReasoningLevel[];
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

export interface ProviderRegistration {
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
  source: ProviderRegistrationSource;
  /**
   * The plugin's full declaration. Retained so declared facts without a
   * registry consumer yet (`kind`, `bridge`, `supportsNativeSessionRewind`)
   * are not dropped by the info/serverCapabilities mapping;
   * `supportsManualCompaction` is read from it by the compaction accessor.
   */
  declaration?: PluginProviderDeclaration;
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
   * Policy accessors: one answer per question, covering registered providers
   * plus the dynamic ACP tier (acp-* ids resolved from launch specs are never
   * registered — they fall back to the shared ACP capability set, exactly as
   * the catalog helpers did). Null when the id belongs to no known provider.
   */
  getServerCapabilities(providerId: string): ProviderServerCapabilities | null;
  getSupportedPermissionModes(
    providerId: string,
  ): readonly PermissionMode[] | null;
  supportsNativeFork(providerId: string): boolean;
  /**
   * Whether BB can explicitly request context compaction (the canonical
   * `thread/compact` bridge method). Registered providers answer from their
   * plugin declaration; dynamic ACP ids answer from the resolved agent's own
   * declaration via {@link ProviderRegistryDeps.resolveAcpAgentCapabilities}.
   */
  supportsManualCompaction(providerId: string): boolean;
  /**
   * Adds a plugin-registered provider. Rejects id collisions with any live
   * registration — a plugin cannot shadow another plugin's provider. The
   * disposer removes the registration (plugin reload/disable), which really
   * does remove the provider: with no seed underneath, a disabled provider
   * plugin leaves no entry behind.
   */
  register(
    registration: Omit<ProviderRegistration, "source"> & { pluginId: string },
  ): { dispose(): void };
}

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
}

export function createProviderRegistryService(
  deps: ProviderRegistryDeps = {},
): ProviderRegistryService {
  const pluginRegistrations = new Map<string, ProviderRegistration>();

  function getRegistration(providerId: string): ProviderRegistration | null {
    return pluginRegistrations.get(providerId) ?? null;
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
        return registration.info.capabilities.supportedPermissionModes;
      }
      if (isAcpProviderId(providerId)) {
        return buildAcpProviderInfo({
          id: providerId,
          displayName: providerId,
          logoUrl: null,
        }).capabilities.supportedPermissionModes;
      }
      return null;
    },

    supportsNativeFork(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return registration.info.capabilities.supportsFork;
      }
      if (isAcpProviderId(providerId)) {
        return buildAcpProviderInfo({
          id: providerId,
          displayName: providerId,
          logoUrl: null,
        }).capabilities.supportsFork;
      }
      return false;
    },

    supportsManualCompaction(providerId) {
      const registration = getRegistration(providerId);
      if (registration) {
        return (
          registration.declaration?.capabilities.supportsManualCompaction ??
          false
        );
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
      if (pluginRegistrations.has(providerId)) {
        throw new Error(
          `Provider "${providerId}" is already registered; a plugin cannot shadow an existing provider.`,
        );
      }
      const entry: ProviderRegistration = {
        info: registration.info,
        serverCapabilities: registration.serverCapabilities,
        source: { kind: "plugin", pluginId: registration.pluginId },
        ...(registration.declaration === undefined
          ? {}
          : { declaration: registration.declaration }),
        ...(registration.icon === undefined ? {} : { icon: registration.icon }),
      };
      pluginRegistrations.set(providerId, entry);
      return {
        dispose() {
          if (pluginRegistrations.get(providerId) === entry) {
            pluginRegistrations.delete(providerId);
          }
        },
      };
    },
  };
}
