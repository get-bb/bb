import type { AcpAgentProviderId } from "@bb/agent-providers";

/**
 * CLI model surface of the agent's launch binary: how to discover models and
 * how to pin one at launch. The bridge parses the listed ids into model
 * families with reasoning-effort variants (see `bridge/model-catalog.ts`).
 */
export interface AcpAgentModelCli {
  /** Args (on the agent binary) that print one `id - Display Name` line per model. */
  listArgs: string[];
  /** Global flag inserted before the agent args to pin a model at launch. */
  selectFlag: string;
}

/**
 * Launch profile for a built-in ACP (Agent Client Protocol) provider. The
 * bridge process spawns `command args...` per thread and speaks ACP over the
 * agent's stdio.
 */
export interface AcpAgentProfile {
  providerId: AcpAgentProviderId;
  displayName: string;
  agentCommand: { command: string; args: string[] };
  modelCli: AcpAgentModelCli;
}

export const ACP_AGENT_PROFILES: readonly AcpAgentProfile[] = [
  {
    providerId: "acp-cursor",
    displayName: "Cursor",
    // Cursor CLI installs its agent binary as `agent` (cursor.com/docs/cli);
    // `cursor` is the editor's shell launcher and does not speak ACP.
    agentCommand: { command: "agent", args: ["acp"] },
    // Global flags must precede the `acp` subcommand, matching the documented
    // `agent --api-key ... acp` form.
    modelCli: { listArgs: ["--list-models"], selectFlag: "--model" },
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
