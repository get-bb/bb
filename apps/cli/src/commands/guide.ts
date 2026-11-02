import { Command } from "commander";
import { createGuideArea } from "@bb/sdk/node";
import { action, CliUsageError } from "../action.js";
import { CORE_COMMAND_GROUPS } from "../command-groups.js";
import { outputJson } from "./helpers.js";

interface GuideCommandOptions {
  json?: boolean;
}

export interface GuideCommandIndexEntry {
  aliases: string[];
  arguments: string;
  description: string;
  options: string[];
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
    if (nested.length > 0) return nested;
    return [
      {
        aliases: child.aliases(),
        arguments: argumentUsage(child),
        description: child.description(),
        options: child.options
          .filter((option) => !option.hidden)
          .map((option) => option.flags.replace(/^-\w, /u, "")),
        path: path.join(" "),
      },
    ];
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

export function registerGuideCommand(program: Command): void {
  program
    .command("guide [chapter] [group]")
    .description(
      "Show the BB system overview and CLI guide; `bb guide commands [group]` lists every core command on one page",
    )
    .option("--json", "Print machine-readable JSON output")
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
}
