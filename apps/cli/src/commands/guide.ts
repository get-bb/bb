import { Command } from "commander";
import { createGuideArea } from "@bb/sdk/node";
import { CliUsageError } from "../action.js";
import { arg } from "../cli-door.js";
import { CORE_COMMAND_GROUPS } from "../command-groups.js";
import { clientCommand, mountCommands } from "../operation-doors.js";

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

type GuideRender = ReturnType<ReturnType<typeof createGuideArea>["render"]>;

type GuideOutput =
  | {
      kind: "commands";
      chapter: string;
      group: string | undefined;
      commands: GuideCommandIndexEntry[];
    }
  | { kind: "chapter"; rendered: GuideRender }
  | { kind: "overview"; content: string };

export const guideCommand = clientCommand({
  path: ["guide"],
  summary:
    "Show the BB system overview and CLI guide; `bb guide commands [group]` lists every core command on one page",
  positionals: { chapter: arg("[chapter]"), group: arg("[group]") },
  async run({ positionals: { chapter, group } }): Promise<GuideOutput> {
    if (chapter === "commands") {
      return {
        kind: "commands",
        chapter,
        group,
        commands: await buildCommandIndex(group),
      };
    }
    const rendered = createGuideArea().render({ chapter });
    if (chapter) return { kind: "chapter", rendered };
    return { kind: "overview", content: rendered.content };
  },
  json(output) {
    if (output.kind === "commands") {
      return { chapter: output.chapter, commands: output.commands };
    }
    if (output.kind === "chapter") return output.rendered;
    return { overview: output.content };
  },
  print(output) {
    if (output.kind === "chapter") return output.rendered.content;
    if (output.kind === "overview") return output.content;
    const lines = output.commands.map((entry) =>
      formatCommandIndexLine(entry, output.group !== undefined),
    );
    if (output.group !== undefined) return lines.join("\n");
    return `${lines.join("\n")}\n\nRun \`bb guide commands <group>\` (for example \`bb guide commands thread\`) to include every option. Commands contributed by plugins are listed by \`bb plugin list\`.`;
  },
});

export function registerGuideCommand(program: Command): void {
  mountCommands(program, [guideCommand], { getUrl: () => "" });
}
