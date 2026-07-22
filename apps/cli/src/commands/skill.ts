import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import type { ContextSnapshot } from "../context-env.js";
import { renderBorderlessTable } from "../table.js";
import {
  confirmDestructiveAction,
  outputJson,
  type JsonOutputOptions,
} from "./helpers.js";

interface SkillWorkspaceOptions extends JsonOutputOptions {
  environment?: string;
  project?: string;
}

interface SkillDeleteOptions extends SkillWorkspaceOptions {
  yes?: boolean;
}

interface SkillUpdateOptions extends SkillWorkspaceOptions {
  file: string;
  revision: string;
}

interface SkillSearchOptions extends JsonOutputOptions {
  page?: string;
  perPage?: string;
}

function projectId(
  options: SkillWorkspaceOptions,
  context: ContextSnapshot,
): string {
  return options.project ?? context.projectId ?? PERSONAL_PROJECT_ID;
}

function environmentId(options: SkillWorkspaceOptions): string | null {
  return options.environment ?? null;
}

function parseNonnegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a nonnegative integer, received "${value}".`);
  }
  return parsed;
}

function addWorkspaceOptions(command: Command): Command {
  return command
    .option(
      "--project <id>",
      "Project ID (defaults to BB_PROJECT_ID or personal)",
    )
    .option("--environment <id>", "Project environment workspace")
    .option("--json", "Print machine-readable JSON output");
}

export function registerSkillCommands(
  program: Command,
  getUrl: () => string,
  getContext: () => ContextSnapshot,
): void {
  const skill = program
    .command("skill")
    .description("List, inspect, edit, install, and remove skills");

  addWorkspaceOptions(skill.command("list"))
    .description("List installed and discovered skills")
    .action(
      action(async (options: SkillWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.list({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
        });
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "NAME", "SCOPE", "PROVIDER", "EDITABLE", "PATH"],
              colWidths: [72, 24, 18, 14, 10, 48],
              trimTrailingWhitespace: true,
            },
            result.skills.map((entry) => [
              entry.id,
              entry.name,
              entry.scope,
              entry.provider ?? "bb",
              entry.manageable ? "yes" : "no",
              entry.filePath,
            ]),
          ),
        );
      }),
    );

  addWorkspaceOptions(skill.command("show <skill-id>"))
    .description("Print an installed skill file")
    .option("--path <path>", "Skill-relative file path", "SKILL.md")
    .action(
      action(
        async (
          skillId: string,
          options: SkillWorkspaceOptions & { path: string },
        ) => {
          const result = await createCliBbSdk(getUrl()).skills.getContent({
            projectId: projectId(options, getContext()),
            environmentId: environmentId(options),
            skillId,
            path: options.path,
          });
          if (outputJson(options, result)) return;
          console.error(`Revision: ${result.revision}`);
          process.stdout.write(result.content);
        },
      ),
    );

  addWorkspaceOptions(skill.command("files <skill-id>"))
    .description("List files included in an installed skill")
    .action(
      action(async (skillId: string, options: SkillWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.listFiles({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
        });
        if (outputJson(options, result)) return;
        for (const path of result.files) console.log(path);
        if (result.truncated) console.error("File list truncated.");
      }),
    );

  addWorkspaceOptions(skill.command("update <skill-id>"))
    .description("Replace an editable skill's SKILL.md from a local file")
    .requiredOption("--file <path>", "Local SKILL.md to upload")
    .requiredOption(
      "--revision <sha256>",
      "Revision returned by bb skill show --json",
    )
    .action(
      action(async (skillId: string, options: SkillUpdateOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.update({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
          content: await readFile(options.file, "utf8"),
          revision: options.revision,
        });
        if (outputJson(options, result)) return;
        console.log(`Updated ${result.filePath}`);
      }),
    );

  addWorkspaceOptions(skill.command("delete <skill-id>"))
    .description("Delete an editable user-owned skill")
    .option("--yes", "Skip the confirmation prompt")
    .action(
      action(async (skillId: string, options: SkillDeleteOptions) => {
        if (
          !options.yes &&
          !(await confirmDestructiveAction(
            `Delete ${skillId}? This cannot be undone.`,
          ))
        ) {
          console.log("Aborted.");
          return;
        }
        const result = await createCliBbSdk(getUrl()).skills.remove({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
        });
        if (outputJson(options, result)) return;
        console.log(`Deleted ${result.deletedPath}`);
      }),
    );

  skill
    .command("search [query]")
    .description("Search the skills.sh registry")
    .option("--page <number>", "Zero-based result page", "0")
    .option("--per-page <number>", "Results per page", "24")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (query: string | undefined, options: SkillSearchOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.registry.search({
          query,
          page: parseNonnegativeInteger(options.page, 0),
          perPage: parseNonnegativeInteger(options.perPage, 24),
        });
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "INSTALLS", "STARS", "SUMMARY"],
              colWidths: [48, 12, 10, 48],
              trimTrailingWhitespace: true,
            },
            result.skills.map((entry) => [
              entry.id,
              String(entry.installs),
              entry.stars === null ? "—" : String(entry.stars),
              entry.summary ?? "",
            ]),
          ),
        );
      }),
    );

  skill
    .command("registry")
    .description("Inspect skills.sh registry entries")
    .command("detail <registry-skill-id>")
    .description("Show registry metadata and the bounded file preview")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (registrySkillId: string, options: JsonOutputOptions) => {
        const registry = createCliBbSdk(getUrl()).skills.registry;
        const skillEntry = await registry.get({ registrySkillId });
        const detail = await registry.detail({
          source: skillEntry.source,
          skillId: skillEntry.skillId,
        });
        const result = { skill: skillEntry, detail };
        if (outputJson(options, result)) return;
        console.log(`Name: ${skillEntry.name}`);
        console.log(`ID: ${skillEntry.id}`);
        console.log(`Source: ${skillEntry.source}`);
        console.log(`Installs: ${skillEntry.installs}`);
        console.log(`Stars: ${skillEntry.stars ?? "—"}`);
        console.log(`URL: ${skillEntry.url}`);
        if (skillEntry.summary) console.log(`Summary: ${skillEntry.summary}`);
        console.log(`Revision: ${detail.hash ?? "unknown"}`);
        if (detail.files === null) {
          console.log("Files: unavailable");
          return;
        }
        for (const file of detail.files) {
          console.log(`\n--- ${file.path} ---`);
          process.stdout.write(file.contents);
          if (!file.contents.endsWith("\n")) process.stdout.write("\n");
        }
      }),
    );

  skill
    .command("install <registry-skill-id>")
    .description("Install a canonical skills.sh entry into bb user skills")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (registrySkillId: string, options: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.registry.install({
          registrySkillId,
        });
        if (outputJson(options, result)) return;
        console.log(`Installed ${result.filePath}`);
      }),
    );
}
