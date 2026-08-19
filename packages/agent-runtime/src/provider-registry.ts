/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and the canonical
 * bridge routing every provider now uses. No legacy adapter factories remain.
 */

import {
  DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import {
  resolveBridgeWorkerProcessArgs,
  resolveBundledBridgeModulePath,
} from "./shared/bridge-path.js";
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
 * Every provider is graduated, and every bridge-bound command carries the
 * server's `bridgeLaunch`, so there is one construction here and the only
 * branch is which binary to spawn: a hash-verified plugin artifact already
 * cached on this host, or a bridge inside the daemon's own bundle. The runtime
 * no longer infers that from the provider id.
 */
function createBridgeProtocolAdapterForId(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter | null {
  const bridgeLaunch = options.bridgeLaunch;
  if (bridgeLaunch === undefined) {
    return null;
  }
  return createBridgeProtocolAdapter({
    id: providerId,
    displayName: providerId,
    // The provider's real declaration lives server-side; the launch spec
    // transports its validated execution capabilities (the server accepted
    // these before routing the command). Session-behavior facts arrive via
    // the initialize handshake, which may only narrow.
    capabilities: {
      ...bridgeLaunch.capabilities,
      permissionModes: [...bridgeLaunch.capabilities.permissionModes],
      // A session-behavior fact the runtime never enforces, so the wire does
      // not carry it: the bridge answers per session (thread/identity).
      supportsNativeUserQuestion: false,
    },
    process: {
      command: options.bridgeNodeExecutablePath ?? "node",
      // Never the bridge module directly: the bootstrap owns the process
      // boundary (plugin-scoped directories, stdin framing, signals) and
      // imports the bridge's exported surface out of the artifact.
      args: [
        ...resolveBridgeWorkerProcessArgs({
          ...(options.bridgeBundleDir === undefined
            ? {}
            : { bridgeBundleDir: options.bridgeBundleDir }),
        }),
        bridgeLaunch.source.kind === "artifact"
          ? bridgeLaunch.source.artifactPath
          : resolveBundledBridgeModule(bridgeLaunch.source.id, options),
        bridgeLaunch.pluginId,
        bridgeLaunch.dataDir,
      ],
      ...(options.bridgeNodeEnv !== undefined
        ? { env: options.bridgeNodeEnv }
        : {}),
    },
    ...(options.textDeltaFlushMs === undefined
      ? {}
      : { textDeltaFlushMs: options.textDeltaFlushMs }),
    ...buildPluginStaticProviderOptions(providerId, options),
  });
}

/**
 * Where each daemon-bundled bridge's entry lives, both in a packaged daemon
 * (`bridgeBundleDir`) and when running from source. Only Pi is bundled: its
 * agent tree cannot be inlined into a relocatable artifact.
 */
const DAEMON_BUNDLED_BRIDGE_ENTRIES: Readonly<
  Record<string, { bundleFileName: string; bridgeRelativePath: string }>
> = {
  pi: {
    bundleFileName: "bb-pi-bridge.mjs",
    bridgeRelativePath: "pi/bridge/bridge.js",
  },
};

// The contract states which ids are daemon-bundled (the server sends
// `source: {kind: "daemon-bundled", id}` only for those, and accepts their
// declarations without an artifact); this table states where each of those
// bridges actually lives. Any drift between the two is a bug.
for (const bundledBridgeId of DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS) {
  if (!Object.hasOwn(DAEMON_BUNDLED_BRIDGE_ENTRIES, bundledBridgeId)) {
    throw new Error(
      `"${bundledBridgeId}" is declared daemon-bundled but this daemon ships no bridge entry for it.`,
    );
  }
}

function resolveBundledBridgeModule(
  bundledBridgeId: string,
  options: ProviderAdapterFactoryOptions,
): string {
  const entry = DAEMON_BUNDLED_BRIDGE_ENTRIES[bundledBridgeId];
  if (entry === undefined) {
    throw new Error(
      `"${bundledBridgeId}" is not a bridge this daemon bundles. Bundled: ${Object.keys(DAEMON_BUNDLED_BRIDGE_ENTRIES).join(", ")}.`,
    );
  }
  return resolveBundledBridgeModulePath({
    ...(options.bridgeBundleDir === undefined
      ? {}
      : { bridgeBundleDir: options.bridgeBundleDir }),
    importMetaUrl: import.meta.url,
    ...entry,
  });
}

/**
 * A plugin bridge's provider-scoped statics: the environment-level extra write
 * roots and — for the ACP tier — the launch spec the bridge constructs its
 * agent from. Neither has a core field on the canonical wire, and the write
 * roots are a host-local fact the server cannot supply at all.
 */
function buildPluginStaticProviderOptions(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): { staticProviderOptions?: Record<string, unknown> } {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const acpLaunchSpec = resolveAcpLaunchSpec(providerId, options);
  const staticProviderOptions = {
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

  // Reachable only for a caller that resolved no bridge: every bridge-bound
  // command carries a `bridgeLaunch`, and the server refuses to build one
  // without it.
  throw new Error(
    `Unsupported provider "${providerId}": no provider bridge launch was supplied.`,
  );
}

