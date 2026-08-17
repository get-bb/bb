/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and the canonical
 * bridge routing every provider now uses. No legacy adapter factories remain.
 */

import {
  getBundledProvider,
  isBundledProviderId,
  listBundledProviderIds,
  listBundledProviderInfos,
  type BundledProvider,
} from "./provider-catalog.js";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import { resolveBridgeProcessArgs } from "./shared/bridge-path.js";
import { BUILT_IN_ACP_LAUNCH_SPECS } from "./acp-launch-specs.js";
import type {
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Canonical path: providers run on the generic adapter speaking the canonical
 * Provider Bridge Protocol.
 *
 * Every provider is graduated: no legacy adapter remains, so every id routes
 * here unconditionally. Pi is the only bridge still delivered in the daemon
 * bundle; every other provider arrives as a hash-verified plugin artifact.
 */
function createBridgeProtocolAdapterForId(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter | null {
  // A hash-verified plugin artifact is its own routing authority: the server
  // only attaches a bridgeLaunch to commands for providers it has routed onto
  // the bridge protocol, and the daemon has already verified the artifact
  // bytes. It is matched before the bundled first-party bridge so a plugin
  // provider can never be shadowed by its id.
  if (options.bridgeLaunch !== undefined && !isBundledProviderId(providerId)) {
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: providerId,
      // The provider's real declaration lives server-side; the launch spec
      // transports its validated execution capabilities (the server accepted
      // these before routing the command). Session-behavior facts arrive via
      // the initialize handshake, which may only narrow.
      capabilities: {
        supportsArchive: options.bridgeLaunch.capabilities.supportsArchive,
        supportsRename: options.bridgeLaunch.capabilities.supportsRename,
        supportsServiceTier:
          options.bridgeLaunch.capabilities.supportsServiceTier,
        // A session-behavior fact the runtime never enforces: the bridge
        // answers for it per session (thread/identity).
        supportsUserQuestion: false,
        fork: options.bridgeLaunch.capabilities.fork,
        supportedPermissionModes: [
          ...options.bridgeLaunch.capabilities.supportedPermissionModes,
        ],
      },
      process: {
        command: options.bridgeNodeExecutablePath ?? "node",
        args: [options.bridgeLaunch.artifactPath],
        ...(options.bridgeNodeEnv !== undefined
          ? { env: options.bridgeNodeEnv }
          : {}),
      },
      ...buildPluginStaticProviderOptions(providerId, options),
    });
  }
  if (providerId === "pi") {
    const bundled = requireBundledProvider("pi");
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: bundled.displayName,
      capabilities: bundled.capabilities,
      process: {
        command: options.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: options.bridgeBundleDir,
          bundleFileName: "bb-pi-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "pi/bridge/bridge.js",
        }),
        ...(options.bridgeNodeEnv !== undefined
          ? { env: options.bridgeNodeEnv }
          : {}),
      },
    });
  }
  return null;
}

/**
 * A plugin bridge's provider-scoped statics: its own declared option bag, the
 * environment-level extra write roots, and — for the ACP tier — the launch
 * spec the bridge constructs its agent from. None of the three has a core
 * field on the canonical wire, and the write roots are a host-local fact the
 * server cannot supply at all.
 */
function buildPluginStaticProviderOptions(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): { staticProviderOptions?: Record<string, unknown> } {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const acpLaunchSpec = resolveAcpLaunchSpec(providerId, options);
  const staticProviderOptions = {
    ...(options.bridgeLaunch?.providerOptions ?? {}),
    ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
    ...(additionalWorkspaceWriteRoots.length > 0
      ? { additionalWorkspaceWriteRoots: [...additionalWorkspaceWriteRoots] }
      : {}),
  };
  return Object.keys(staticProviderOptions).length > 0
    ? { staticProviderOptions }
    : {};
}

/**
 * The launch spec the ACP bridge constructs the agent from. Configured and
 * known agents arrive with one on the command; bb's own bundled ACP providers
 * have no server-side entry, so their spec comes from the built-in table.
 */
function resolveAcpLaunchSpec(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): HostDaemonAcpLaunchSpec | undefined {
  return options.acpLaunchSpec ?? BUILT_IN_ACP_LAUNCH_SPECS[providerId];
}

function requireBundledProvider(providerId: string): BundledProvider {
  const bundled = getBundledProvider(providerId);
  if (bundled === null) {
    throw new Error(`"${providerId}" has no bundled provider baseline.`);
  }
  return bundled;
}

export function createProviderForId(
  providerId: string,
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  const bridgeProtocolAdapter = createBridgeProtocolAdapterForId(
    providerId,
    options ?? { additionalWorkspaceWriteRoots: [] },
  );
  if (bridgeProtocolAdapter !== null) {
    return bridgeProtocolAdapter;
  }

  throw new Error(
    `Unsupported provider "${providerId}". Available providers: ${listBundledProviderIds().join(", ")}.`,
  );
}

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  return listBundledProviderInfos();
}
