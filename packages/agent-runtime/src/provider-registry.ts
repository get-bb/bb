/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and the canonical
 * bridge routing every provider now uses. No legacy adapter factories remain.
 */

import {
  buildAcpProviderInfo,
  getBundledProviderInfo,
  isAcpProviderId,
  isBundledProviderId,
  listBundledProviderIds,
  listBundledProviderInfos,
} from "./provider-catalog.js";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import { resolveBridgeProcessArgs } from "./shared/bridge-path.js";
import { BUILT_IN_ACP_LAUNCH_SPECS } from "./acp/launch-specs.js";
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
 * here unconditionally.
 *
 * The ACP launch spec travels opaquely via staticProviderOptions (claude-code
 * needs no launch spec — its provider-flavored knobs ride the per-command
 * providerOptions the generic adapter packs, and codex's static entry carries
 * the environment's extra write roots). Transitional wiring — phase 3
 * provider declarations replace this table.
 */
function createBridgeProtocolAdapterForId(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter | null {
  // A hash-verified plugin artifact is its own routing authority: the server
  // only attaches a bridgeLaunch to commands for providers it has routed onto
  // the bridge protocol, and the daemon has already verified the artifact
  // bytes. It is matched before the bundled first-party bridges so a plugin
  // provider can never be shadowed by one of their ids.
  const isBundledBridgeId =
    isBundledProviderId(providerId) || isAcpProviderId(providerId);
  if (options.bridgeLaunch !== undefined && !isBundledBridgeId) {
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: providerId,
      // The provider's real declaration lives server-side; the launch spec
      // transports its validated execution capabilities (the server accepted
      // these before routing the command). Session-behavior facts arrive via
      // the initialize handshake, which may only narrow.
      capabilities: {
        supportsArchive: false,
        supportsRename: false,
        supportsServiceTier:
          options.bridgeLaunch.capabilities.supportsServiceTier,
        supportsUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
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
      ...(options.bridgeLaunch.providerOptions !== undefined
        ? { staticProviderOptions: options.bridgeLaunch.providerOptions }
        : {}),
    });
  }
  if (isAcpProviderId(providerId)) {
    return createAcpBridgeAdapter(providerId, options);
  }
  if (providerId === "claude-code") {
    const info = requireBundledProviderInfo("claude-code");
    const additionalWorkspaceWriteRoots =
      options.additionalWorkspaceWriteRoots ?? [];
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: info.displayName,
      capabilities: info.capabilities,
      process: {
        command: options.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: options.bridgeBundleDir,
          bundleFileName: "bb-claude-code-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "claude-code/bridge/bridge.js",
        }),
        ...(options.bridgeNodeEnv !== undefined
          ? { env: options.bridgeNodeEnv }
          : {}),
      },
      // Same delivery as codex: the canonical wire has no core field for
      // environment-level extra write roots, so they ride the provider-scoped
      // options bag and reach session construction exactly as the legacy
      // adapter delivered them.
      ...(additionalWorkspaceWriteRoots.length > 0
        ? {
            staticProviderOptions: {
              additionalWorkspaceWriteRoots: [...additionalWorkspaceWriteRoots],
            },
          }
        : {}),
    });
  }
  if (providerId === "pi") {
    const info = requireBundledProviderInfo("pi");
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: info.displayName,
      capabilities: info.capabilities,
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
  if (providerId === "codex") {
    const info = requireBundledProviderInfo("codex");
    const additionalWorkspaceWriteRoots =
      options.additionalWorkspaceWriteRoots ?? [];
    return createBridgeProtocolAdapter({
      id: providerId,
      displayName: info.displayName,
      capabilities: info.capabilities,
      process: {
        command: options.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: options.bridgeBundleDir,
          bundleFileName: "bb-codex-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "codex/bridge/bridge.js",
        }),
        ...(options.bridgeNodeEnv !== undefined
          ? { env: options.bridgeNodeEnv }
          : {}),
      },
      // Environment-level extra write roots have no core field on the
      // canonical wire; they ride the codex bridge's provider-scoped options
      // bag (the acpLaunchSpec precedent) so workspace-write sandboxing keeps
      // the same roots the legacy adapter received at construction.
      ...(additionalWorkspaceWriteRoots.length > 0
        ? {
            staticProviderOptions: {
              additionalWorkspaceWriteRoots: [...additionalWorkspaceWriteRoots],
            },
          }
        : {}),
    });
  }
  return null;
}

function requireBundledProviderInfo(providerId: string): ProviderInfo {
  const info = getBundledProviderInfo(providerId);
  if (info === null) {
    throw new Error(`"${providerId}" has no bundled provider baseline.`);
  }
  return info;
}

function createAcpBridgeAdapter(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  const launchSpec = resolveAcpLaunchSpec(providerId, options);
  const info =
    getBundledProviderInfo(providerId) ??
    buildAcpProviderInfo({
      id: providerId,
      displayName: launchSpec?.displayName ?? providerId,
    });
  return createBridgeProtocolAdapter({
    id: providerId,
    displayName: info.displayName,
    capabilities: info.capabilities,
    process: {
      command: options.bridgeNodeExecutablePath ?? "node",
      args: resolveBridgeProcessArgs({
        bridgeBundleDir: options.bridgeBundleDir,
        bundleFileName: "bb-acp-bridge.mjs",
        importMetaUrl: import.meta.url,
        bridgeRelativePath: "acp/bridge/bridge.js",
      }),
      ...(options.bridgeNodeEnv !== undefined
        ? { env: options.bridgeNodeEnv }
        : {}),
    },
    ...buildAcpStaticProviderOptions(launchSpec, options),
  });
}

/**
 * The launch spec the ACP bridge constructs the agent from. Configured and
 * known agents arrive with one on the command; the bundled first-party ACP
 * providers have no server-side entry, so their spec comes from the built-in
 * table.
 */
function resolveAcpLaunchSpec(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): HostDaemonAcpLaunchSpec | undefined {
  return options.acpLaunchSpec ?? BUILT_IN_ACP_LAUNCH_SPECS[providerId];
}

/**
 * The ACP bridge's provider-scoped statics: the launch spec it constructs the
 * agent from, plus the environment-level extra write roots (no core canonical
 * field exists for either), so canonical sessions sandbox the same roots the
 * legacy adapter passed at construction.
 */
function buildAcpStaticProviderOptions(
  launchSpec: HostDaemonAcpLaunchSpec | undefined,
  options: ProviderAdapterFactoryOptions,
): { staticProviderOptions?: Record<string, unknown> } {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const staticProviderOptions = {
    ...(launchSpec !== undefined ? { acpLaunchSpec: launchSpec } : {}),
    ...(additionalWorkspaceWriteRoots.length > 0
      ? { additionalWorkspaceWriteRoots: [...additionalWorkspaceWriteRoots] }
      : {}),
  };
  return Object.keys(staticProviderOptions).length > 0
    ? { staticProviderOptions }
    : {};
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
