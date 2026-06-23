import type { ProviderInfo } from "@bb/domain";
import { buildAcpProviderInfo } from "@bb/agent-providers";

export interface KnownAcpAgent {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  executableName: string;
}

export interface KnownAcpAgentExecutableQuery {
  id: string;
  executableName: string;
}

export const KNOWN_ACP_AGENTS: readonly KnownAcpAgent[] = [
  {
    id: "acp-opencode",
    displayName: "opencode",
    command: "opencode",
    args: ["acp"],
    env: {},
    executableName: "opencode",
  },
];

export function listKnownAcpAgentExecutableQueries(): KnownAcpAgentExecutableQuery[] {
  return KNOWN_ACP_AGENTS.map((agent) => ({
    id: agent.id,
    executableName: agent.executableName,
  }));
}

export function buildKnownAcpProviderInfo(agent: KnownAcpAgent): ProviderInfo {
  return buildAcpProviderInfo({
    id: agent.id,
    displayName: agent.displayName,
  });
}

export function findKnownAcpAgentForProviderId(
  providerId: string,
): KnownAcpAgent | undefined {
  return KNOWN_ACP_AGENTS.find((agent) => agent.id === providerId);
}
