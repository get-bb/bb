import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginCliCall } from "@bb/domain/plugin-cli";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "@get-bb/plugin-sdk";
import type { PluginCliCommandInfo } from "./plugin-api.js";

/**
 * Server-generated `plugin-commands` skill (design §4.4): teaches agents the
 * `bb` subcommands installed plugins contribute, one section per plugin, at
 * near-zero context cost. Lives under <dataDir>/skills-generated (a distinct
 * root resolved with the data-dir skill tier mechanics) and exists only while
 * at least one CLI command is registered — the plugin service rewrites or
 * removes it on load/reload/toggle.
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

function renderPluginCommandsSkill(
  contributions: readonly PluginCliContribution[],
): string {
  const sections = contributions.map((contribution) => {
    const direct = `bb ${contribution.name}`;
    const invocation = pluginCliCall(contribution.pluginId, contribution.name);
    const lines = [
      `## ${invocation} — ${contribution.summary}`,
      "",
      `Contributed by plugin \`${contribution.pluginId}\`. Run \`${invocation} --help\` for details.`,
      `\`bb plugin run ${contribution.pluginId} <args...>\` is always available.`,
    ];
    if (contribution.commands.length > 0) {
      lines.push("");
      for (const command of contribution.commands) {
        const usage =
          command.usage === direct || command.usage.startsWith(`${direct} `)
            ? `${invocation}${command.usage.slice(direct.length)}`
            : command.usage;
        lines.push(`- \`${usage}\` — ${command.summary}`);
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
    "Installed BB plugins contribute commands; core-name collisions use the explicit plugin-id form while others use a top-level `bb` subcommand.",
    `Combined stdout and stderr is capped at ${PLUGIN_CLI_OUTPUT_MAX_BYTES} UTF-8 bytes. Above-limit`,
    "results fail atomically as `plugin_cli_output_too_large` and are never clipped;",
    "use pagination or file/streaming commands for large results.",
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
