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

const OPENCODE_COMPACTION_SUMMARY_PROMPT =
  "Create a concise but complete handoff summary of this conversation for a fresh agent session. Preserve the user's goals, decisions, constraints, current implementation state, important file paths and symbols, unresolved work, and test results. Do not use tools and do not continue the task. Return only the handoff summary.";

const OPENCODE_COMPACTION_RESEED_PROMPT =
  'The text below is a compacted handoff from this same conversation. Treat it as prior context, not as a new user request. Do not use tools or continue the task yet. Reply only "Context restored."';

export const KNOWN_ACP_AGENTS: readonly KnownAcpAgent[] = [
  {
    id: "acp-opencode",
    displayName: "opencode",
    command: "opencode",
    args: ["acp"],
    env: {},
    // OpenCode advertises `/compact`, but current ACP releases return an
    // internal error when that control is sent through session/prompt. Use the
    // provider-independent ACP fallback so manual compaction remains reliable.
    manualCompaction: {
      method: "summarize-and-reseed",
      summaryPrompt: OPENCODE_COMPACTION_SUMMARY_PROMPT,
      reseedPrompt: OPENCODE_COMPACTION_RESEED_PROMPT,
    },
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
    supportsManualCompaction: agent.manualCompaction !== undefined,
  });
}

export function findKnownAcpAgentForProviderId(
  providerId: string,
): KnownAcpAgent | undefined {
  return KNOWN_ACP_AGENTS.find((agent) => agent.id === providerId);
}
