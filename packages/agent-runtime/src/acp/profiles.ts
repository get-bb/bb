import type { AcpAgentProviderId } from "@bb/agent-providers";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

/**
 * CLI model surface of the agent's launch binary: how to discover models and
 * how to pin one at launch. The bridge parses the listed ids into model
 * families with reasoning-effort variants (see `bridge/model-catalog.ts`).
 */
export interface AcpAgentModelCli {
  /** Args (on the agent binary) that print one `id - Display Name` line per model. */
  listArgs: string[];
  /** Global flag inserted before the agent args to pin a model at launch. */
  selectFlag?: string;
  /**
   * Family ids (each family's default-variant raw id) shown in the picker by
   * default; every other family lands in the collapsed "more models" pool.
   * Names that stop matching simply drop out — when none match, the bridge
   * falls back to showing everything.
   */
  primaryModels: string[];
}

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
}

interface BuiltInAcpAgentProfile extends AcpAgentProfile {
  providerId: AcpAgentProviderId;
  modelCli: AcpAgentModelCli;
}

export const ACP_AGENT_PROFILES: readonly BuiltInAcpAgentProfile[] = [
  {
    providerId: "acp-cursor",
    displayName: "Cursor",
    // Cursor CLI installs its agent binary as `agent` (cursor.com/docs/cli);
    // `cursor` is the editor's shell launcher and does not speak ACP.
    agentCommand: { command: "agent", args: ["acp"] },
    // Global flags must precede the `acp` subcommand, matching the documented
    // `agent --api-key ... acp` form.
    modelCli: {
      listArgs: ["--list-models"],
      selectFlag: "--model",
      primaryModels: [
        "auto",
        "claude-fable-5-thinking-medium",
        "claude-opus-4-8-thinking-medium",
        "gpt-5.5-medium",
        // Composer is one family now; its `-fast` twin is the Fast-mode tier.
        "composer-2.5",
      ],
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
  const modelCli =
    spec.modelCli !== undefined && spec.modelCli.listArgs.length > 0
      ? spec.modelCli
      : undefined;
  return {
    providerId,
    displayName: spec.displayName,
    agentCommand: { command: spec.command, args: [...spec.args] },
    ...(Object.keys(spec.env).length > 0 ? { env: { ...spec.env } } : {}),
    ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
    ...(modelCli !== undefined
      ? {
          modelCli: {
            listArgs: [...modelCli.listArgs],
            primaryModels: [...modelCli.primaryModels],
            ...(modelCli.selectFlag !== undefined
              ? { selectFlag: modelCli.selectFlag }
              : {}),
          },
        }
      : {}),
  };
}
