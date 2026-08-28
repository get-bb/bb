import {
  createBridgeProtocolAdapter,
  type BridgeProtocolAdapter,
} from "./bridge-protocol-adapter.js";
import type { JsonObject } from "@bb/domain";
import { resolveBridgeWorkerProcessArgs } from "./shared/bridge-path.js";
import type { CreateBridgeAdapterOptions } from "./provider-adapter.js";

interface PluginStaticProviderOptions {
  staticProviderOptions?: JsonObject;
}

interface BridgeWorkerProcessOptions {
  bridgeBundleDir?: string;
}

function buildPluginStaticProviderOptions(
  options: CreateBridgeAdapterOptions,
): PluginStaticProviderOptions {
  const additionalWorkspaceWriteRoots = options.additionalWorkspaceWriteRoots;
  const staticProviderOptions: JsonObject = {
    ...options.bridgeLaunch.providerOptions,
  };
  if (additionalWorkspaceWriteRoots.length > 0) {
    staticProviderOptions.additionalWorkspaceWriteRoots = [
      ...additionalWorkspaceWriteRoots,
    ];
  }
  if (Object.keys(staticProviderOptions).length === 0) return {};
  return { staticProviderOptions };
}

export function createProviderForId(
  providerId: string,
  adapterOptions: CreateBridgeAdapterOptions,
): BridgeProtocolAdapter {
  const { bridgeLaunch } = adapterOptions;
  const bridgeWorkerOptions: BridgeWorkerProcessOptions = {};
  if (adapterOptions.bridgeBundleDir !== undefined) {
    bridgeWorkerOptions.bridgeBundleDir = adapterOptions.bridgeBundleDir;
  }
  return createBridgeProtocolAdapter({
    id: providerId,
    capabilities: {
      ...bridgeLaunch.capabilities,
      permissionModes: [...bridgeLaunch.capabilities.permissionModes],
      supportsNativeUserQuestion: false,
    },
    process: {
      command: adapterOptions.bridgeNodeExecutablePath ?? "node",
      args: [
        ...resolveBridgeWorkerProcessArgs(bridgeWorkerOptions),
        bridgeLaunch.source.artifactPath,
        bridgeLaunch.pluginId,
        bridgeLaunch.dataDir,
      ],
      env: {
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
): PluginEnvironment {
  const picked: PluginEnvironment = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") picked[name] = value;
  }
  return picked;
}

interface PluginEnvironment {
  [name: string]: string;
}
