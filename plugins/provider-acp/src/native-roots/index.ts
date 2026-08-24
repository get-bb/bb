/**
 * `resolveNativeRoots` for one of the agents this plugin ships.
 *
 * One plugin registers one provider per agent, and core asks per provider,
 * so the answer depends on which agent is asked: each known agent carries
 * its own resolver. A configured (user-added) agent declares its roots in
 * the plugin setting and resolves none.
 */

import {
  experimental_filterResolvedNativeRoots,
  type ExperimentalNativeRootsResolveAnswer,
} from "@get-bb/plugin-sdk/host";
import { KNOWN_ACP_AGENTS } from "../known-agents.js";
import type { AcpNativeRootsResolverArgs } from "./resolver.js";

/**
 * For an in-process test of the whole path (declaration → resolver → daemon
 * scan): each known agent's declaration fragment comes from
 * `acpProviderDeclaration(agent)` over `KNOWN_ACP_AGENTS`, and its resolved
 * roots from `resolveAcpNativeRoots` below.
 */
export { acpProviderDeclaration } from "../declaration.js";
export { KNOWN_ACP_AGENTS } from "../known-agents.js";
export type { AcpNativeRootsResolverArgs } from "./resolver.js";

export async function resolveAcpNativeRoots(
  args: AcpNativeRootsResolverArgs & { agentId: string },
): Promise<ExperimentalNativeRootsResolveAnswer> {
  const resolver = KNOWN_ACP_AGENTS.find(
    (agent) => agent.id === args.agentId,
  )?.nativeRootsResolver;
  if (resolver === undefined) {
    return {};
  }
  const answer = await resolver({
    cwd: args.cwd,
    homeDir: args.homeDir,
    env: args.env,
  });
  // A root the contract would refuse (a vendor plugin whose name is not a
  // valid name prefix, say) is dropped on its own, and a side past the cap
  // is cut; the host worker has no bb logger, so the warning goes to its
  // stderr, which the daemon logs.
  return experimental_filterResolvedNativeRoots(answer, { warn: console.warn })
    .answer;
}
