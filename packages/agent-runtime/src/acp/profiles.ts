import type { AcpAgentProviderId } from "@bb/agent-providers";

/**
 * Launch profile for a built-in ACP (Agent Client Protocol) provider. The
 * bridge process spawns `command args...` per thread and speaks ACP over the
 * agent's stdio.
 */
export interface AcpAgentProfile {
  providerId: AcpAgentProviderId;
  displayName: string;
  agentCommand: { command: string; args: string[] };
}

export const ACP_AGENT_PROFILES: readonly AcpAgentProfile[] = [
  {
    providerId: "acp-cursor",
    displayName: "Cursor",
    agentCommand: { command: "cursor", args: ["acp"] },
  },
  {
    providerId: "acp-hermes",
    displayName: "Hermes",
    agentCommand: { command: "hermes", args: ["acp"] },
  },
  {
    providerId: "acp-opencode",
    displayName: "OpenCode",
    agentCommand: { command: "opencode", args: ["acp"] },
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
