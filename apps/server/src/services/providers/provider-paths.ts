import { internal_DO_NOT_USE_providerPathsHostContract } from "@get-bb/plugin-sdk/host";
import type { WorkSessionDeps } from "../../types.js";
import { callPluginHostRpc } from "../plugins/plugin-host-rpc.js";

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
      if (!artifact)
        throw new Error(`Provider plugin ${pluginId} has no host artifact`);
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
