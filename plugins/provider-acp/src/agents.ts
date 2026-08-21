/**
 * The agents this plugin owns.
 *
 * bb ships a list of ACP agents it knows how to launch, and a user adds their
 * own. Both are the same thing — a launch spec plus the facts a provider
 * declaration needs — so both go through one definition shape and one
 * registration path. The plugin owns the list; core keeps no ACP table.
 *
 * A user-configured agent's id is `acp-<slug>`. That prefix is history, not
 * structure: nothing branches on it, ids are permanent because threads
 * persist them, and the `acp` family key is what groups the agents now.
 */

import { z } from "zod";

/**
 * The reasoning ladder an ACP agent may declare — bb's coarse vocabulary,
 * restated here so an agent definition is checked at the plugin boundary.
 */
export type AcpReasoningLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultracode";

/** The family key every agent this plugin registers shares. */
export const ACP_FAMILY = "acp";

/** A user-configured agent's provider id. */
export function formatCustomAcpProviderId(slug: string): string {
  return `acp-${slug}`;
}

/** The launch spec the bridge receives in its provider options. */
export interface AcpLaunchSpec {
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  modelCli?: {
    listArgs: string[];
    selectFlag?: string;
    primaryModels: string[];
  };
  reasoningCli?: {
    flag: string;
    supportedLevels: string[];
    levelValues?: Record<string, string>;
    defaultLevel?: string;
  };
  nativeReasoning?: {
    configId: string;
    supportedLevels: string[];
    defaultLevel?: string;
  };
  nativeSkillRoots?: { argFlag?: string; envVar?: string };
  permissionCli?: { full: string[]; insertAfterArgs?: number };
}

/** One agent this plugin registers as a provider. */
export interface AcpAgentDefinition {
  /** The permanent provider id. */
  id: string;
  displayName: string;
  /** A host glyph name or a plugin-relative asset path. */
  icon?: string;
  /** How to launch the agent. */
  launch: AcpLaunchSpec;
  /** Which vendor side channels the bridge reads (see the kit's dialects). */
  dialect?: string;
  /** Listed always, or only where the bridge reports the agent installed. */
  visibility?: "always" | "installed";
  /** How the user signs in and installs the agent. */
  signInCommand?: string;
  installUrl?: string;
  iconTint?: { light: string; dark: string };
  /** Whether the agent accepts an explicit compaction request. */
  supportsManualCompaction?: boolean;
  /**
   * Whether the agent implements the unstable ACP `session/fork`. Declared
   * conservatively: the bridge refuses a fork the agent never advertised, but
   * only after bb has created the fork thread, so a wrong "tip" here is a
   * user-visible failure (#1833).
   */
  fork?: "none" | "tip";
  /** The reasoning ladder the picker offers when the model list has none. */
  reasoningLevels?: readonly AcpReasoningLevel[];
  /** Usage and installation surfaces the bridge implements for this agent. */
  providerUsage?: boolean;
  providerInstallation?: boolean;
}

// ---------------------------------------------------------------------------
// User-configured agents
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const customAgentModelCliSchema = z
  .object({
    listArgs: z.array(z.string()).default([]),
    selectFlag: z.string().min(1).optional(),
    primaryModels: z.array(z.string()).default([]),
  })
  .strict();

const customAgentReasoningCliSchema = z
  .object({
    flag: z.string().min(1),
    supportedLevels: z.array(z.string().min(1)).min(1),
    levelValues: z.record(z.string(), z.string()).optional(),
    defaultLevel: z.string().min(1).optional(),
  })
  .strict();

const customAgentNativeReasoningSchema = z
  .object({
    configId: z.string().min(1),
    supportedLevels: z.array(z.string().min(1)).min(1),
    defaultLevel: z.string().min(1).optional(),
  })
  .strict();

const customAgentSkillRootsSchema = z
  .object({
    argFlag: z.string().min(1).optional(),
    envVar: z.string().min(1).optional(),
  })
  .strict();

/**
 * One user-configured agent, as the plugin's setting stores it. `id` is a
 * slug; the provider id is `acp-<slug>`.
 */
export const customAcpAgentSchema = z
  .object({
    id: z.string().regex(SLUG_PATTERN),
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string().regex(ENV_NAME_PATTERN), z.string()).default({}),
    cwd: z.string().min(1).optional(),
    dialect: z.string().min(1).optional(),
    modelCli: customAgentModelCliSchema.optional(),
    reasoningCli: customAgentReasoningCliSchema.optional(),
    nativeReasoning: customAgentNativeReasoningSchema.optional(),
    nativeSkillRoots: customAgentSkillRootsSchema.optional(),
    supportsManualCompaction: z.boolean().default(false),
    // The legacy config accepted a `logo` file path, which the server served
    // from a route of its own. A plugin's icon is a host glyph or an asset it
    // ships, so a configured agent takes the generic glyph; the field is
    // accepted and ignored so an old config still parses.
    logo: z.string().min(1).optional(),
  })
  .strict();
export type CustomAcpAgent = z.infer<typeof customAcpAgentSchema>;

export const customAcpAgentsSchema = z.array(customAcpAgentSchema);

/** The glyph a user-configured agent shows in the picker. */
const CUSTOM_AGENT_GLYPH = "Toolbox";

export function customAcpAgentDefinition(
  agent: CustomAcpAgent,
): AcpAgentDefinition {
  return {
    id: formatCustomAcpProviderId(agent.id),
    displayName: agent.displayName,
    icon: CUSTOM_AGENT_GLYPH,
    launch: {
      displayName: agent.displayName,
      command: agent.command,
      args: [...agent.args],
      env: { ...agent.env },
      ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
      ...(agent.modelCli === undefined ||
      agent.modelCli.listArgs.length === 0
        ? {}
        : { modelCli: agent.modelCli }),
      ...(agent.reasoningCli === undefined
        ? {}
        : { reasoningCli: agent.reasoningCli }),
      ...(agent.nativeReasoning === undefined
        ? {}
        : { nativeReasoning: agent.nativeReasoning }),
      ...(agent.nativeSkillRoots === undefined
        ? {}
        : { nativeSkillRoots: agent.nativeSkillRoots }),
    },
    ...(agent.dialect === undefined ? {} : { dialect: agent.dialect }),
    // A configured agent is the user's own: bb cannot know whether it is
    // installed, so it is always listed, and it forks only if it says so.
    visibility: "always",
    fork: "none",
    supportsManualCompaction: agent.supportsManualCompaction,
  };
}

/**
 * Parse the configured agents, dropping the entries that do not parse and the
 * ones that would shadow another id. Returns the reasons so the caller can
 * log them: a silently ignored agent is a support ticket.
 */
export function parseCustomAcpAgents(args: {
  entries: readonly unknown[];
  reservedProviderIds: ReadonlySet<string>;
}): { agents: CustomAcpAgent[]; problems: string[] } {
  const agents: CustomAcpAgent[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of args.entries.entries()) {
    const parsed = customAcpAgentSchema.safeParse(entry);
    if (!parsed.success) {
      problems.push(`entry ${index} is not a valid agent: ${parsed.error.message}`);
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
    seen.add(providerId);
    agents.push(parsed.data);
  }
  return { agents, problems };
}

/**
 * The configured agents, from the plugin's setting and from the deprecated
 * config array. A setting entry wins over a legacy entry with the same id, so
 * moving an agent into the setting is the whole migration; the legacy entries
 * the setting does not cover are returned separately so the caller can log
 * each one it is still reading.
 */
export function mergeConfiguredAcpAgents(args: {
  configured: readonly CustomAcpAgent[];
  legacy: readonly CustomAcpAgent[];
}): { agents: CustomAcpAgent[]; legacyOnly: CustomAcpAgent[] } {
  const bySlug = new Map(args.configured.map((agent) => [agent.id, agent]));
  const legacyOnly: CustomAcpAgent[] = [];
  for (const agent of args.legacy) {
    if (bySlug.has(agent.id)) {
      continue;
    }
    legacyOnly.push(agent);
    bySlug.set(agent.id, agent);
  }
  return { agents: [...bySlug.values()], legacyOnly };
}
