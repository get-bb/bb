import { type PluginAgentContext, skillListing } from "./agent-context.js";

export interface PluginContextSize {
  pluginId: string;
  instructions: number;
  skills: number;
  tools: number;
  total: number;
}

export function measurePlugin(context: PluginAgentContext): PluginContextSize {
  const instructions =
    (context.instructions?.length ?? 0) +
    (context.dynamicInstructions?.length ?? 0) +
    context.tools.reduce(
      (sum, tool) => sum + (tool.instructions?.length ?? 0),
      0,
    );
  const skills = context.skills.reduce(
    (sum, skill) => sum + skillListing(skill).length + 1,
    0,
  );
  const tools = context.tools.reduce(
    (sum, tool) => sum + tool.description.length + tool.schemaJson.length,
    0,
  );
  return {
    pluginId: context.pluginId,
    instructions,
    skills,
    tools,
    total: instructions + skills + tools,
  };
}

export function measureAgentContext(contexts: readonly PluginAgentContext[]): {
  plugins: PluginContextSize[];
  tools: number;
  total: number;
} {
  const plugins = contexts
    .map(measurePlugin)
    .sort((left, right) => right.total - left.total);
  return {
    plugins,
    tools: plugins.reduce((sum, plugin) => sum + plugin.tools, 0),
    total: plugins.reduce((sum, plugin) => sum + plugin.total, 0),
  };
}

export const SKILL_DESCRIPTION_MAX_CHARS = 140;

export const UNLISTED_PLUGIN_CONTEXT_BUDGET = 300;

export const PLUGIN_CONTEXT_BUDGETS: Readonly<Record<string, number>> = {
  "account-pool": 150,
  "agent-annotations": 200,
  "ask-user-question": 3450,
  automations: 150,
  "bb--git": 150,
  "bb--github-pr-status": 150,
  "bb--mcp": 150,
  "bb--prompt-library": 150,
  "bb--storage-retention": 150,
  "bb-account": 150,
  "bb-ai": 150,
  "bb-guide": 2100,
  "browser-automation": 450,
  "concurrency-limit": 150,
  connect: 150,
  "environment-modal-sandbox": 150,
  "inline-vis": 200,
  memory: 550,
  "provider-acp": 150,
  "provider-claude-code": 150,
  "provider-codex": 150,
  "provider-pi": 150,
  "provider-retry": 150,
  "push-notifications": 200,
  secrets: 150,
  "simple-notes": 150,
  tasks: 150,
  "theme-preview": 150,
  "thread-list": 200,
  workflows: 2600,
};

export const DEFAULT_CONTEXT_BUDGET = 4_500;
