import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginCliCommandInfo } from "./plugin-api.js";

/**
 * Server-generated `plugin-commands` skill (design §4.4): teaches agents the
 * `bb` subcommands installed plugins contribute, one section per plugin, at
 * near-zero context cost. Lives under <dataDir>/skills-generated (a distinct
 * root resolved with the data-dir skill tier mechanics) and exists only while
 * the plugins experiment is on and at least one CLI command is registered —
 * the plugin service rewrites or removes it on load/reload/toggle.
 */
export interface PluginCliContribution {
  pluginId: string;
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
}

const SKILL_NAME = "plugin-commands";

export function generatedSkillsRootPath(dataDir: string): string {
  return join(dataDir, "skills-generated");
}

export function pluginCommandsSkillDir(dataDir: string): string {
  return join(generatedSkillsRootPath(dataDir), SKILL_NAME);
}

export function renderPluginCommandsSkill(
  contributions: readonly PluginCliContribution[],
): string {
  const sections = contributions.map((contribution) => {
    const lines = [
      `## bb ${contribution.name} — ${contribution.summary}`,
      "",
      `Contributed by plugin \`${contribution.pluginId}\`. Run \`bb ${contribution.name} --help\` for details;`,
      `\`bb plugin run ${contribution.pluginId} <args...>\` is the explicit equivalent.`,
    ];
    if (contribution.commands.length > 0) {
      lines.push("");
      for (const command of contribution.commands) {
        lines.push(`- \`${command.usage}\` — ${command.summary}`);
      }
    }
    return lines.join("\n");
  });
  return [
    "---",
    `name: ${SKILL_NAME}`,
    "description: CLI commands contributed by installed BB plugins. Use when a task involves one of the plugin commands listed here; run them with bash like any other bb command.",
    "---",
    "",
    "# Plugin Commands",
    "",
    "Installed BB plugins contribute these `bb` subcommands. Invoke them with",
    "bash exactly like core `bb` commands; they run server-side.",
    "",
    ...sections,
    "",
  ].join("\n");
}

/**
 * Write the skill when there is at least one contribution; remove it
 * otherwise (an absent directory is how "no plugin commands" reaches
 * resolveInjectedSkillSources, which tolerates a missing root).
 */
export async function syncPluginCommandsSkill(
  dataDir: string,
  contributions: readonly PluginCliContribution[],
): Promise<void> {
  const dir = pluginCommandsSkillDir(dataDir);
  if (contributions.length === 0) {
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    renderPluginCommandsSkill(contributions),
    "utf8",
  );
}
