import { buildAcpProviderInfo } from "../providers/acp-provider-tier.js";
import type { ProviderInfo } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

export interface KnownAcpAgent extends HostDaemonAcpLaunchSpec {
  id: string;
  executableName: string;
  /**
   * Whether the agent accepts an explicit compaction request. Declared per
   * agent (mirroring `customAcpAgents.supportsManualCompaction`) because ACP
   * itself advertises nothing about compaction — the alternative is a BB-side
   * id list, which is what this replaced.
   */
  supportsManualCompaction: boolean;
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
    // OpenCode implements the built-in /compact command over ACP.
    supportsManualCompaction: true,
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
    supportsManualCompaction: false,
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
    supportsManualCompaction: false,
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
  {
    // Hermes Agent speaks ACP over stdio via `hermes acp`. The official ACP
    // registry also supports a uvx launcher, but the installed CLI exposes the
    // `hermes` command as the stable host-local signal.
    // https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    command: "hermes",
    args: ["acp"],
    env: {},
    executableName: "hermes",
    supportsManualCompaction: false,
    nativeReasoning: {
      configId: "reasoning_effort",
      supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultLevel: "medium",
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
    logoUrl: null,
  });
}

export function findKnownAcpAgentForProviderId(
  providerId: string,
): KnownAcpAgent | undefined {
  return KNOWN_ACP_AGENTS.find((agent) => agent.id === providerId);
}
