import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
} from "@bb/config/bb-app-managed-config";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { findKnownAcpAgentForProviderId } from "./known-acp-agents.js";

function findCustomAcpAgentForProviderId(
  customAcpAgents: readonly CustomAcpAgent[],
  providerId: string,
): CustomAcpAgent | undefined {
  return customAcpAgents.find(
    (agent) => formatCustomAcpAgentProviderId(agent.id) === providerId,
  );
}

export function resolveAcpLaunchSpecForProviderId(
  deps: Pick<AppDeps, "config">,
  providerId: string,
): HostDaemonAcpLaunchSpec | undefined {
  const agent = findCustomAcpAgentForProviderId(
    deps.config.customAcpAgents,
    providerId,
  );
  if (agent !== undefined) {
    return normalizeHostDaemonAcpLaunchSpec(agent);
  }
  const knownAgent = findKnownAcpAgentForProviderId(providerId);
  return knownAgent === undefined
    ? undefined
    : normalizeHostDaemonAcpLaunchSpec(knownAgent);
}
