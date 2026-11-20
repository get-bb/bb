import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { BUNDLED_PLUGINS } from "../../../apps/server/src/services/plugins/builtin-registry.js";
import {
  formatAgentInstructions,
  type AgentInstructionSection,
} from "../../../apps/server/src/services/threads/agent-instruction-sections.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGINS_ROOT = join(REPO_ROOT, "plugins");

export interface AgentSkill {
  name: string;
  description: string;
  path: string;
}

export interface AgentTool {
  name: string;
  description: string;
  instructions: string | null;
  schemaJson: string;
}

export interface PluginAgentContext {
  pluginId: string;
  enabledByDefault: boolean;
  instructions: string | null;
  dynamicInstructions: string | null;
  tools: AgentTool[];
  skills: AgentSkill[];
}

const packageSchema = z.object({
  bb: z.object({ server: z.string().optional() }).optional(),
});

const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const pluginModuleSchema = z.object({
  default: z.custom<(bb: BbPluginApi) => unknown>(
    (value) => typeof value === "function",
    "Plugin server entry has no default export function",
  ),
});

const toolRegistrationSchema = z.object({
  name: z.string(),
  description: z.string(),
  instructions: z.string().nullable(),
  inputSchema: z.unknown(),
});

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return z.string().parse(JSON.parse(trimmed));
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) throw new Error("SKILL.md has no frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (field !== null) fields[field[1]!] = unquote(field[2]!);
  }
  return skillFrontmatterSchema.parse(fields);
}

function readSkills(pluginRoot: string): AgentSkill[] {
  const skillsRoot = join(pluginRoot, "skills");
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(skillsRoot, entry.name);
      const frontmatter = parseSkillFrontmatter(
        readFileSync(join(path, "SKILL.md"), "utf8"),
      );
      return { ...frontmatter, path };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function declaredIconNames(pluginRoot: string): string[] {
  const iconsRoot = join(pluginRoot, "icons");
  if (!existsSync(iconsRoot)) return [];
  return readdirSync(iconsRoot)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.replace(/\.svg$/, ""));
}

export async function loadPluginAgentContexts(
  options: {
    nativeUserQuestion?: boolean;
    parentThreadId?: string | null;
  } = {},
): Promise<PluginAgentContext[]> {
  const contexts: PluginAgentContext[] = [];
  for (const plugin of BUNDLED_PLUGINS) {
    const pluginRoot = join(PLUGINS_ROOT, plugin.name);
    const manifest = packageSchema.parse(
      JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")),
    );
    const serverEntry = manifest.bb?.server;
    const skills = readSkills(pluginRoot);
    const context: PluginAgentContext = {
      pluginId: plugin.pluginId,
      enabledByDefault: plugin.autoInstall && plugin.defaultEnabled,
      instructions: null,
      dynamicInstructions: null,
      tools: [],
      skills,
    };
    contexts.push(context);
    if (serverEntry === undefined) continue;
    const { bb, harness } = createFakePluginHost({
      pluginId: plugin.pluginId,
      agentSkillIds: skills.map((skill) => skill.name),
      experimental_declaredIconNames: declaredIconNames(pluginRoot),
      sdk: { hosts: { list: async () => [] } },
    });
    try {
      const module: unknown = await import(
        pathToFileURL(join(pluginRoot, serverEntry)).href
      );
      const activate = pluginModuleSchema.parse(module).default;
      await activate(bb);
      const registrations = harness.registrations;
      context.instructions =
        registrations.instructionProvider?.({
          threadId: "thr_eval",
          projectId: "proj_eval",
        }) ?? null;
      const configured = await harness.behavior.resolveAgentConfiguration(
        makePluginAgentConfigurationContext({
          thread: {
            id: "thr_eval_self",
            title: null,
            parentThreadId: options.parentThreadId ?? null,
            sourceThreadId: null,
          },
          provider: {
            id: "claude-code",
            model: "claude-sonnet-5-5",
            capabilities: {
              supportsNativeUserQuestion: options.nativeUserQuestion ?? true,
            },
          },
        }),
      );
      context.dynamicInstructions = configured.instructions;
      context.tools = configured.tools.map((tool) =>
        toAgentTool(toolRegistrationSchema.parse(tool)),
      );
      const selectedSkills = new Set(configured.skills);
      context.skills = skills.filter((skill) => selectedSkills.has(skill.name));
    } finally {
      await harness.lifecycle.dispose();
    }
  }
  return contexts;
}

function toAgentTool(tool: z.infer<typeof toolRegistrationSchema>): AgentTool {
  return {
    name: tool.name,
    description: tool.description,
    instructions: tool.instructions,
    schemaJson: JSON.stringify(tool.inputSchema),
  };
}

export function enabledContexts(
  contexts: readonly PluginAgentContext[],
  extraPluginIds: readonly string[] = [],
): PluginAgentContext[] {
  const extra = new Set(extraPluginIds);
  return contexts.filter(
    (context) => context.enabledByDefault || extra.has(context.pluginId),
  );
}

export function buildAgentInstructions(
  contexts: readonly PluginAgentContext[],
): string {
  const sorted = [...contexts].sort((left, right) =>
    left.pluginId.localeCompare(right.pluginId),
  );
  const sections: AgentInstructionSection[] = [];
  for (const context of sorted) {
    for (const tool of context.tools) {
      if (tool.instructions) {
        sections.push({
          kind: "tool",
          pluginId: context.pluginId,
          toolName: tool.name,
          text: tool.instructions,
        });
      }
    }
  }
  for (const context of sorted) {
    if (context.instructions !== null && context.instructions.trim() !== "") {
      sections.push({
        kind: "plugin",
        pluginId: context.pluginId,
        text: context.instructions,
      });
    }
  }
  for (const context of sorted) {
    if (context.dynamicInstructions !== null) {
      sections.push({
        kind: "dynamic",
        pluginId: context.pluginId,
        text: context.dynamicInstructions,
      });
    }
  }
  return formatAgentInstructions(sections);
}

export function skillListing(skill: AgentSkill): string {
  return `- bb-global-skills:${skill.name}: ${skill.description}`;
}
