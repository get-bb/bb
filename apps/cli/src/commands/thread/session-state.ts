import { flag } from "@bb/operations";
import type {
  ProviderCommand,
  PublicOperationOutput,
  ThreadTimelineResponse,
  ThreadTimelineSessionOption,
} from "@bb/server-contract";
import type { Command } from "commander";
import {
  clientCommand,
  mountCommands,
  publicCommand,
} from "../../operation-doors.js";

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

function fullTimeline(
  timeline: PublicOperationOutput<"threads.timeline">,
): ThreadTimelineResponse {
  if ("delta" in timeline) {
    throw new Error("The server answered a full timeline read with a delta.");
  }
  return timeline;
}

const SELF_THREAD = {
  field: "id",
  from: "threadId",
  flag: "self",
  description: "Use the current thread",
} as const;

export const threadCommandsCommand = publicCommand("threads.timeline", {
  path: ["thread", "commands"],
  summary: "List the slash commands the thread's agent has advertised",
  positionals: [{ name: "id", field: "id", required: false }],
  self: SELF_THREAD,
  fixed: { summaryOnly: "true" },
  json: (timeline) => ({
    commands: fullTimeline(timeline).providerCommands,
  }),
  print: (timeline) =>
    formatThreadProviderCommands(fullTimeline(timeline).providerCommands),
});

interface ThreadOptionsInput {
  threadId: string;
  set: string[];
  clear: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export const threadOptionsCommand = clientCommand<
  ThreadOptionsInput,
  readonly ThreadTimelineSessionOption[] | null
>({
  name: "cli.thread.options",
  kind: "write",
  description:
    "Read session options with threads.timeline, apply --set/--clear with threads.update, then read them again",
  door: {
    path: ["thread", "options"],
    summary:
      "List the session options the thread's agent reports, or choose values applied on the thread's next turn",
    positionals: [{ name: "id", required: false }],
    options: [
      flag("--self", "Use the current thread"),
      flag(
        "--set <option=value>",
        "Choose a value for an option, applied on the next turn (repeatable)",
        { type: "strings" },
      ),
      flag(
        "--clear <option>",
        "Drop a choice that has not been applied yet (repeatable)",
        { type: "strings" },
      ),
    ],
    prepare: ({ positionals, options }, client) => {
      const id = positionals.id;
      return {
        threadId: client.threadId(
          typeof id === "string" ? id : undefined,
          options.self === true,
        ),
        set: strings(options.set),
        clear: strings(options.clear),
      };
    },
    run: async ({ threadId, set, clear }, client) => {
      const readOptions = async () =>
        fullTimeline(
          await client.call("threads.timeline", {
            id: threadId,
            summaryOnly: "true",
          }),
        ).sessionOptions;
      let options = await readOptions();
      if (set.length > 0 || clear.length > 0) {
        await client.call("threads.update", {
          id: threadId,
          sessionOptions: parseSessionOptionAssignments({
            options,
            set,
            clear,
          }),
        });
        options = await readOptions();
      }
      return options;
    },
    json: (options) => ({ options }),
    print: (options) => formatThreadSessionOptions(options),
  },
});

export function registerSessionStateCommands(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommands(parent, [threadCommandsCommand, threadOptionsCommand], {
    getUrl,
  });
}
