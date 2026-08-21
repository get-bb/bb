/**
 * Provider registry.
 *
 * Builds the bridge-protocol adapter for a provider from its bridge launch.
 * Every provider runs on the one adapter; the only branch is which binary to
 * spawn.
 */

import { DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS } from "@bb/host-daemon-contract";
import {
  createBridgeProtocolAdapter,
  type BridgeProtocolAdapter,
} from "./bridge-protocol-adapter.js";
import {
  resolveBridgeWorkerProcessArgs,
  resolveBundledBridgeModulePath,
} from "./shared/bridge-path.js";
import type { CreateBridgeAdapterOptions } from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

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
  options: CreateBridgeAdapterOptions,
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
  options: CreateBridgeAdapterOptions,
): { staticProviderOptions?: Record<string, unknown> } {
  const additionalWorkspaceWriteRoots = options.additionalWorkspaceWriteRoots;
  const acpLaunchSpec = options.acpLaunchSpec;
  const staticProviderOptions = {
    ...options.bridgeLaunch?.providerOptions,
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
 * Canonical path: providers run on the generic adapter speaking the canonical
 * Provider Bridge Protocol.
 *
 * Every provider is graduated, and every bridge-bound command carries the
 * server's `bridgeLaunch`, so there is one construction here and the only
 * branch is which binary to spawn: a hash-verified plugin artifact already
 * cached on this host, or a bridge inside the daemon's own bundle. The runtime
 * no longer infers that from the provider id.
 */
export function createProviderForId(
  providerId: string,
  options?: CreateBridgeAdapterOptions,
): BridgeProtocolAdapter {
  const adapterOptions: CreateBridgeAdapterOptions = options ?? {
    additionalWorkspaceWriteRoots: [],
  };
  const bridgeLaunch = adapterOptions.bridgeLaunch;
  if (bridgeLaunch === undefined) {
    // Every bridge-bound command carries a `bridgeLaunch`, and the server
    // refuses to build one without it.
    throw new Error(
      `Unsupported provider "${providerId}": no provider bridge launch was supplied.`,
    );
  }
  return createBridgeProtocolAdapter({
    id: providerId,
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
      command: adapterOptions.bridgeNodeExecutablePath ?? "node",
      // Never the bridge module directly: the bootstrap owns the process
      // boundary (plugin-scoped directories, stdin framing, signals) and
      // imports the bridge's exported surface out of the artifact.
      args: [
        ...resolveBridgeWorkerProcessArgs({
          ...(adapterOptions.bridgeBundleDir === undefined
            ? {}
            : { bridgeBundleDir: adapterOptions.bridgeBundleDir }),
        }),
        bridgeLaunch.source.kind === "artifact"
          ? bridgeLaunch.source.artifactPath
          : resolveBundledBridgeModule(bridgeLaunch.source.id, adapterOptions),
        bridgeLaunch.pluginId,
        bridgeLaunch.dataDir,
      ],
      env: {
        // The declared passthrough: the runtime strips every inherited
        // `BB_*` variable from provider processes, so a bridge that honors an
        // operator override names it and gets exactly that forwarded.
        ...pickDeclaredEnv(process.env, bridgeLaunch.envPassthrough),
        ...adapterOptions.bridgeNodeEnv,
      },
    },
    ...buildPluginStaticProviderOptions(adapterOptions),
  });
}

function pickDeclaredEnv(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") picked[name] = value;
  }
  return picked;
}
