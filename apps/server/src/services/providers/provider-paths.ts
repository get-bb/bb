import { internal_DO_NOT_USE_providerPathsHostContract } from "@get-bb/plugin-sdk/host";
import type { WorkSessionDeps } from "../../types.js";
import { callPluginHostRpc } from "../plugins/plugin-host-rpc.js";

const NO_PROVIDER_PATHS = { skillInstallRoots: [], credentialFiles: [] };

export async function resolveProviderPaths(
  deps: WorkSessionDeps,
  args: { hostId: string; timeoutMs: number },
) {
  const pluginIds = new Set(
    deps.providerRegistry
      .list()
      .filter((registration) => registration.resolvesProviderPaths)
      .map((registration) => registration.pluginId),
  );
  const answers = await Promise.all(
    [...pluginIds].map(async (pluginId) => {
      const artifact = deps.pluginHostArtifacts.get(pluginId);
      try {
        if (!artifact) throw new Error("The plugin has no live host artifact");
        return internal_DO_NOT_USE_providerPathsHostContract.resolveProviderPaths.output.parse(
          await callPluginHostRpc(deps, {
            pluginId,
            contract: internal_DO_NOT_USE_providerPathsHostContract,
            method: "resolveProviderPaths",
            input: {},
            hostId: args.hostId,
            projectId: null,
            timeoutMs: args.timeoutMs,
            artifact,
          }),
        );
      } catch (error) {
        deps.logger.warn(
          { pluginId, hostId: args.hostId, err: error },
          `Plugin "${pluginId}" failed to resolve provider paths; leaving its paths out`,
        );
        return NO_PROVIDER_PATHS;
      }
    }),
  );
  return {
    skillInstallRoots: [
      ...new Set(answers.flatMap((answer) => answer.skillInstallRoots)),
    ],
    credentialFiles: [
      ...new Set(answers.flatMap((answer) => answer.credentialFiles)),
    ],
  };
}
