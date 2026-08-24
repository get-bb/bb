/**
 * The plugin's `bb.host` artifact.
 *
 * Two surfaces, one artifact: the daemon's bridge bootstrap looks for the
 * named `experimental_providerBridge` export, and the host worker looks for
 * the default host entry. Every ACP agent bb ships runs on the published kit,
 * so the bridge is one re-export; the host entry adds the things that can
 * only happen on the machine the agent is installed on — asking the agent
 * what it supports (Q21), and naming the skill roots the agent reads from
 * that machine's own configuration.
 */

import os from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { experimental_probeAcpAgent } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { acpHostContract } from "./contract.js";
import { resolveAcpNativeRoots } from "./native-roots/index.js";

export { experimental_acpProviderBridge as experimental_providerBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";

export default experimental_defineHostEntry({
  contract: acpHostContract,
  handlers: {
    probeAgent: async (input, context) =>
      // The worker's temp directory is a real, writable path the agent can
      // start in without touching a workspace.
      experimental_probeAcpAgent({
        command: input.command,
        args: input.args,
        env: input.env,
        cwd: context.experimental_paths.tempDir,
      }),
    // The host's own home and environment: this is the one place the plugin
    // reads them, so the resolvers stay testable on a fixture home.
    resolveNativeRoots: (input) =>
      resolveAcpNativeRoots({
        agentId: input.providerId,
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
