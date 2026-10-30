import { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createGuideArea,
  parseGuideSearchQuery,
  type GuideSearchResponse,
} from "@bb/sdk/node";
import { action, CliUsageError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { CORE_COMMAND_GROUPS } from "../command-groups.js";
import type { ContextSnapshot } from "../context-env.js";
import { contextEnvironmentId } from "../context-hints.js";
import { outputJson } from "./helpers.js";

interface GuideCommandOptions {
  json?: boolean;
}

interface GuideCommandOptionDetail {
  flags: string;
  description: string;
}

interface GuideSearchCommandOptions {
  environment?: string;
  json?: boolean;
  limit?: string;
  project?: string;
}

export interface GuideCommandIndexEntry {
  aliases: string[];
  arguments: string;
  description: string;
  options: string[];
  optionDetails: GuideCommandOptionDetail[];
  path: string;
}

function argumentUsage(command: Command): string {
  return command.registeredArguments
    .map((argument) => {
      const name = `${argument.name()}${argument.variadic ? "..." : ""}`;
      return argument.required ? `<${name}>` : `[${name}]`;
    })
    .join(" ");
}

function collectCommandIndex(
  command: Command,
  prefix: readonly string[],
): GuideCommandIndexEntry[] {
  return command.commands.flatMap((child) => {
    if (child.name() === "help") return [];
    const path = [...prefix, child.name()];
    const nested = collectCommandIndex(child, path);
    const optionDetails = child.options
      .filter((option) => !option.hidden)
      .map((option) => ({
        flags: option.flags.replace(/^-\w, /u, ""),
        description: option.description,
      }));
    const entry = {
      aliases: child.aliases(),
      arguments: argumentUsage(child),
      description: child.description(),
      options: optionDetails.map((option) => option.flags),
      optionDetails,
      path: path.join(" "),
    };
    if (nested.length === 0) return [entry];
    return child.registeredArguments.length > 0 ? [entry, ...nested] : nested;
  });
}

export async function buildCommandIndex(
  group: string | undefined,
): Promise<GuideCommandIndexEntry[]> {
  const program = new Command();
  const deps = {
    getUrl: () => "",
    getContext: () => ({ serverUrl: "" }),
  };
  for (const entry of CORE_COMMAND_GROUPS) {
    const register = await entry.load();
    register(program, deps);
  }
  const entries = collectCommandIndex(program, []);
  if (group === undefined) return entries;
  const filtered = entries.filter(
    (entry) => entry.path === group || entry.path.startsWith(`${group} `),
  );
  if (filtered.length === 0) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: `Command groups: ${CORE_COMMAND_GROUPS.map((entry) => entry.name).join(", ")}`,
      message: `Unknown command group '${group}'.`,
    });
  }
  return filtered;
}

function formatCommandIndexLine(
  entry: GuideCommandIndexEntry,
  withOptions: boolean,
): string {
  const names = [entry.path, ...entry.aliases.map((alias) => `|${alias}`)];
  const head = [`bb ${names.join("")}`, entry.arguments]
    .filter((part) => part.length > 0)
    .join(" ");
  const options =
    withOptions && entry.options.length > 0
      ? `  ${entry.options.map((option) => `[${option}]`).join(" ")}`
      : "";
  return `${head}${options}\n    ${entry.description}`;
}

function parseSearchLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/u.test(raw.trim())) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: "Pass a whole number, for example --limit 5.",
      message: `Invalid --limit '${raw}'.`,
    });
  }
  return Number(raw.trim());
}

function formatSearchResults(response: GuideSearchResponse): string {
  const lines = response.results.flatMap((result, index) => {
    const heading = [result.title, result.section]
      .filter((part) => part !== null)
      .join(" › ");
    return [
      `${index + 1}. [${result.source}] ${heading}`,
      `   ${result.location}`,
      ...(result.snippet.length > 0 ? [`   ${result.snippet}`] : []),
    ];
  });
  if (lines.length === 0) {
    lines.push(`No matches for '${response.query}'.`);
  }
  if (!response.docs.ok) {
    lines.push(
      "",
      `Online docs not searched (${response.docs.url}: ${response.docs.error}).`,
    );
  }
  if (!response.skills.ok) {
    lines.push(
      ...(response.docs.ok ? [""] : []),
      `Skills not searched because no bb server was reachable (${response.skills.error}); local results are from the bb guide chapters only.`,
    );
  }
  return lines.join("\n");
}

function registerGuideSearchCommand(
  guide: Command,
  getUrl: () => string,
  getContext: () => ContextSnapshot,
): void {
  guide
    .command("search <question>")
    .description(
      "Search the online docs, the bb guide chapters, and the skills `bb skill list` shows in one ranked list",
    )
    .option("--limit <n>", "Most results to print, 1-50 (default 10)")
    .option(
      "--project <id>",
      "Project whose skills to search (defaults to BB_PROJECT_ID or personal)",
    )
    .option(
      "--environment <id>",
      "Project environment whose skills to search (defaults to BB_ENVIRONMENT_ID)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (question: string, opts: GuideSearchCommandOptions) => {
        let parsed: ReturnType<typeof parseGuideSearchQuery>;
        try {
          parsed = parseGuideSearchQuery({
            query: question,
            limit: parseSearchLimit(opts.limit),
          });
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError({
            code: "invalid_value",
            hint: 'bb guide search "<question>" [--limit <n>] [--json]',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const guide = createGuideArea({
          skills: createCliBbSdk(getUrl()).skills,
        });
        const response = await guide.search({
          ...parsed,
          projectId:
            opts.project ?? getContext().projectId ?? PERSONAL_PROJECT_ID,
          environmentId: opts.environment ?? contextEnvironmentId(),
        });
        if (outputJson(opts, response)) return;
        console.log(formatSearchResults(response));
      }),
    );
}

export function registerGuideCommand(
  program: Command,
  getUrl: () => string,
  getContext: () => ContextSnapshot,
): void {
  const guide = program
    .command("guide [chapter] [group]")
    .description(
      "Show the BB system overview and CLI guide; `bb guide commands [group]` lists every core command on one page; `bb guide search <question>` searches the docs, guide, and skills",
    )
    .option("--json", "Print machine-readable JSON output")
    .enablePositionalOptions()
    .action(
      action(
        async (
          chapter: string | undefined,
          group: string | undefined,
          opts: GuideCommandOptions,
        ) => {
          if (chapter === "commands") {
            const commands = await buildCommandIndex(group);
            if (outputJson(opts, { chapter, commands })) return;
            const lines = commands.map((entry) =>
              formatCommandIndexLine(entry, group !== undefined),
            );
            console.log(lines.join("\n"));
            if (group === undefined) {
              console.log(
                "\nRun `bb guide commands <group>` (for example `bb guide commands thread`) to include every option. Commands contributed by plugins are listed by `bb plugin list`.",
              );
            }
            return;
          }
          const rendered = createGuideArea().render({ chapter });
          if (chapter) {
            if (outputJson(opts, rendered)) return;
            console.log(rendered.content);
            return;
          }

          if (outputJson(opts, { overview: rendered.content })) return;
          console.log(rendered.content);
        },
      ),
    );
  registerGuideSearchCommand(guide, getUrl, getContext);
}
