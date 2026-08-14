/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and adapter factories
 * (codex, claude-code, pi).
 */

import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";
import { createAcpProviderAdapter } from "./acp/adapter.js";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import { resolveBridgeProcessArgs } from "./shared/bridge-path.js";
import {
  acpProfileFromLaunchSpec,
  ACP_AGENT_PROFILES,
} from "./acp/profiles.js";
import { createClaudeCodeProviderAdapter } from "./claude-code/adapter.js";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import { createPiProviderAdapter } from "./pi/adapter.js";
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
  {
    createAdapter: (options) => createPiProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("pi"),
  },
  ...ACP_AGENT_PROFILES.map((profile) => ({
    createAdapter: (options: ProviderAdapterFactoryOptions) =>
      createAcpProviderAdapter({ ...options, profile }),
    info: getBuiltInAgentProviderInfo(profile.providerId),
  })),
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
 * Experiment-gated canonical path: providers whose id matches an enabled
 * bridge-protocol prefix run on the generic adapter speaking the canonical
 * Provider Bridge Protocol. ACP providers and pi participate today; the
 * ACP launch spec travels opaquely via staticProviderOptions (pi needs no
 * launch spec). Transitional wiring — phase 3 provider declarations replace
 * this table.
 */
function createBridgeProtocolAdapterForId(
  providerId: string,
  options: ProviderAdapterFactoryOptions,
): ProviderAdapter | null {
  const prefixes = options.bridgeProtocolProviderPrefixes ?? [];
  if (!prefixes.some((prefix) => providerId.startsWith(prefix))) {
    return null;
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
  if (!isAcpProviderId(providerId)) {
    return null;
  }
  const info =
    isAgentProviderId(providerId) && providerId === "acp-cursor"
      ? getBuiltInAgentProviderInfo(providerId)
      : buildAcpProviderInfo({
          id: providerId,
          displayName: options.acpLaunchSpec?.displayName ?? providerId,
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
    ...(options.acpLaunchSpec !== undefined
      ? { staticProviderOptions: { acpLaunchSpec: options.acpLaunchSpec } }
      : {}),
  });
}

export function createProviderForId(
  providerId: string,
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  const bridgeProtocolAdapter = options
    ? createBridgeProtocolAdapterForId(providerId, options)
    : null;
  if (bridgeProtocolAdapter !== null) {
    return bridgeProtocolAdapter;
  }

  if (!isAgentProviderId(providerId) && options?.acpLaunchSpec) {
    if (!isAcpProviderId(providerId)) {
      throw new Error(
        `ACP launch spec supplied for non-ACP provider "${providerId}".`,
      );
    }
    const adapterOptions = toProviderAdapterFactoryOptions(options);
    return createAcpProviderAdapter({
      ...adapterOptions,
      profile: acpProfileFromLaunchSpec(options.acpLaunchSpec, providerId),
    });
  }

  if (!isAgentProviderId(providerId)) {
    const allIds = builtInProviders.map((provider) => provider.info.id);
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  const descriptor = builtInProvidersById.get(providerId);

  if (!descriptor) {
    const allIds = builtInProviders.map((provider) => provider.info.id);
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
