import type {
  CliContextField,
  CliDoor,
  CliDoorOption,
  CliDoorPrinted,
  CliDoorValueType,
  CliValue,
  CliValues,
  Operation,
} from "./contract.js";

export const JSON_FLAG_DESCRIPTION = "Print machine-readable JSON output";
export const YES_FLAG_DESCRIPTION = "Skip the confirmation prompt";

export interface GeneratedCliPositional {
  name: string;
  description: string | null;
  required: boolean;
  variadic: boolean;
}

export interface GeneratedCliOption {
  flag: string;
  short: string | null;
  type: CliDoorValueType;
  description: string;
  placeholder: string | null;
  required: boolean;
  defaultValue: string | number | boolean | readonly string[] | null;
  hidden: boolean;
  negatable: boolean;
}

export interface GeneratedCliDeclined {
  message: string | null;
  exitCode: number;
  refusal: string | null;
}

export type CliOptionValue = CliValue;

export interface CliInvocation extends CliValues {
  resolveContext(
    field: CliContextField,
    explicit: string | undefined,
    requested: boolean,
  ): string;
}

export interface GeneratedCliCommand<Client = unknown> {
  operation: string;
  path: readonly string[];
  summary: string;
  description: string | null;
  aliases: readonly string[];
  hidden: boolean;
  isDefault: boolean;
  usage: string | null;
  helpAfter: string | null;
  interrupt: string | null;
  positionals: GeneratedCliPositional[];
  options: GeneratedCliOption[];
  hasJson: boolean;
  hasYes: boolean;
  toInput(invocation: CliInvocation, client: Client): Promise<unknown>;
  confirmMessage(input: unknown): string | null;
  declined(input: unknown): GeneratedCliDeclined;
  execute(
    input: unknown,
    client: Client,
    dispatch: (input: unknown) => Promise<unknown>,
  ): Promise<unknown>;
  jsonValue(output: unknown, input: unknown): unknown;
  print(output: unknown, input: unknown): CliDoorPrinted;
  render(output: unknown, input: unknown, json: boolean): string | null;
  failure(input: unknown): string | null;
  exitCode(output: unknown, input: unknown, json: boolean): number;
}

export class CliDoorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliDoorUsageError";
  }
}

export type CliFlagExtras = Partial<
  Pick<CliDoorOption, "field" | "required" | "default" | "hidden">
> & { type?: Exclude<CliDoorValueType, "boolean"> };

const FLAG_SPEC =
  /^(?:-(?<short>[A-Za-z]), )?--(?<negated>no-)?(?<flag>[a-z][a-z0-9-]*)(?: <(?<placeholder>[^>]+)>)?$/;

export function flag(
  spec: string,
  description: string,
  extras: CliFlagExtras = {},
): CliDoorOption {
  const match = FLAG_SPEC.exec(spec)?.groups;
  if (match?.flag === undefined) {
    throw new Error(`Unrecognized flag syntax: ${spec}`);
  }
  const { type, ...rest } = extras;
  const negatable = match.negated !== undefined;
  const placeholder = match.placeholder;
  if (placeholder === undefined && type !== undefined) {
    throw new Error(
      `--${match.flag} takes a value, so its syntax needs <value>`,
    );
  }
  return {
    flag: match.flag,
    type: placeholder === undefined ? "boolean" : (type ?? "string"),
    description,
    ...(placeholder === undefined || placeholder === match.flag
      ? {}
      : { placeholder }),
    ...(match.short === undefined ? {} : { short: match.short }),
    ...(negatable ? { negatable: true } : {}),
    ...rest,
  };
}

function assign(
  target: Record<string, unknown>,
  field: string,
  value: unknown,
) {
  const keys = field.split(".");
  const last = keys.pop();
  if (last === undefined) return;
  let cursor = target;
  for (const key of keys) {
    const existing = cursor[key];
    if (typeof existing === "object" && existing !== null) {
      cursor = existing as Record<string, unknown>;
      continue;
    }
    const created: Record<string, unknown> = {};
    cursor[key] = created;
    cursor = created;
  }
  cursor[last] = value;
}

function clone(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return structuredClone({ ...value });
}

function convert(
  flag: string,
  type: CliDoorValueType,
  value: CliOptionValue,
): unknown {
  if (value === undefined) return undefined;
  if (type === "boolean") return value === true;
  if (type === "strings") {
    if (Array.isArray(value)) return value;
    return typeof value === "string" ? [value] : undefined;
  }
  if (typeof value === "number") {
    return type === "string" ? String(value) : value;
  }
  if (typeof value !== "string") return undefined;
  if (type === "string") return value;
  const parsed = Number(value);
  if (type === "number") {
    if (!Number.isFinite(parsed)) {
      throw new CliDoorUsageError(`--${flag} must be a number`);
    }
    return parsed;
  }
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliDoorUsageError(`--${flag} must be a positive integer`);
  }
  return parsed;
}

function mapValues(door: CliDoor, invocation: CliInvocation): unknown {
  const input = clone(door.fixed ?? {});
  for (const positional of door.positionals ?? []) {
    if (positional.field === undefined) continue;
    if (door.self?.field === positional.field) continue;
    const value = invocation.positionals[positional.name];
    if (value !== undefined) assign(input, positional.field, value);
  }
  for (const option of door.options ?? []) {
    if (option.field === undefined) continue;
    const value = convert(
      option.flag,
      option.type,
      invocation.options[option.flag],
    );
    if (value !== undefined) assign(input, option.field, value);
  }
  if (door.self !== undefined) {
    const self = door.self;
    const named = (door.positionals ?? []).find(
      (positional) => positional.field === self.field,
    );
    const given =
      named === undefined ? undefined : invocation.positionals[named.name];
    const explicit = typeof given === "string" ? given : undefined;
    const requested = invocation.options[self.flag] === true;
    assign(
      input,
      self.field,
      invocation.resolveContext(self.from, explicit, requested),
    );
  }
  return input;
}

function booleanOption(flag: string, description: string): GeneratedCliOption {
  return {
    flag,
    short: null,
    type: "boolean",
    description,
    placeholder: null,
    required: false,
    defaultValue: null,
    hidden: false,
    negatable: false,
  };
}

function generatedOption(
  option: CliDoorOption,
  reserved: boolean,
): GeneratedCliOption {
  if (reserved && option.type !== "boolean") {
    throw new Error(`--${option.flag} must be declared as a boolean flag`);
  }
  return {
    flag: option.flag,
    short: option.short ?? null,
    type: option.type,
    description: option.description,
    placeholder: option.placeholder ?? null,
    required: option.required ?? false,
    defaultValue: option.default ?? null,
    hidden: option.hidden ?? false,
    negatable: option.negatable ?? false,
  };
}

function joinPrinted(printed: CliDoorPrinted): string | null {
  if (printed === null || typeof printed === "string") return printed;
  return printed.join("\n");
}

export function cliCommandFromDoor<Client>(
  operation: string,
  door: CliDoor<unknown, unknown, Client>,
): GeneratedCliCommand<Client> {
  const positionals = (door.positionals ?? []).map((positional) => ({
    name: positional.name,
    description: positional.description ?? null,
    required: positional.required ?? true,
    variadic: positional.variadic ?? false,
  }));
  const hasJson = door.noJson !== true;
  const declared = door.options ?? [];
  const declaredYes = declared.find((option) => option.flag === "yes");
  const hasYes = door.confirm !== undefined || declaredYes !== undefined;
  const options: GeneratedCliOption[] = declared.map((option) =>
    generatedOption(
      option,
      option.flag === "yes" || (hasJson && option.flag === "json"),
    ),
  );
  if (door.self !== undefined) {
    options.unshift(booleanOption(door.self.flag, door.self.description));
  }
  if (hasYes && declaredYes === undefined) {
    options.push(booleanOption("yes", YES_FLAG_DESCRIPTION));
  }
  if (hasJson && !declared.some((option) => option.flag === "json")) {
    options.push(booleanOption("json", JSON_FLAG_DESCRIPTION));
  }
  const jsonValue = (output: unknown, input: unknown) =>
    door.json === undefined ? output : door.json(output, input);
  const print = (output: unknown, input: unknown): CliDoorPrinted =>
    door.print === undefined
      ? JSON.stringify(output, null, 2)
      : door.print(output, input);
  return {
    operation,
    path: door.path,
    summary: door.summary,
    description: door.description ?? null,
    aliases: door.aliases ?? [],
    hidden: door.hidden ?? false,
    isDefault: door.isDefault ?? false,
    usage: door.usage ?? null,
    helpAfter: door.helpAfter ?? null,
    interrupt: door.interrupt ?? null,
    positionals,
    options,
    hasJson,
    hasYes,
    async toInput(invocation, client) {
      if (door.prepare !== undefined) {
        return door.prepare(invocation, client);
      }
      return mapValues(door, invocation);
    },
    confirmMessage(input) {
      return door.confirm === undefined ? null : door.confirm(input);
    },
    declined(input) {
      const declined = door.declined?.(input) ?? {};
      return {
        message: declined.message ?? null,
        exitCode: declined.exitCode ?? 0,
        refusal: declined.refusal ?? null,
      };
    },
    async execute(input, client, dispatch) {
      if (door.run !== undefined) return door.run(input, client);
      return dispatch(input);
    },
    jsonValue,
    print,
    render(output, input, json) {
      if (json) return JSON.stringify(jsonValue(output, input), null, 2);
      return joinPrinted(print(output, input));
    },
    failure(input) {
      return door.failure === undefined ? null : door.failure(input);
    },
    exitCode(output, input, json) {
      return door.exitCode === undefined
        ? 0
        : door.exitCode(output, input, json);
    },
  };
}

export function cliCommandFromOperation(
  operation: Operation,
): GeneratedCliCommand | null {
  const door = operation.doors.cli;
  if (door === undefined) return null;
  return cliCommandFromDoor(operation.name, door);
}

export function cliCommandsFromOperations(
  operations: readonly Operation[],
): GeneratedCliCommand[] {
  const commands: GeneratedCliCommand[] = [];
  for (const operation of operations) {
    const command = cliCommandFromOperation(operation);
    if (command !== null) commands.push(command);
  }
  return commands;
}
