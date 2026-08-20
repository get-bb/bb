import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
} from "@bb/config/bb-app-managed-config";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";

function findCustomAcpAgentForProviderId(
  customAcpAgents: readonly CustomAcpAgent[],
  providerId: string,
): CustomAcpAgent | undefined {
  return customAcpAgents.find(
    (agent) => formatCustomAcpAgentProviderId(agent.id) === providerId,
  );
}

/**
 * The declared capabilities of a user-configured ACP agent. Built-in ACP
 * providers are ordinary plugin registrations; only custom ids remain dynamic.
 */
export function resolveAcpAgentCapabilitiesForProviderId(
  deps: Pick<AppDeps, "config">,
  providerId: string,
): { supportsManualCompaction: boolean } | null {
  const agent = findCustomAcpAgentForProviderId(
    deps.config.customAcpAgents,
    providerId,
  );
  return agent === undefined
    ? null
    : { supportsManualCompaction: agent.supportsManualCompaction };
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
  return undefined;
}
