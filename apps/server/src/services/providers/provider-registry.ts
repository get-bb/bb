/**
 * The provider registry: the single server-side source of provider metadata.
 *
 * Phase 3 of plans/agent-provider-plugin-surface.md. Today the registry is
 * seeded from the core catalog (@bb/agent-providers), so its resolved
 * provider set is provably identical to the catalog's — the equality test
 * pins that. Plugin-registered providers
 * (bb.agents.experimental_registerProvider) join the same store; when the
 * built-ins ship as first-party plugins the core seed disappears and the
 * catalog package with it.
 *
 * The registry holds DECLARATIONS — static metadata a provider asserts about
 * itself (identity, branding, capabilities, composer actions). Availability
 * stays computed (host probes, plugin health), and session-behavior facts
 * stay in the bridge handshake; neither belongs here.
 */
import {
  buildAcpProviderInfo,
  getAcpProviderServerCapabilities,
  getBuiltInAgentProviderServerCapabilities,
  isAcpProviderId,
  listBuiltInAgentProviderInfos,
  supportsManualCompaction as supportsCatalogManualCompaction,
  type ProviderServerCapabilities,
} from "@bb/agent-providers";
import type { PermissionMode, ProviderInfo } from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

export type ProviderRegistrationSource =
  | { kind: "core" }
  | { kind: "plugin"; pluginId: string };

export interface ProviderRegistration {
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
  source: ProviderRegistrationSource;
  /**
   * The plugin's full declaration — present only for plugin-sourced entries.
   * Retained so declared facts without a registry consumer yet (`kind`,
   * `bridge`, `supportsNativeSessionRewind`) are not dropped by the
   * info/serverCapabilities mapping; `supportsManualCompaction` is read from
   * it by the compaction accessor below.
   */
  declaration?: PluginProviderDeclaration;
}

export interface ProviderRegistryService {
  /** Registered provider metadata, stable order: core seed first, then plugins by registration. */
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
   * Whether BB can explicitly request context compaction. Plugin providers
   * answer from their declaration; every other id falls back to the catalog
   * helper, which keeps its acp-opencode quirk until the phase-6
   * capability + `thread/compact` protocol method replace the string list.
   */
  supportsManualCompaction(providerId: string): boolean;
  /**
   * Adds a plugin-registered provider. Rejects id collisions with any live
   * registration — a plugin cannot shadow a core provider or another plugin
   * — EXCEPT builtin first-party plugins (`takeover: true`), which replace
   * their core-seed entry in place: the picker position is preserved and the
   * seed entry is restored when the plugin is disabled, so disabling a
   * first-party provider plugin degrades to the core declaration rather
   * than deleting the provider outright while the core seed still exists.
   * (The seed itself is deleted at graduation; takeover then registers
   * fresh.) The disposer removes the registration (plugin reload/disable).
   */
  register(
    registration: Omit<ProviderRegistration, "source"> & {
      pluginId: string;
      takeover?: boolean;
    },
  ): { dispose(): void };
}

export function createProviderRegistryService(): ProviderRegistryService {
  const coreSeed: ProviderRegistration[] = listBuiltInAgentProviderInfos().map(
    (info) => ({
      info,
      serverCapabilities: getBuiltInAgentProviderServerCapabilities(info.id),
      source: { kind: "core" },
    }),
  );

  const pluginRegistrations = new Map<string, ProviderRegistration>();

  function liveIds(): Set<string> {
    const ids = new Set(coreSeed.map((entry) => entry.info.id));
    for (const id of pluginRegistrations.keys()) {
      ids.add(id);
    }
    return ids;
  }

  function getRegistration(providerId: string): ProviderRegistration | null {
    const fromPlugin = pluginRegistrations.get(providerId);
    if (fromPlugin) {
      return fromPlugin;
    }
    return coreSeed.find((entry) => entry.info.id === providerId) ?? null;
  }

  return {
    list() {
      return [...coreSeed, ...pluginRegistrations.values()];
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
      if (registration?.source.kind === "plugin") {
        return (
          registration.declaration?.capabilities.supportsManualCompaction ??
          false
        );
      }
      return supportsCatalogManualCompaction(providerId);
    },

    register(registration) {
      const providerId = registration.info.id;
      const seedIndex = coreSeed.findIndex(
        (entry) => entry.info.id === providerId,
      );
      if (registration.takeover === true && seedIndex !== -1) {
        const replaced = coreSeed[seedIndex] as ProviderRegistration;
        // Transitional merge: the plugin declaration has no slots for
        // session-behavior facts (archive/name sync live in the bridge
        // handshake; workflows moves to the claude plugin's own settings;
        // session restore is handshake-reported). Until each field's proper
        // consumer repoint ships, a takeover preserves the replaced entry's
        // values so flipping a first-party plugin on cannot regress the
        // flagship behaviors (codex archive mirroring, claude workflows).
        const entry: ProviderRegistration = {
          info: {
            ...registration.info,
            capabilities: {
              ...registration.info.capabilities,
              supportsArchive: replaced.info.capabilities.supportsArchive,
              supportsRename: replaced.info.capabilities.supportsRename,
            },
          },
          serverCapabilities: {
            ...registration.serverCapabilities,
            supportsWorkflows: replaced.serverCapabilities.supportsWorkflows,
            supportsSessionRestore:
              replaced.serverCapabilities.supportsSessionRestore,
          },
          ...(registration.declaration !== undefined
            ? { declaration: registration.declaration }
            : {}),
          source: { kind: "plugin", pluginId: registration.pluginId },
        };
        coreSeed[seedIndex] = entry;
        return {
          dispose() {
            const currentIndex = coreSeed.indexOf(entry);
            if (currentIndex !== -1) {
              coreSeed[currentIndex] = replaced;
            }
          },
        };
      }
      if (liveIds().has(providerId)) {
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
