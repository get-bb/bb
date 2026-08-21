/**
 * The ACP providers plugin.
 *
 * The plugin owns its agents: the list bb ships knowledge of, and the ones a
 * user configures in this plugin's own settings. Both become registrations
 * here, at runtime, and a settings change re-registers without a restart —
 * one plugin, N providers, no core table of ACP agents anywhere.
 *
 * The host side is one re-export of the published kit (`src/host.ts`), so
 * this file is the whole of bb's ACP privilege: a list of agents anyone could
 * have written.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  customAcpAgentDefinition,
  parseCustomAcpAgents,
  type AcpAgentDefinition,
} from "./src/agents.js";
import { acpProviderDeclaration } from "./src/declaration.js";
import {
  KNOWN_ACP_AGENTS,
  KNOWN_ACP_PROVIDER_IDS,
} from "./src/known-agents.js";
import {
  legacyAgentDeprecationMessage,
  readLegacyCustomAcpAgents,
} from "./src/legacy-config.js";

export { CURSOR_PRIMARY_MODELS } from "./src/known-agents.js";

const CUSTOM_AGENTS_SETTING_DESCRIPTION =
  'A JSON array of ACP agents to add, for example [{"id":"amp","displayName":"Amp","command":"amp","args":["acp"]}]. ' +
  'Each agent needs "id" (lowercase letters, digits and dashes), "displayName" and "command"; ' +
  '"args", "env", "cwd", "modelCli", "reasoningCli", "nativeReasoning", "nativeSkillRoots" and "supportsManualCompaction" are optional. ' +
  "The provider id is acp-<id> and never changes once a thread has used it.";

/**
 * The configured agents, from this plugin's setting and — until the
 * deprecation window closes — from the old `customAcpAgents` array in
 * config.json. A setting entry wins over a legacy entry with the same id, so
 * moving an agent into the setting is the whole migration.
 */
async function resolveCustomAgents(
  bb: BbPluginApi,
  settingValue: string | undefined,
): Promise<AcpAgentDefinition[]> {
  const entries: unknown[] = [];
  const trimmed = settingValue?.trim() ?? "";
  if (trimmed.length > 0) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        bb.log.warn(
          'The ACP "customAgents" setting must be a JSON array; ignoring it.',
        );
      } else {
        entries.push(...parsed);
      }
    } catch (error) {
      bb.log.warn(
        `The ACP "customAgents" setting is not valid JSON; ignoring it: ${String(error)}`,
      );
    }
  }
  const configured = parseCustomAcpAgents({
    entries,
    reservedProviderIds: KNOWN_ACP_PROVIDER_IDS,
  });
  for (const problem of configured.problems) {
    bb.log.warn(`ACP custom agent setting: ${problem}`);
  }

  const legacy = await readLegacyCustomAcpAgents();
  if (legacy.problem !== undefined) {
    bb.log.warn(`Deprecated ACP agent config: ${legacy.problem}`);
  }
  const legacyAgents = parseCustomAcpAgents({
    entries: legacy.entries,
    reservedProviderIds: KNOWN_ACP_PROVIDER_IDS,
  });
  for (const problem of legacyAgents.problems) {
    bb.log.warn(`Deprecated ACP agent config: ${problem}`);
  }

  const bySlug = new Map(configured.agents.map((agent) => [agent.id, agent]));
  for (const agent of legacyAgents.agents) {
    if (bySlug.has(agent.id)) {
      continue;
    }
    bb.log.warn(legacyAgentDeprecationMessage(agent));
    bySlug.set(agent.id, agent);
  }
  return [...bySlug.values()].map(customAcpAgentDefinition);
}

export default async function acpProvidersPlugin(
  bb: BbPluginApi,
): Promise<void> {
  for (const agent of KNOWN_ACP_AGENTS) {
    bb.providers.register(acpProviderDeclaration(agent));
  }

  const settings = bb.settings.define({
    customAgents: {
      type: "string",
      label: "Custom agents",
      description: CUSTOM_AGENTS_SETTING_DESCRIPTION,
      default: "",
    },
  });

  // Configured agents are re-registered whenever the setting changes: the
  // registry hands back a disposer per registration, and re-registering an
  // id this plugin already owns is only allowed after that disposer runs.
  let disposeCustomAgents: (() => void)[] = [];
  async function registerCustomAgents(settingValue: string): Promise<void> {
    for (const dispose of disposeCustomAgents.splice(0)) {
      dispose();
    }
    const agents = await resolveCustomAgents(bb, settingValue);
    disposeCustomAgents = agents.map(
      (agent) => bb.providers.register(acpProviderDeclaration(agent)).dispose,
    );
    if (agents.length > 0) {
      bb.log.info(`Registered ${agents.length} configured ACP agent(s).`);
    }
  }

  const initial = await settings.get();
  await registerCustomAgents(initial.customAgents);
  settings.onChange((next) => {
    void registerCustomAgents(next.customAgents).catch((error: unknown) => {
      bb.log.error(`Could not re-register the configured ACP agents: ${String(error)}`);
    });
  });
  bb.onDispose(() => {
    for (const dispose of disposeCustomAgents.splice(0)) {
      dispose();
    }
  });
}
