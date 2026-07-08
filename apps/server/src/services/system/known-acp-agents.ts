import { buildAcpProviderInfo } from "@bb/agent-providers";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

export interface KnownAcpAgent extends HostDaemonAcpLaunchSpec {
  id: string;
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
  {
    // Grok Build speaks ACP over stdio via `grok agent stdio`
    // (https://docs.x.ai/build/cli/headless-scripting). Authentication is
    // handled by the ACP bridge using Grok's advertised auth methods.
    id: "acp-grok",
    displayName: "Grok Build",
    command: "grok",
    args: ["agent", "stdio"],
    env: {},
    executableName: "grok",
    modelCli: {
      listArgs: ["models"],
      selectFlag: "--model",
      primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
    },
    permissionCli: {
      full: ["--always-approve"],
      insertAfterArgs: 1,
    },
    reasoningCli: {
      flag: "--reasoning-effort",
      supportedLevels: ["low", "medium", "high"],
      levelValues: {
        none: "low",
        xhigh: "high",
        ultracode: "high",
        max: "high",
      },
      defaultLevel: "high",
    },
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
