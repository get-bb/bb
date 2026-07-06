import type { ProviderInfo } from "@bb/domain";
import { buildAcpProviderInfo } from "@bb/agent-providers";

export interface KnownAcpAgent {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  executableName: string;
  modelCli?: {
    listArgs: string[];
    selectFlag?: string;
    primaryModels: string[];
  };
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
  {
    // omp (oh-my-pi) speaks the Agent Client Protocol via `omp acp`
    // (https://omp.sh); registering it here auto-detects an installed omp CLI
    // and exposes it as provider `acp-omp`, mirroring acp-opencode.
    id: "acp-omp",
    displayName: "omp",
    command: "omp",
    args: ["acp"],
    env: {},
    executableName: "omp",
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
