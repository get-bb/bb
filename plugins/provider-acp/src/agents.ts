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
import type { PluginProviderReasoningLevel } from "@get-bb/plugin-sdk";
import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";
import type { AcpLaunchSpec } from "@get-bb/plugin-sdk/provider-bridge/acp";
import type { AcpNativeRootsResolver } from "./native-roots/resolver.js";

/** The family key every agent this plugin registers shares. */
export const ACP_FAMILY = "acp";

/** A user-configured agent's provider id. */
export function formatCustomAcpProviderId(slug: string): string {
  return `acp-${slug}`;
}

/**
 * The launch spec the bridge receives in its provider options — the kit's own
 * type, not a copy. The bridge parses this shape strictly before it starts an
 * agent, so a shape the plugin invents is a launch that fails at thread start
 * with nothing on the plugin boundary to explain it.
 */
export type { AcpLaunchSpec };

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
  reasoningLevels?: readonly PluginProviderReasoningLevel[];
  /** Usage and installation surfaces the bridge implements for this agent. */
  providerUsage?: boolean;
  providerInstallation?: boolean;
  /**
   * The agent's host-local skill roots beyond `launch.nativeSkillRoots`: an
   * env-moved config directory, config-file entries, installed vendor
   * plugins. Runs in the plugin's host entry on the workspace host, per
   * workspace. On the definition rather than the launch spec because the
   * launch spec is the wire shape the bridge parses strictly.
   */
  nativeRootsResolver?: AcpNativeRootsResolver;
}

// ---------------------------------------------------------------------------
// User-configured agents
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * The launch spec's own field schemas. Reusing them is what makes the setting
 * boundary and the bridge boundary the same boundary: reasoning levels are
 * checked against bb's ladder, skill roots are the `{ user, project }`
 * relative-path shape the daemon forwards to `host.list_commands`, and an
 * unknown key is rejected here instead of at the agent's first launch.
 */
const launchSpecFields = experimental_acpLaunchSpecSchema.shape;

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
    modelCli: launchSpecFields.modelCli,
    reasoningCli: launchSpecFields.reasoningCli,
    nativeReasoning: launchSpecFields.nativeReasoning,
    nativeSkillRoots: launchSpecFields.nativeSkillRoots,
    permissionCli: launchSpecFields.permissionCli,
    supportsManualCompaction: z.boolean().default(false),
  })
  .strict();
export type CustomAcpAgent = z.infer<typeof customAcpAgentSchema>;

/** The glyph a user-configured agent shows in the picker. */
const CUSTOM_AGENT_GLYPH = "Toolbox";

/**
 * The definition a configured entry registers.
 *
 * `shipped` is the known agent this entry REPLACES (same provider id), when
 * there is one. A replacing entry states how to launch the agent, not where
 * that agent keeps its skills, so the two skill-root facts carry over from
 * the shipped definition:
 *
 * - `launch.nativeSkillRoots`: the shipped roots, unless the entry sets its
 *   own, which then stand alone.
 * - `nativeRootsResolver`: always. The resolver reads the agent's host
 *   config (its home directory, compat switches, configured paths, plugins),
 *   and a private build or a different command still has that config.
 *
 * Nothing else carries over: the entry is the user's own copy, listed
 * always, with bb's generic glyph.
 */
export function customAcpAgentDefinition(
  agent: CustomAcpAgent,
  shipped?: AcpAgentDefinition,
): AcpAgentDefinition {
  const nativeSkillRoots =
    agent.nativeSkillRoots ?? shipped?.launch.nativeSkillRoots;
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
      // The launch fields parsed straight through: they came out of the
      // launch spec's own schemas, so they are already the shape the bridge
      // parses. `modelCli` is undefined here when the setting listed no
      // `listArgs`, which is that schema's own rule.
      ...(agent.modelCli === undefined ? {} : { modelCli: agent.modelCli }),
      ...(agent.reasoningCli === undefined
        ? {}
        : { reasoningCli: agent.reasoningCli }),
      ...(agent.nativeReasoning === undefined
        ? {}
        : { nativeReasoning: agent.nativeReasoning }),
      ...(nativeSkillRoots === undefined ? {} : { nativeSkillRoots }),
      ...(agent.permissionCli === undefined
        ? {}
        : { permissionCli: agent.permissionCli }),
    },
    ...(agent.dialect === undefined ? {} : { dialect: agent.dialect }),
    ...(shipped?.nativeRootsResolver === undefined
      ? {}
      : { nativeRootsResolver: shipped.nativeRootsResolver }),
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
    // Belt and braces on the shape: the setting schema is built from the
    // launch spec's own fields, so this can only fail if the two drift. It
    // fails HERE, naming the entry, instead of at the agent's first thread
    // start, where the bridge answers INVALID_PARAMS with no entry to name.
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
