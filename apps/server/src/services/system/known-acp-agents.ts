import { buildAcpProviderInfo } from "@bb/agent-providers";
import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
} from "@bb/config/bb-app-managed-config";
import type { ProviderInfo } from "@bb/domain";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";

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

export function findCustomAcpAgentForProviderId(
  customAcpAgents: readonly CustomAcpAgent[],
  providerId: string,
): CustomAcpAgent | undefined {
  return customAcpAgents.find(
    (agent) => formatCustomAcpAgentProviderId(agent.id) === providerId,
  );
}

/**
 * Resolve the launch spec exactly as thread.start does: a configured custom
 * ACP agent shadows a built-in known agent that shares its provider id, and
 * falls back to the static KNOWN_ACP_AGENTS entry otherwise. Callers that
 * need to probe or launch an ACP agent (thread start/resume/import) must
 * share this resolution so what gets probed is what actually serves the
 * thread.
 */
export function buildAcpLaunchSpecForProviderId(
  customAcpAgents: readonly CustomAcpAgent[],
  providerId: string,
): HostDaemonAcpLaunchSpec | undefined {
  const agent = findCustomAcpAgentForProviderId(customAcpAgents, providerId);
  if (agent) {
    return normalizeHostDaemonAcpLaunchSpec(agent);
  }
  const knownAgent = findKnownAcpAgentForProviderId(providerId);
  return knownAgent ? normalizeHostDaemonAcpLaunchSpec(knownAgent) : undefined;
}
