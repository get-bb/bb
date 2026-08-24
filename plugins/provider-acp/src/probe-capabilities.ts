/**
 * What a probe result changes about an agent's declaration (Q21).
 *
 * The rule is one-directional: bb narrows a capability the agent denies and
 * never widens one the agent claims. A declaration above what the agent
 * answers is a user-visible failure — the bridge refuses a fork only after
 * bb created the fork thread (#1833) — while a declaration below it is a
 * missing affordance the agent's own `initialize` reply can restore only
 * once bb has verified the rest of the path.
 */

import type { AcpAgentDefinition } from "./agents.js";
import type { AcpProbeResult } from "./contract.js";

export interface AcpProbeApplication {
  agent: AcpAgentDefinition;
  /** Why the declaration changed, for the log. */
  reason: string;
}

/**
 * The agent as its probe says it is, or null when nothing changed — an
 * unreachable agent, or one that answers exactly what bb declared.
 */
export function applyAcpAgentProbe(
  agent: AcpAgentDefinition,
  probe: AcpProbeResult,
): AcpProbeApplication | null {
  if (!probe.reachable) {
    return null;
  }
  const declaredFork = agent.fork ?? "none";
  if (declaredFork === "none" || probe.fork) {
    return null;
  }
  return {
    agent: { ...agent, fork: "none" },
    reason: `the agent does not advertise session/fork, but bb declared fork "${declaredFork}"`,
  };
}
