import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@get-bb/plugin-sdk/provider-bridge";

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
