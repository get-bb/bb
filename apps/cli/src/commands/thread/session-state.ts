import type {
  ProviderCommand,
  ThreadTimelineSessionOption,
} from "@bb/server-contract";
import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface SessionStateCommandOptions {
  self?: boolean;
  json?: boolean;
}

interface SessionOptionsCommandOptions extends SessionStateCommandOptions {
  set?: string[];
  clear?: string[];
}

function collectRepeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseSessionOptionAssignments(args: {
  options: readonly ThreadTimelineSessionOption[] | null;
  set: readonly string[];
  clear: readonly string[];
}): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {};
  for (const assignment of args.set) {
    const separator = assignment.indexOf("=");
    const optionId = separator === -1 ? "" : assignment.slice(0, separator);
    if (optionId === "") {
      throw new Error(
        `Invalid --set '${assignment}'. Expected <option-id>=<value>.`,
      );
    }
    const raw = assignment.slice(separator + 1);
    const option = args.options?.find((candidate) => candidate.id === optionId);
    if (option?.type === "boolean") {
      if (raw !== "true" && raw !== "false") {
        throw new Error(
          `Session option '${optionId}' takes true or false, not '${raw}'.`,
        );
      }
      patch[optionId] = raw === "true";
      continue;
    }
    patch[optionId] = raw;
  }
  for (const optionId of args.clear) {
    if (Object.hasOwn(patch, optionId)) {
      throw new Error(
        `Session option '${optionId}' cannot be both set and cleared.`,
      );
    }
    patch[optionId] = null;
  }
  return patch;
}

export function parseSpawnSessionOptions(
  assignments: readonly string[],
): Record<string, string | boolean> {
  const selections: Record<string, string | boolean> = {};
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    const optionId = separator === -1 ? "" : assignment.slice(0, separator);
    const raw = assignment.slice(separator + 1);
    if (optionId === "" || raw === "") {
      throw new Error(
        `Invalid --option '${assignment}'. Expected <option-id>=<value>.`,
      );
    }
    selections[optionId] =
      raw === "true" ? true : raw === "false" ? false : raw;
  }
  return selections;
}

export function formatThreadProviderCommands(
  commands: readonly ProviderCommand[] | null,
): string[] {
  if (commands === null || commands.length === 0) {
    return ["The agent has not advertised any commands for this thread."];
  }
  return commands.map((command) => {
    const hint = command.argumentHint ? ` <${command.argumentHint}>` : "";
    const description = command.description ? `  ${command.description}` : "";
    return `/${command.name}${hint}${description}`;
  });
}

export function formatThreadSessionOptions(
  options: readonly ThreadTimelineSessionOption[] | null,
): string[] {
  if (options === null || options.length === 0) {
    return ["The agent has not reported any session options for this thread."];
  }
  return options.flatMap((option) => {
    const pending =
      option.pendingValue === null
        ? ""
        : ` -> ${String(option.pendingValue)} on the next turn`;
    const heading = `${option.id} (${option.label}): ${String(option.value)}${pending}`;
    if (option.type === "boolean") {
      return [heading];
    }
    return [
      heading,
      ...option.values.map(
        (value) =>
          `  ${value.id === option.value ? "*" : " "} ${value.id}${
            value.label === value.id ? "" : `  ${value.label}`
          }`,
      ),
    ];
  });
}

export function registerSessionStateCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("commands [id]")
    .description("List the slash commands the thread's agent has advertised")
    .option("--self", "Use the current thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: SessionStateCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const timeline = await createCliBbSdk(getUrl()).threads.timeline({
            threadId,
            summaryOnly: "true",
          });
          const commands = timeline.providerCommands;
          if (outputJson(opts, { commands })) return;
          for (const line of formatThreadProviderCommands(commands)) {
            console.log(line);
          }
        },
      ),
    );

  parent
    .command("options [id]")
    .description(
      "List the session options the thread's agent reports, or choose values applied on the thread's next turn",
    )
    .option("--self", "Use the current thread")
    .option(
      "--set <option=value>",
      "Choose a value for an option, applied on the next turn (repeatable)",
      collectRepeated,
    )
    .option(
      "--clear <option>",
      "Drop a choice that has not been applied yet (repeatable)",
      collectRepeated,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: SessionOptionsCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const readOptions = async () =>
            (await sdk.threads.timeline({ threadId, summaryOnly: "true" }))
              .sessionOptions;
          let options = await readOptions();
          const set = opts.set ?? [];
          const clear = opts.clear ?? [];
          if (set.length > 0 || clear.length > 0) {
            await sdk.threads.update({
              threadId,
              sessionOptions: parseSessionOptionAssignments({
                options,
                set,
                clear,
              }),
            });
            options = await readOptions();
          }
          if (outputJson(opts, { options })) return;
          for (const line of formatThreadSessionOptions(options)) {
            console.log(line);
          }
        },
      ),
    );
}
