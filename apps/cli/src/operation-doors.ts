import { Command, Option } from "commander";
import {
  publicOperationRouteDefinition,
  routeInputFields,
  type PublicOperationInput,
  type PublicOperationName,
  type PublicOperationOutput,
} from "@bb/server-contract";
import type { BbSdk } from "@bb/sdk";
import { CliExitError, action } from "./action.js";
import {
  commanderFlagName,
  flagValue,
  mapInput,
  mappedFields,
  mountedArgs,
  mountedFlags,
  type CliArgs,
  type CliDoorCommon,
  type CliDoorDeclined,
  type CliDoorPrinted,
  type CliFlags,
  type CliValues,
  type MountedArg,
  type MountedFlag,
} from "./cli-door.js";
import { createCliBbSdk } from "./client.js";
import { createOperationCaller } from "./operation-call.js";
import {
  askYesNo,
  collectOption,
  confirmDestructiveAction,
  outputJson,
  prependErrorContext,
  requireThreadIdOrSelf,
} from "./commands/helpers.js";
import {
  resolveContextProjectId,
  resolveContextThreadId,
  type ContextSnapshot,
} from "./context-env.js";

export interface CliClientDeps {
  getUrl(): string;
  getContext?(): ContextSnapshot;
}

export interface CliCallOptions {
  signal?: AbortSignal;
}

export interface CliClient {
  readonly url: string;
  readonly signal: AbortSignal;
  sdk(timeoutMs?: number): BbSdk;
  call<Name extends PublicOperationName>(
    name: Name,
    input: PublicOperationInput<Name>,
    options?: CliCallOptions,
  ): Promise<PublicOperationOutput<Name>>;
  confirm(question: string, declined?: CliDoorDeclined): Promise<void>;
  context(): ContextSnapshot;
  threadId(explicit: string | undefined, self: boolean): string;
  log(text: string): void;
}

export interface PublicDoor<
  Name extends PublicOperationName,
  Args extends CliArgs,
  Flags extends CliFlags,
> extends CliDoorCommon<
  Args,
  Flags,
  PublicOperationInput<Name>,
  PublicOperationOutput<Name>
> {
  fixed?: Readonly<Record<string, unknown>>;
  prepare?(
    values: CliValues<Args, Flags>,
    client: CliClient,
  ): PublicOperationInput<Name> | Promise<PublicOperationInput<Name>>;
  run?(
    input: PublicOperationInput<Name>,
    client: CliClient,
  ): PublicOperationOutput<Name> | Promise<PublicOperationOutput<Name>>;
}

export interface ClientDoor<
  Args extends CliArgs,
  Flags extends CliFlags,
  Output,
> extends CliDoorCommon<Args, Flags, CliValues<Args, Flags>, Output> {
  run(
    values: CliValues<Args, Flags>,
    client: CliClient,
  ): Output | Promise<Output>;
}

interface ErasedDoor extends CliDoorCommon<
  CliArgs,
  CliFlags,
  unknown,
  unknown
> {
  prepare(values: CliValues, client: CliClient): unknown;
  run?(input: unknown, client: CliClient): unknown;
}

export interface CliCommand {
  readonly operation: PublicOperationName | null;
  readonly door: ErasedDoor;
}

function erase(door: object): ErasedDoor {
  return door as ErasedDoor;
}

function defaultPrepare(
  name: PublicOperationName,
  door: ErasedDoor & { fixed?: Readonly<Record<string, unknown>> },
): ErasedDoor["prepare"] {
  const args = mountedArgs(door.positionals ?? {});
  const { flags } = mountedFlags(door.options ?? {}, {
    json: door.noJson !== true,
    confirm: door.confirm !== undefined,
  });
  const mapping = { fixed: door.fixed ?? {}, args, flags };
  const route = publicOperationRouteDefinition(name);
  const accepted = route === null ? new Set<string>() : routeInputFields(route);
  const unknown = mappedFields(mapping).filter((field) => !accepted.has(field));
  if (unknown.length > 0) {
    throw new Error(
      `bb ${door.path.join(" ")}: ${name} takes no ${unknown.join(", ")}; map it in prepare`,
    );
  }
  return (values, client) =>
    mapInput(mapping, values, (field, explicit, requested) => {
      if (field === "threadId") return client.threadId(explicit, requested);
      if (field === "projectId") {
        return explicit ?? client.context().projectId ?? "";
      }
      return explicit ?? process.cwd();
    });
}

export function publicCommand<
  Name extends PublicOperationName,
  const Args extends CliArgs = {},
  const Flags extends CliFlags = {},
>(name: Name, door: PublicDoor<Name, Args, Flags>): CliCommand {
  const erased = erase(door);
  return {
    operation: name,
    door: {
      ...erased,
      prepare:
        door.prepare === undefined
          ? defaultPrepare(name, erased)
          : erased.prepare,
    },
  };
}

export function clientCommand<
  const Args extends CliArgs = {},
  const Flags extends CliFlags = {},
  Output = null,
>(door: ClientDoor<Args, Flags, Output>): CliCommand {
  return {
    operation: null,
    door: { ...erase(door), prepare: (values) => values },
  };
}

class CliConfirmStop extends Error {
  constructor(
    readonly stdout: string | null,
    readonly stderr: string | null,
    readonly code: number,
  ) {
    super("Confirmation declined");
    this.name = "CliConfirmStop";
  }
}

interface Declined {
  message: string | null;
  exitCode: number;
  refusal: string | null;
}

interface CliClientControls {
  yes: boolean;
  interrupt: string | null;
  declined(override: CliDoorDeclined | undefined): Declined;
}

interface MountedClient {
  client: CliClient;
  interrupted(): boolean;
  release(): void;
}

async function confirmOrStop(
  question: string,
  declined: Declined,
): Promise<void> {
  if (declined.refusal !== null && !process.stdin.isTTY) {
    throw new CliConfirmStop(null, declined.refusal, 1);
  }
  const confirmed =
    declined.refusal === null
      ? await confirmDestructiveAction(question)
      : await askYesNo(question);
  if (!confirmed) {
    throw new CliConfirmStop(declined.message, null, declined.exitCode);
  }
}

function createClient(
  deps: CliClientDeps,
  controls: CliClientControls,
): MountedClient {
  const sdks = new Map<number | undefined, BbSdk>();
  const url = deps.getUrl();
  const sdk = (timeoutMs?: number) => {
    const known = sdks.get(timeoutMs);
    if (known !== undefined) return known;
    const created = createCliBbSdk(url, timeoutMs);
    sdks.set(timeoutMs, created);
    return created;
  };
  const operations = createOperationCaller(url);
  const controller = new AbortController();
  let armed = false;
  const abort = (): void => controller.abort();
  const client: CliClient = {
    url,
    get signal() {
      if (controls.interrupt !== null && !armed) {
        armed = true;
        process.once("SIGINT", abort);
      }
      return controller.signal;
    },
    sdk,
    async call(name, input, options = {}) {
      const result = await operations.call(name, input, options.signal);
      return result as PublicOperationOutput<typeof name>;
    },
    async confirm(question, declined) {
      if (controls.yes) return;
      await confirmOrStop(question, controls.declined(declined));
    },
    context() {
      if (deps.getContext !== undefined) return deps.getContext();
      const projectId = resolveContextProjectId();
      const threadId = resolveContextThreadId();
      return {
        serverUrl: url,
        ...(projectId === undefined ? {} : { projectId }),
        ...(threadId === undefined ? {} : { threadId }),
      };
    },
    threadId(explicit, self) {
      return requireThreadIdOrSelf(explicit, { self });
    },
    log(text) {
      console.log(text);
    },
  };
  return {
    client,
    interrupted: () => controller.signal.aborted,
    release() {
      if (armed) process.off("SIGINT", abort);
    },
  };
}

function printOutput(printed: CliDoorPrinted): void {
  if (printed === null) return;
  if (typeof printed === "string") {
    console.log(printed);
    return;
  }
  for (const line of printed) console.log(line);
}

function argumentSyntax(entry: MountedArg): string {
  const name = entry.variadic ? `${entry.name}...` : entry.name;
  return entry.required ? `<${name}>` : `[${name}]`;
}

function optionFlags(entry: MountedFlag): string {
  const long = entry.negatable ? `--no-${entry.flag}` : `--${entry.flag}`;
  const names = entry.short === undefined ? long : `-${entry.short}, ${long}`;
  if (entry.type === "boolean") return names;
  return `${names} <${entry.placeholder ?? entry.flag}>`;
}

function commanderOption(entry: MountedFlag): Option {
  const built = new Option(optionFlags(entry), entry.description);
  if (entry.type === "strings") {
    built.argParser((value: string, previous: string[] | undefined) =>
      collectOption(value, previous ?? []),
    );
  }
  if (entry.default !== undefined) built.default(entry.default);
  if (entry.required === true) built.makeOptionMandatory(true);
  if (entry.hidden === true) built.hideHelp();
  return built;
}

function commandPath(command: Command): string[] {
  const names: string[] = [];
  let cursor: Command | null = command;
  while (cursor?.parent) {
    names.unshift(cursor.name());
    cursor = cursor.parent;
  }
  return names;
}

function findOrCreateGroup(parent: Command, name: string): Command {
  const existing = parent.commands.find((command) => command.name() === name);
  return existing ?? parent.command(name);
}

export function mountCommand(
  parent: Command,
  command: CliCommand,
  deps: CliClientDeps,
): Command {
  const { door } = command;
  const args = mountedArgs(door.positionals ?? {});
  const { flags, hasJson, hasYes } = mountedFlags(door.options ?? {}, {
    json: door.noJson !== true,
    confirm: door.confirm !== undefined,
  });
  const parentPath = commandPath(parent);
  const relative = door.path.slice(parentPath.length);
  if (
    relative.length === 0 ||
    parentPath.some((word, index) => door.path[index] !== word)
  ) {
    throw new Error(
      `bb ${door.path.join(" ")} cannot be mounted under bb ${parentPath.join(" ")}`,
    );
  }
  let target = parent;
  for (const word of relative.slice(0, -1)) {
    target = findOrCreateGroup(target, word);
  }
  const mounted = target
    .command(relative.at(-1) ?? "", {
      ...(door.hidden === true ? { hidden: true } : {}),
      ...(door.isDefault === true ? { isDefault: true } : {}),
    })
    .description(door.description ?? door.summary);
  for (const entry of args) {
    mounted.argument(argumentSyntax(entry), entry.description ?? "");
  }
  if (door.usage !== undefined) mounted.usage(door.usage);
  if (door.aliases !== undefined && door.aliases.length > 0) {
    mounted.aliases([...door.aliases]);
  }
  for (const entry of flags) mounted.addOption(commanderOption(entry));
  if (door.helpAfter !== undefined) {
    mounted.addHelpText("after", door.helpAfter);
  }
  const interrupt = door.interrupt ?? null;
  mounted.action(
    action(async (...received: unknown[]) => {
      const raw = (received[args.length] ?? {}) as Record<string, unknown>;
      const values: CliValues = {
        positionals: Object.fromEntries(
          args.map((entry, index) => {
            const value = received[index];
            if (entry.variadic) {
              return [entry.key, Array.isArray(value) ? value : []];
            }
            return [entry.key, typeof value === "string" ? value : undefined];
          }),
        ),
        options: Object.fromEntries(
          flags.map((entry) => [
            entry.key,
            flagValue(entry, raw[commanderFlagName(entry)]),
          ]),
        ),
      };
      const json = hasJson && raw.json === true;
      let prepared: { input: unknown } | null = null;
      const mountedClient = createClient(deps, {
        yes: hasYes && raw.yes === true,
        interrupt,
        declined: (override) => {
          const declared =
            prepared === null ? {} : (door.declined?.(prepared.input) ?? {});
          return {
            message: override?.message ?? declared.message ?? null,
            exitCode: override?.exitCode ?? declared.exitCode ?? 0,
            refusal: override?.refusal ?? declared.refusal ?? null,
          };
        },
      });
      const { client } = mountedClient;
      let output: unknown;
      let input: unknown;
      try {
        input = await door.prepare(values, client);
        prepared = { input };
        const question = door.confirm?.(input) ?? null;
        if (question !== null) await client.confirm(question);
        try {
          if (door.run !== undefined) {
            output = await door.run(input, client);
          } else if (command.operation !== null) {
            output = await client.call(
              command.operation,
              input as PublicOperationInput<PublicOperationName>,
            );
          }
        } catch (error: unknown) {
          if (error instanceof CliConfirmStop) throw error;
          if (mountedClient.interrupted() && interrupt !== null) {
            throw new CliExitError(interrupt, 130);
          }
          const prefix = door.failure?.(input) ?? null;
          throw prefix === null ? error : prependErrorContext(prefix, error);
        }
      } catch (error: unknown) {
        if (!(error instanceof CliConfirmStop)) throw error;
        if (error.stderr !== null) console.error(error.stderr);
        if (error.stdout !== null) console.log(error.stdout);
        if (error.code !== 0) process.exitCode = error.code;
        return;
      } finally {
        mountedClient.release();
      }
      if (json) {
        outputJson(
          { json: true },
          door.json === undefined ? output : door.json(output, input),
        );
      } else {
        printOutput(
          door.print === undefined
            ? JSON.stringify(output, null, 2)
            : door.print(output, input),
        );
      }
      const code = door.exitCode?.(output, input, json) ?? 0;
      if (code !== 0) process.exitCode = code;
    }),
  );
  return mounted;
}

export function mountCommands(
  parent: Command,
  commands: readonly CliCommand[],
  deps: CliClientDeps,
): void {
  for (const command of commands) mountCommand(parent, command, deps);
}
