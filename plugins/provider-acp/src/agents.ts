import { z } from "zod";
import type { PluginProviderReasoningLevel } from "@get-bb/plugin-sdk";
import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";
import type { AcpLaunchSpec } from "@get-bb/plugin-sdk/provider-bridge/acp";
import type { AcpNativeRootsResolver } from "./native-roots/resolver.js";

export const ACP_FAMILY = "acp";

export function formatCustomAcpProviderId(slug: string): string {
  return `acp-${slug}`;
}

export type { AcpLaunchSpec };

export interface AcpAgentDefinition {
  id: string;
  displayName: string;
  icon?: string;
  launch: AcpLaunchSpec;
  dialect?: string;
  parameterizedModelPicker?: boolean;
  primaryModels?: readonly string[];
  reasoningProbePriorityModelIds?: readonly string[];
  visibility?: "always" | "installed";
  signInCommand?: string;
  installUrl?: string;
  iconTint?: { light: string; dark: string };
  supportsManualCompaction?: boolean;
  fork?: "none" | "tip";
  reasoningLevels?: readonly PluginProviderReasoningLevel[];
  providerUsage?: boolean;
  providerInstallation?: boolean;
  nativeRootsResolver?: AcpNativeRootsResolver;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const customAcpAgentSchema = z
  .object({
    id: z.string().regex(SLUG_PATTERN),
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string().regex(ENV_NAME_PATTERN), z.string()).default({}),
    cwd: z.string().min(1).optional(),
    dialect: z.string().min(1).optional(),
    supportsManualCompaction: z.boolean().default(false),
  })
  .strict()
  .merge(
    experimental_acpLaunchSpecSchema.omit({
      displayName: true,
      command: true,
      args: true,
      env: true,
    }),
  )
  .strict();
export type CustomAcpAgent = z.infer<typeof customAcpAgentSchema>;

const CUSTOM_AGENT_GLYPH = "Toolbox";

export function customAcpAgentDefinition(
  agent: CustomAcpAgent,
  shipped?: AcpAgentDefinition,
): AcpAgentDefinition {
  const nativeSkillRoots =
    agent.nativeSkillRoots ?? shipped?.launch.nativeSkillRoots;
  const launch: AcpLaunchSpec = {
    displayName: agent.displayName,
    command: agent.command,
    args: [...agent.args],
    env: { ...agent.env },
  };
  if (agent.cwd !== undefined) launch.cwd = agent.cwd;
  if (agent.modelCli !== undefined) launch.modelCli = agent.modelCli;
  if (agent.reasoningCli !== undefined) {
    launch.reasoningCli = agent.reasoningCli;
  }
  if (agent.nativeReasoning !== undefined) {
    launch.nativeReasoning = agent.nativeReasoning;
  }
  if (nativeSkillRoots !== undefined)
    launch.nativeSkillRoots = nativeSkillRoots;
  if (agent.permissionCli !== undefined)
    launch.permissionCli = agent.permissionCli;

  const definition: AcpAgentDefinition = {
    id: formatCustomAcpProviderId(agent.id),
    displayName: agent.displayName,
    icon: CUSTOM_AGENT_GLYPH,
    launch,
    visibility: "always",
    fork: "none",
    supportsManualCompaction: agent.supportsManualCompaction,
  };
  if (agent.dialect !== undefined) definition.dialect = agent.dialect;
  if (shipped?.nativeRootsResolver !== undefined) {
    definition.nativeRootsResolver = shipped.nativeRootsResolver;
  }
  return definition;
}

interface ParsedCustomAcpAgents {
  agents: CustomAcpAgent[];
  problems: string[];
}

export function parseCustomAcpAgents(args: {
  entries: readonly unknown[];
  reservedProviderIds: ReadonlySet<string>;
}): ParsedCustomAcpAgents {
  const agents: CustomAcpAgent[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of args.entries.entries()) {
    const parsed = customAcpAgentSchema.safeParse(entry);
    if (!parsed.success) {
      problems.push(
        `entry ${index} is not a valid agent: ${parsed.error.message}`,
      );
      continue;
    }
    const providerId = formatCustomAcpProviderId(parsed.data.id);
    if (args.reservedProviderIds.has(providerId)) {
      problems.push(
        `agent "${parsed.data.id}" resolves to built-in provider "${providerId}"`,
      );
      continue;
    }
    if (seen.has(providerId)) {
      problems.push(`agent "${parsed.data.id}" is configured more than once`);
      continue;
    }
    const launch = experimental_acpLaunchSpecSchema.safeParse(
      customAcpAgentDefinition(parsed.data).launch,
    );
    if (!launch.success) {
      problems.push(
        `agent "${parsed.data.id}" does not produce a launch the bridge accepts: ${launch.error.message}`,
      );
      continue;
    }
    seen.add(providerId);
    agents.push(parsed.data);
  }
  return { agents, problems };
}
