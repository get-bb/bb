import {
  customAcpAgentDefinition,
  formatCustomAcpProviderId,
  parseCustomAcpAgents,
  type AcpAgentDefinition,
} from "./agents.js";

export interface ResolveConfiguredAcpAgentsArgs {
  settingValue: string | undefined;
  reservedProviderIds: ReadonlySet<string>;
  shippedAgents: readonly AcpAgentDefinition[];
}

export interface ResolveConfiguredAcpAgentsResult {
  agents: AcpAgentDefinition[];
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

  const shippedById = new Map(
    args.shippedAgents.map((agent) => [agent.id, agent]),
  );
  return {
    agents: configured.agents.map((agent) =>
      customAcpAgentDefinition(
        agent,
        shippedById.get(formatCustomAcpProviderId(agent.id)),
      ),
    ),
    warnings,
  };
}
