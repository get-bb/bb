/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata, the canonical
 * bridge routing for graduated providers (ACP, pi), and the remaining legacy
 * adapter factories (codex, claude-code).
 */

import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import { resolveBridgeProcessArgs } from "./shared/bridge-path.js";
import { BUILT_IN_ACP_LAUNCH_SPECS } from "./acp/launch-specs.js";
import { createClaudeCodeProviderAdapter } from "./claude-code/adapter.js";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import type {
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

type ProviderFactory = (
  options: ProviderAdapterFactoryOptions,
) => ProviderAdapter;
interface BuiltInProviderDescriptor {
  createAdapter: ProviderFactory;
  info: ProviderInfo;
}

const builtInProviders = [
  {
    // Codex app-server events already carry Codex-owned turn ids; the
    // runtime-generated prefix is only for adapters that synthesize bb turn ids.
    createAdapter: (options) => createCodexProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("codex"),
  },
  {
    createAdapter: (options) => createClaudeCodeProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("claude-code"),
  },
] satisfies BuiltInProviderDescriptor[];

const builtInProvidersById = new Map(
  builtInProviders.map((descriptor) => [descriptor.info.id, descriptor]),
);

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Create a provider adapter by ID.
 *
 * Looks up built-in providers. Throws if the ID is not found.
 */
/**
 * Canonical path: providers run on the generic adapter speaking the canonical
 * Provider Bridge Protocol.
 *
 * ACP providers and pi are graduated — their legacy adapters are gone, so they
 * route canonically regardless of the experiment's prefix policy. claude-code
 * and codex still ship a legacy adapter, so an enabled bridge-protocol prefix
 * is what routes them here.
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
  // bytes. Gating it behind the prefix snapshot below made a freshly
  // installed plugin provider unusable in any runtime created before the
  // policy refresh (the snapshot is captured once per runtime). The prefix
  // policy remains the experiment gate for the bundled first-party bridges.
  const isBundledBridgeId =
    providerId === "codex" ||
    providerId === "claude-code" ||
    providerId === "pi" ||
    isAcpProviderId(providerId);
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
        supportsServiceTier: options.bridgeLaunch.capabilities.supportsServiceTier,
        supportsUserQuestion: false,
        supportsFork: false,
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
  // Graduated: the ACP and pi legacy adapters are deleted, so those providers
  // route canonically whether or not the experiment lists their prefix.
  if (isAcpProviderId(providerId)) {
    return createAcpBridgeAdapter(providerId, options);
  }
  if (providerId === "pi") {
    const info = getBuiltInAgentProviderInfo("pi");
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
  const prefixes = options.bridgeProtocolProviderPrefixes ?? [];
  if (!prefixes.some((prefix) => providerId.startsWith(prefix))) {
    return null;
  }
  if (providerId === "codex") {
    const info = getBuiltInAgentProviderInfo("codex");
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
  if (providerId === "claude-code") {
    const info = getBuiltInAgentProviderInfo("claude-code");
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
  return null;
}

function createAcpBridgeAdapter(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  const launchSpec = resolveAcpLaunchSpec(providerId, options);
  const info = isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : buildAcpProviderInfo({
        id: providerId,
        displayName: launchSpec?.displayName ?? providerId,
        logoUrl: null,
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

  const descriptor = isAgentProviderId(providerId)
    ? builtInProvidersById.get(providerId)
    : undefined;

  if (!descriptor) {
    const allIds = listBuiltInAgentProviderInfos().map((info) => info.id);
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  const adapterOptions = toProviderAdapterFactoryOptions(options);

  return descriptor.createAdapter(adapterOptions);
}

function toProviderAdapterFactoryOptions(
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapterFactoryOptions {
  return {
    additionalWorkspaceWriteRoots: options?.additionalWorkspaceWriteRoots ?? [],
    ...(options?.acpLaunchSpec !== undefined
      ? { acpLaunchSpec: options.acpLaunchSpec }
      : {}),
    ...(options?.bridgeBundleDir !== undefined
      ? { bridgeBundleDir: options.bridgeBundleDir }
      : {}),
    ...(options?.bridgeNodeEnv !== undefined
      ? { bridgeNodeEnv: options.bridgeNodeEnv }
      : {}),
    ...(options?.bridgeNodeExecutablePath !== undefined
      ? { bridgeNodeExecutablePath: options.bridgeNodeExecutablePath }
      : {}),
    ...(options?.turnIdPrefix !== undefined
      ? { turnIdPrefix: options.turnIdPrefix }
      : {}),
  };
}

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  return listBuiltInAgentProviderInfos();
}
