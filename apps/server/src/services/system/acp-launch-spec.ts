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

/**
 * The declared capabilities of a resolved ACP agent. ACP ids are never
 * registered in the provider registry (they are resolved from launch specs at
 * request time), so this is the ACP tier's equivalent of a plugin declaration.
 * A custom agent wins over a known agent with the same provider id, exactly as
 * it does for the launch spec.
 */
export function resolveAcpAgentCapabilitiesForProviderId(
  deps: Pick<AppDeps, "config">,
  providerId: string,
): { supportsManualCompaction: boolean } | null {
  const agent =
    findCustomAcpAgentForProviderId(deps.config.customAcpAgents, providerId) ??
    findKnownAcpAgentForProviderId(providerId);
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
  const knownAgent = findKnownAcpAgentForProviderId(providerId);
  return knownAgent === undefined
    ? undefined
    : normalizeHostDaemonAcpLaunchSpec(knownAgent);
}
