/**
 * Merging the two sources of user-configured agents.
 *
 * While the deprecation window is open a user's agents can come from this
 * plugin's `customAgents` setting or from the old `customAcpAgents` array in
 * config.json. The precedence rule — a setting entry wins over a legacy entry
 * with the same id — is the one thing a user relies on while both exist, so
 * it lives in a pure function the tests can drive, and the plugin's server
 * module does only the reading and the logging.
 */

import {
  customAcpAgentDefinition,
  formatCustomAcpProviderId,
  parseCustomAcpAgents,
  type AcpAgentDefinition,
} from "./agents.js";
import { legacyAgentDeprecationMessage } from "./legacy-config.js";

export interface ResolveConfiguredAcpAgentsArgs {
  /** The raw `customAgents` setting text, exactly as stored. */
  settingValue: string | undefined;
  /** The entries the deprecated config file declared, already `logo`-free. */
  legacyEntries: readonly unknown[];
  /** What went wrong reading that file, if anything. */
  legacyProblem?: string;
  /** Provider ids a configured agent may not take. */
  reservedProviderIds: ReadonlySet<string>;
  /**
   * The agents bb ships. A configured entry with one of their ids replaces
   * that agent and inherits its skill roots (see `customAcpAgentDefinition`).
   */
  shippedAgents: readonly AcpAgentDefinition[];
}

export interface ResolveConfiguredAcpAgentsResult {
  agents: AcpAgentDefinition[];
  /** Everything the caller logs, in the order it happened. */
  warnings: string[];
}

export function resolveConfiguredAcpAgents(
  args: ResolveConfiguredAcpAgentsArgs,
): ResolveConfiguredAcpAgentsResult {
  const warnings: string[] = [];
  const entries: unknown[] = [];
  const trimmed = args.settingValue?.trim() ?? "";
  if (trimmed.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      parsed = undefined;
      warnings.push(
        `The ACP "customAgents" setting is not valid JSON; ignoring it: ${String(error)}`,
      );
    }
    if (parsed !== undefined) {
      if (Array.isArray(parsed)) {
        entries.push(...parsed);
      } else {
        warnings.push(
          'The ACP "customAgents" setting must be a JSON array; ignoring it.',
        );
      }
    }
  }

  const configured = parseCustomAcpAgents({
    entries,
    reservedProviderIds: args.reservedProviderIds,
  });
  for (const problem of configured.problems) {
    warnings.push(`ACP custom agent setting: ${problem}`);
  }

  if (args.legacyProblem !== undefined) {
    warnings.push(`Deprecated ACP agent config: ${args.legacyProblem}`);
  }
  const legacy = parseCustomAcpAgents({
    entries: args.legacyEntries,
    reservedProviderIds: args.reservedProviderIds,
  });
  for (const problem of legacy.problems) {
    warnings.push(`Deprecated ACP agent config: ${problem}`);
  }

  // The setting wins: a user who moved an agent across sees one agent, not a
  // duplicate id and not the stale copy, and gets no deprecation notice for
  // the entry they already migrated.
  const bySlug = new Map(configured.agents.map((agent) => [agent.id, agent]));
  for (const agent of legacy.agents) {
    if (bySlug.has(agent.id)) {
      continue;
    }
    warnings.push(legacyAgentDeprecationMessage(agent));
    bySlug.set(agent.id, agent);
  }
  const shippedById = new Map(
    args.shippedAgents.map((agent) => [agent.id, agent]),
  );
  return {
    agents: [...bySlug.values()].map((agent) =>
      customAcpAgentDefinition(
        agent,
        shippedById.get(formatCustomAcpProviderId(agent.id)),
      ),
    ),
    warnings,
  };
}
