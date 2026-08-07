import type { AcpAgentProviderId } from "@bb/agent-providers";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";

/**
 * CLI model surface of the agent's launch binary: how to discover models and
 * how to pin one at launch. The bridge parses the listed ids into model
 * families with reasoning-effort variants (see `bridge/model-catalog.ts`).
 */
export type AcpAgentModelCli = NonNullable<HostDaemonAcpLaunchSpec["modelCli"]>;
export type AcpAgentReasoningCli = NonNullable<
  HostDaemonAcpLaunchSpec["reasoningCli"]
>;
export type AcpAgentNativeReasoning = NonNullable<
  HostDaemonAcpLaunchSpec["nativeReasoning"]
>;
export type AcpAgentPermissionCli = NonNullable<
  HostDaemonAcpLaunchSpec["permissionCli"]
>;
export type AcpAgentManualCompaction = NonNullable<
  HostDaemonAcpLaunchSpec["manualCompaction"]
>;

/**
 * Launch profile for a built-in ACP (Agent Client Protocol) provider. The
 * bridge process spawns `command args...` per thread and speaks ACP over the
 * agent's stdio.
 */
export interface AcpAgentProfile {
  providerId: string;
  displayName: string;
  agentCommand: { command: string; args: string[] };
  env?: Record<string, string>;
  cwd?: string;
  modelCli?: AcpAgentModelCli;
  reasoningCli?: AcpAgentReasoningCli;
  nativeReasoning?: AcpAgentNativeReasoning;
  permissionCli?: AcpAgentPermissionCli;
  manualCompaction?: AcpAgentManualCompaction;
}

interface BuiltInAcpAgentProfile extends AcpAgentProfile {
  providerId: AcpAgentProviderId;
  modelCli: AcpAgentModelCli;
}

const CURSOR_COMPACTION_SUMMARY_PROMPT =
  "Create a concise but complete handoff summary of this conversation for a fresh agent session. Preserve the user's goals, decisions, constraints, current implementation state, important file paths and symbols, unresolved work, and test results. Do not use tools and do not continue the task. Return only the handoff summary.";

const CURSOR_COMPACTION_RESEED_PROMPT =
  'The text below is a compacted handoff from this same conversation. Treat it as prior context, not as a new user request. Do not use tools or continue the task yet. Reply only "Context restored."';

export const ACP_AGENT_PROFILES: readonly BuiltInAcpAgentProfile[] = [
  {
    providerId: "acp-cursor",
    displayName: "Cursor",
    // Cursor installs both `cursor-agent` and the generic `agent` alias. Use
    // the namespaced executable so another provider's `agent` binary earlier
    // on PATH cannot silently replace Cursor and collapse model discovery to
    // the synthetic fallback.
    agentCommand: { command: "cursor-agent", args: ["acp"] },
    // Global flags must precede the `acp` subcommand, matching the documented
    // `cursor-agent --api-key ... acp` form.
    modelCli: {
      listArgs: ["--list-models"],
      selectFlag: "--model",
      // Family ids (the default variant's raw id), not raw variant ids: the
      // catalog folds effort and the `-fast` tail into one entry per family.
      primaryModels: [
        "auto",
        "cursor-grok-4.5-medium",
        "gpt-5.6-sol-medium",
        "claude-opus-5-thinking-medium",
        "claude-fable-5-thinking-medium",
        // Composer is one family now; its `-fast` twin is the Fast-mode tier.
        "composer-2.5",
      ],
    },
    // Cursor's interactive `/compress` command is not interpreted by its ACP
    // server. Preserve context by summarizing the current ACP session and
    // reseeding a fresh session instead.
    manualCompaction: {
      method: "summarize-and-reseed",
      summaryPrompt: CURSOR_COMPACTION_SUMMARY_PROMPT,
      reseedPrompt: CURSOR_COMPACTION_RESEED_PROMPT,
    },
  },
];

export function getAcpAgentProfile(
  providerId: AcpAgentProviderId,
): AcpAgentProfile {
  const profile = ACP_AGENT_PROFILES.find(
    (candidate) => candidate.providerId === providerId,
  );
  if (!profile) {
    throw new Error(`Unknown ACP agent profile "${providerId}".`);
  }
  return profile;
}

export function acpProfileFromLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
  providerId: string,
): AcpAgentProfile {
  const normalized = normalizeHostDaemonAcpLaunchSpec(spec);
  const { command, args, env, ...profile } = normalized;
  return {
    providerId,
    ...profile,
    agentCommand: { command, args },
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
