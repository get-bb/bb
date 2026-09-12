import type { AcpAgentDefinition } from "./agents.js";
import type { AcpAgentProbe } from "@get-bb/plugin-sdk/provider-bridge/acp";

export interface AcpProbeApplication {
  agent: AcpAgentDefinition;
  reason: string;
}

export function applyAcpAgentProbe(
  agent: AcpAgentDefinition,
  probe: AcpAgentProbe,
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
