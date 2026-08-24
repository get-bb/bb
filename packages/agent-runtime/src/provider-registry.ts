/**
 * Provider registry.
 *
 * Builds the bridge-protocol adapter for a provider from its bridge launch.
 * Every provider runs on the one adapter; the only branch is which binary to
 * spawn.
 */

import {
  createBridgeProtocolAdapter,
  type BridgeProtocolAdapter,
} from "./bridge-protocol-adapter.js";
import { resolveBridgeWorkerProcessArgs } from "./shared/bridge-path.js";
import type { CreateBridgeAdapterOptions } from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * A plugin bridge's provider-scoped statics: the provider's own declared
 * bridge options (an ACP agent's launch spec rides there) plus the
 * environment-level extra write roots, which are a host-local fact the server
 * cannot supply at all.
 */
function buildPluginStaticProviderOptions(
  options: CreateBridgeAdapterOptions,
): { staticProviderOptions?: Record<string, unknown> } {
  const additionalWorkspaceWriteRoots = options.additionalWorkspaceWriteRoots;
  const staticProviderOptions = {
    ...options.bridgeLaunch.providerOptions,
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
 * server's `bridgeLaunch`, so there is one construction here and the binary
 * to spawn is always the plugin's hash-verified artifact, already cached on
 * this host. The runtime infers nothing from the provider id.
 */
export function createProviderForId(
  providerId: string,
  adapterOptions: CreateBridgeAdapterOptions,
): BridgeProtocolAdapter {
  const { bridgeLaunch } = adapterOptions;
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
        bridgeLaunch.source.artifactPath,
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
