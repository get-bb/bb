import { Command, Option } from "commander";
import {
  cliCommandFromDoor,
  defineOperation,
  type CliDoor,
  type CliDoorDeclined,
  type CliDoorPrinted,
  type CliValues,
  type GeneratedCliDeclined,
  type GeneratedCliOption,
  type GeneratedCliPositional,
  type Operation,
  type OperationKind,
} from "@bb/operations";
import {
  publicOperation,
  type PublicOperationInput,
  type PublicOperationName,
  type PublicOperationOutput,
} from "@bb/server-contract";
import type { BbSdk } from "@bb/sdk";
import { CliExitError, action } from "./action.js";
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

export type CliDoorFor<Input, Output> = CliDoor<Input, Output, CliClient>;

export interface CliCommand {
  operation: Operation;
  door: CliDoor<unknown, unknown, CliClient>;
}

const registry = new Map<string, CliCommand>();

export function registeredCliCommands(): ReadonlyMap<string, CliCommand> {
  return registry;
}

function remember(command: CliCommand): CliCommand {
  registry.set(command.operation.name, command);
  return command;
}

export function publicCommand<Name extends PublicOperationName>(
  name: Name,
  door: CliDoorFor<PublicOperationInput<Name>, PublicOperationOutput<Name>>,
): CliCommand {
  return remember({
    operation: publicOperation(name),
    door: door as CliDoor<unknown, unknown, CliClient>,
  });
}

export interface ClientOperationOptions<Input, Output> {
  name: string;
  kind: OperationKind;
  description: string;
  door: CliDoorFor<Input, Output> & {
    run(input: Input, client: CliClient): Output | Promise<Output>;
  };
}

export function clientCommand<Input, Output>(
  options: ClientOperationOptions<Input, Output>,
): CliCommand {
  const operation = defineOperation<Input, Output>({
    name: options.name,
    kind: options.kind,
    hooks: "observe",
    description: options.description,
    parse: (raw) => raw as Input,
  });
  return remember({
    operation,
    door: options.door as CliDoor<unknown, unknown, CliClient>,
  });
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

interface CliClientControls {
  yes: boolean;
  interrupt: string | null;
  declined(override: CliDoorDeclined | undefined): GeneratedCliDeclined;
}

interface MountedClient {
  client: CliClient;
  interrupted(): boolean;
  release(): void;
}

async function confirmOrStop(
  question: string,
  declined: GeneratedCliDeclined,
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
      return {
        serverUrl: url,
        ...(resolveContextProjectId() === undefined
          ? {}
          : { projectId: resolveContextProjectId() }),
        ...(resolveContextThreadId() === undefined
          ? {}
          : { threadId: resolveContextThreadId() }),
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

function camelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function argumentSyntax(positional: GeneratedCliPositional): string {
  const name = positional.variadic ? `${positional.name}...` : positional.name;
  return positional.required ? `<${name}>` : `[${name}]`;
}

function optionFlags(option: GeneratedCliOption): string {
  const long = option.negatable ? `--no-${option.flag}` : `--${option.flag}`;
  const names = option.short === null ? long : `-${option.short}, ${long}`;
  if (option.type === "boolean") return names;
  const placeholder = option.placeholder ?? option.flag;
  return `${names} <${placeholder}>`;
}

function commanderOption(option: GeneratedCliOption): Option {
  const built = new Option(optionFlags(option), option.description);
  if (option.type === "strings") {
    built.argParser((value: string, previous: string[] | undefined) =>
      collectOption(value, previous ?? []),
    );
  }
  if (option.defaultValue !== null) built.default(option.defaultValue);
  if (option.required) built.makeOptionMandatory(true);
  if (option.hidden) built.hideHelp();
  return built;
}

function optionValue(
  option: GeneratedCliOption,
  value: CliValues["options"][string],
): CliValues["options"][string] {
  if (option.type === "strings" && value === undefined) return [];
  return value;
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
  const generated = cliCommandFromDoor<CliClient>(
    command.operation.name,
    command.door,
  );
  const parentPath = commandPath(parent);
  const relative = generated.path.slice(parentPath.length);
  if (
    relative.length === 0 ||
    parentPath.some((word, index) => generated.path[index] !== word)
  ) {
    throw new Error(
      `bb ${generated.path.join(" ")} cannot be mounted under bb ${parentPath.join(" ")}`,
    );
  }
  let target = parent;
  for (const word of relative.slice(0, -1)) {
    target = findOrCreateGroup(target, word);
  }
  const mounted = target
    .command(generated.path.at(-1) ?? "", {
      ...(generated.hidden ? { hidden: true } : {}),
      ...(generated.isDefault ? { isDefault: true } : {}),
    })
    .description(generated.description ?? generated.summary);
  for (const positional of generated.positionals) {
    mounted.argument(argumentSyntax(positional), positional.description ?? "");
  }
  if (generated.usage !== null) mounted.usage(generated.usage);
  if (generated.aliases.length > 0) mounted.aliases([...generated.aliases]);
  for (const option of generated.options) {
    mounted.addOption(commanderOption(option));
  }
  if (generated.helpAfter !== null) {
    mounted.addHelpText("after", generated.helpAfter);
  }
  mounted.action(
    action(async (...args: unknown[]) => {
      const values = args.slice(0, generated.positionals.length);
      const opts = (args[generated.positionals.length] ?? {}) as Record<
        string,
        CliValues["options"][string]
      >;
      const positionals = Object.fromEntries(
        generated.positionals.map((positional, index) => {
          const value = values[index];
          return [
            positional.name,
            typeof value === "string" || Array.isArray(value)
              ? (value as string | string[])
              : undefined,
          ];
        }),
      );
      const options = Object.fromEntries(
        generated.options.map((option) => [
          option.flag,
          optionValue(option, opts[camelCase(option.flag)]),
        ]),
      );
      const json = generated.hasJson && opts.json === true;
      let prepared: { input: unknown } | null = null;
      const mountedClient = createClient(deps, {
        yes: generated.hasYes && opts.yes === true,
        interrupt: generated.interrupt,
        declined: (override) => {
          const declared =
            prepared === null
              ? { message: null, exitCode: 0, refusal: null }
              : generated.declined(prepared.input);
          return {
            message: override?.message ?? declared.message,
            exitCode: override?.exitCode ?? declared.exitCode,
            refusal: override?.refusal ?? declared.refusal,
          };
        },
      });
      const { client } = mountedClient;
      let output: unknown;
      let input: unknown;
      try {
        input = await generated.toInput(
          {
            positionals,
            options,
            resolveContext(field, explicit, requested) {
              if (field === "threadId")
                return client.threadId(explicit, requested);
              if (field === "projectId") {
                return explicit ?? client.context().projectId ?? "";
              }
              return explicit ?? process.cwd();
            },
          },
          client,
        );
        prepared = { input };
        const question = generated.confirmMessage(input);
        if (question !== null) await client.confirm(question);
        try {
          output = await generated.execute(input, client, (request) =>
            client.call(
              command.operation.name as PublicOperationName,
              request as PublicOperationInput<PublicOperationName>,
            ),
          );
        } catch (error: unknown) {
          if (error instanceof CliConfirmStop) throw error;
          if (mountedClient.interrupted() && generated.interrupt !== null) {
            throw new CliExitError(generated.interrupt, 130);
          }
          const prefix = generated.failure(input);
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
        outputJson({ json: true }, generated.jsonValue(output, input));
      } else {
        printOutput(generated.print(output, input));
      }
      const code = generated.exitCode(output, input, json);
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
