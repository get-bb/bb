import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { ArcService } from "./arc-service.js";
import {
  arcBackendSchema,
  arcRpcContract,
  arcSizeSchema,
  RIFT_PROVIDER_ID,
  type ArcCreateInput,
  type ArcRouting,
} from "./arcs.js";

export const ARC_CLI_COMMANDS = [
  "connect",
  "list",
  "read",
  "create",
  "start",
  "pause",
  "stop",
  "destroy",
  "thread",
  "use",
] as const;

type ArcCliCommand = (typeof ARC_CLI_COMMANDS)[number];

const USAGE =
  "Usage: bb arc <connect|list|read|create|start|pause|stop|destroy|thread|use> [options] [--json]\n";
const ROUTING_OPTIONS = ["provider", "host", "environment"] as const;
const OPTIONS_BY_COMMAND = {
  connect: ROUTING_OPTIONS,
  list: ROUTING_OPTIONS,
  read: [...ROUTING_OPTIONS, "id"],
  create: [
    ...ROUTING_OPTIONS,
    "id",
    "backend",
    "remote-provider",
    "size",
    "thread",
    "project",
    "repository-url",
    "portals",
    "workspace-root",
    "name",
    "image",
  ],
  start: [...ROUTING_OPTIONS, "id"],
  pause: [...ROUTING_OPTIONS, "id"],
  stop: [...ROUTING_OPTIONS, "id"],
  destroy: [...ROUTING_OPTIONS, "id"],
  thread: [...ROUTING_OPTIONS, "id", "project", "prompt", "title"],
  use: [...ROUTING_OPTIONS, "id", "project", "prompt", "title"],
} satisfies Record<ArcCliCommand, readonly string[]>;
const COMMAND_USAGE = {
  connect:
    "bb arc connect [--provider=id] [--host=id|--environment=id] [--json]",
  list: "bb arc list [--provider=id] [--host=id|--environment=id] [--json]",
  read:
    "bb arc read --id=id [--provider=id] [--host=id|--environment=id] [--json]",
  create:
    "bb arc create [--id=id] [--backend=backend] [--remote-provider=id] [--size=size] [--thread=id] [--project=id] [--repository-url=url] [--portals=json] [--workspace-root=path] [--name=name] [--image=image] [--provider=id] [--host=id|--environment=id] [--json]",
  start:
    "bb arc start --id=id [--provider=id] [--host=id|--environment=id] [--json]",
  pause:
    "bb arc pause --id=id [--provider=id] [--host=id|--environment=id] [--json]",
  stop: "bb arc stop --id=id [--provider=id] [--host=id|--environment=id] [--json]",
  destroy:
    "bb arc destroy --id=id [--provider=id] [--host=id|--environment=id] [--json]",
  thread:
    "bb arc thread --id=id --project=id --prompt=text [--title=title] [--provider=id] [--host=id|--environment=id] [--json]",
  use: "bb arc use --id=id --project=id --prompt=text [--title=title] [--provider=id] [--host=id|--environment=id] [--json]",
} satisfies Record<ArcCliCommand, string>;
const UNSAFE_TERMINAL_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;

interface ArcCliInvocation {
  command: ArcCliCommand;
  options: ReadonlyMap<string, string>;
  json: boolean;
}

function isArcCliCommand(value: string | undefined): value is ArcCliCommand {
  return ARC_CLI_COMMANDS.some((command) => command === value);
}

export function parseArcCliInvocation(
  values: readonly string[],
): ArcCliInvocation | null {
  const options = new Map<string, string>();
  let command: string | undefined;
  let json = false;
  for (const value of values) {
    if (value === "--json") {
      if (json) throw new Error("duplicate flag --json");
      json = true;
      continue;
    }
    if (value.startsWith("--")) {
      const separator = value.indexOf("=");
      if (separator < 3 || separator === value.length - 1) {
        throw new Error(`invalid flag ${value}; use --name=value`);
      }
      const key = value.slice(2, separator);
      if (options.has(key)) throw new Error(`duplicate flag --${key}`);
      options.set(key, value.slice(separator + 1));
      continue;
    }
    if (command === undefined) command = value;
    else throw new Error(`unexpected argument ${value}`);
  }
  if (!isArcCliCommand(command)) return null;
  const allowed = new Set<string>(OPTIONS_BY_COMMAND[command]);
  for (const key of options.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`unknown flag --${key} for bb arc ${command}`);
    }
  }
  return { command, options, json };
}

function option(
  options: ReadonlyMap<string, string>,
  name: string,
): string | undefined {
  const value = options.get(name);
  if (value !== undefined && value.trim().length === 0) {
    throw new Error(`--${name}=value must not be blank`);
  }
  return value;
}

export function arcRouting(
  options: ReadonlyMap<string, string>,
  context: PluginCliContext,
): ArcRouting {
  const hostId = option(options, "host");
  const environmentId = option(options, "environment");
  if (hostId !== undefined && environmentId !== undefined) {
    throw new Error("--host and --environment are mutually exclusive");
  }
  return {
    providerId: option(options, "provider") ?? RIFT_PROVIDER_ID,
    ...(hostId === undefined ? {} : { hostId }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  };
}

function requireOption(
  options: ReadonlyMap<string, string>,
  name: string,
  fallback?: string,
): string {
  const value = option(options, name) ?? fallback;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name}=value is required`);
  }
  return value;
}

function parsePortals(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      '--portals must be a JSON array of {"name":"...","url":"https://..."} objects',
    );
  }
}

export function arcCreateInput(
  options: ReadonlyMap<string, string>,
  routing: ArcRouting,
): ArcCreateInput {
  const provider = option(options, "remote-provider");
  const arcId = option(options, "id");
  const threadId = option(options, "thread");
  const projectId = option(options, "project");
  const repositoryUrl = option(options, "repository-url");
  const portals = option(options, "portals");
  return arcRpcContract.create.input.parse({
    ...routing,
    backend: arcBackendSchema.parse(option(options, "backend") ?? "fly"),
    size: arcSizeSchema.parse(option(options, "size") ?? "a1.small"),
    workspaceRoot: option(options, "workspace-root") ?? "/work",
    displayName: option(options, "name") ?? "Arc",
    image: option(options, "image") ?? "",
    ...(arcId === undefined ? {} : { arcId }),
    ...(provider === undefined ? {} : { provider }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    ...(portals === undefined ? {} : { portals: parsePortals(portals) }),
  });
}

export function safeCliField(value: string): string {
  return value.replace(UNSAFE_TERMINAL_CHARACTER, "�");
}

export function safeCliJson(value: unknown, pretty: boolean): string {
  const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
  return (serialized ?? "null").replace(
    UNSAFE_TERMINAL_CHARACTER,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

export function registerArcCli(bb: BbPluginApi, service: ArcService): void {
  bb.cli.register({
    name: "arc",
    summary: "Manage Rift Arcs",
    commands: ARC_CLI_COMMANDS.map((name) => ({
      name,
      summary: `${name} an Arc`,
      usage: COMMAND_USAGE[name],
    })),
    async run(argv, context) {
      try {
        const parsed = parseArcCliInvocation(argv);
        if (parsed === null) return { exitCode: 2, stderr: USAGE };
        const input = arcRouting(parsed.options, context);
        if (parsed.command === "connect") {
          return output(await service.authorize(input), parsed.json);
        }
        if (parsed.command === "list") {
          const result = await service.list(input);
          const text = parsed.json
            ? safeCliJson(result, true)
            : result
                .map((arc) =>
                  [arc.arcId, arc.status, arc.displayName ?? ""]
                    .map(safeCliField)
                    .join("\t"),
                )
                .join("\n");
          return { exitCode: 0, stdout: `${text}\n` };
        }
        if (parsed.command === "create") {
          return output(
            await service.create(arcCreateInput(parsed.options, input)),
            parsed.json,
          );
        }
        const arcId = requireOption(parsed.options, "id");
        if (parsed.command === "read") {
          return output(await service.read({ ...input, arcId }), parsed.json);
        }
        if (
          parsed.command === "start" ||
          parsed.command === "pause" ||
          parsed.command === "stop"
        ) {
          return output(
            await service.lifecycle({
              ...input,
              arcId,
              action: parsed.command,
            }),
            parsed.json,
          );
        }
        if (parsed.command === "destroy") {
          return output(
            await service.destroy({ ...input, arcId }),
            parsed.json,
          );
        }
        const title = option(parsed.options, "title");
        return output(
          await service.spawnThread({
            ...input,
            arcId,
            projectId: requireOption(
              parsed.options,
              "project",
              context.projectId,
            ),
            prompt: requireOption(parsed.options, "prompt"),
            ...(title === undefined ? {} : { title }),
          }),
          parsed.json,
        );
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${safeCliField(error instanceof Error ? error.message : String(error))}\n`,
        };
      }
    },
  });
}

function output(value: unknown, json: boolean): PluginCliResult {
  if (
    !json &&
    typeof value === "object" &&
    value !== null &&
    "threadId" in value &&
    typeof value.threadId === "string"
  ) {
    return { exitCode: 0, stdout: `${safeCliField(value.threadId)}\n` };
  }
  return {
    exitCode: 0,
    stdout: `${safeCliJson(value, json)}\n`,
  };
}
