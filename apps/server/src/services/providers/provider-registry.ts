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
  getBuiltInAgentProviderServerCapabilities,
  listBuiltInAgentProviderInfos,
  type ProviderServerCapabilities,
} from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";

export type ProviderRegistrationSource =
  | { kind: "core" }
  | { kind: "plugin"; pluginId: string };

export interface ProviderRegistration {
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
  source: ProviderRegistrationSource;
}

export interface ProviderRegistryService {
  /** Registered provider metadata, stable order: core seed first, then plugins by registration. */
  list(): ProviderRegistration[];
  get(providerId: string): ProviderRegistration | null;
  /**
   * Adds a plugin-registered provider. Rejects id collisions with any live
   * registration — a plugin cannot shadow a core provider or another plugin.
   * The disposer removes the registration (plugin reload/disable path).
   */
  register(
    registration: Omit<ProviderRegistration, "source"> & {
      pluginId: string;
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

  return {
    list() {
      return [...coreSeed, ...pluginRegistrations.values()];
    },

    get(providerId) {
      const fromPlugin = pluginRegistrations.get(providerId);
      if (fromPlugin) {
        return fromPlugin;
      }
      return (
        coreSeed.find((entry) => entry.info.id === providerId) ?? null
      );
    },

    register(registration) {
      const providerId = registration.info.id;
      if (liveIds().has(providerId)) {
        throw new Error(
          `Provider "${providerId}" is already registered; a plugin cannot shadow an existing provider.`,
        );
      }
      const entry: ProviderRegistration = {
        info: registration.info,
        serverCapabilities: registration.serverCapabilities,
        source: { kind: "plugin", pluginId: registration.pluginId },
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
