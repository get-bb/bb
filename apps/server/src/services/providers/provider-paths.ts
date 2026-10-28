import { internal_DO_NOT_USE_providerPathsHostContract } from "@get-bb/plugin-sdk/host";
import type { WorkSessionDeps } from "../../types.js";
import { callPluginHostRpc } from "../plugins/plugin-host-rpc.js";

export async function resolveProviderPaths(
  deps: WorkSessionDeps,
  args: { providerId: string; hostId: string; timeoutMs: number },
) {
  const registration = deps.providerRegistry.get(args.providerId);
  if (!registration) return { skillInstallRoots: [], credentialFiles: [] };
  const artifact = deps.pluginHostArtifacts.get(registration.pluginId);
  if (!artifact)
    throw new Error(`Provider ${args.providerId} has no host artifact`);
  return internal_DO_NOT_USE_providerPathsHostContract.resolveProviderPaths.output.parse(
    await callPluginHostRpc(deps, {
      pluginId: registration.pluginId,
      contract: internal_DO_NOT_USE_providerPathsHostContract,
      method: "resolveProviderPaths",
      input: {},
      hostId: args.hostId,
      projectId: null,
      timeoutMs: args.timeoutMs,
      artifact,
    }),
  );
}
