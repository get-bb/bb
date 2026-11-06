export type OperationKind = "read" | "write";
export type HookPolicy = "observe" | "rewrite" | "answer" | "vote";
export type CallerDoor = "app" | "cli" | "agent" | "http" | "system";
export type CallerPrincipal = "owner" | "machine" | "system";

export interface OperationCaller {
  user: CallerPrincipal;
  door: CallerDoor;
  thread: string | null;
  via: readonly string[];
}

export type HttpDoorMethod = "get" | "post" | "patch" | "delete" | "put";

export interface HttpDoor {
  method: HttpDoorMethod;
  path: string;
  status: number;
  headers?: Readonly<Record<string, string>>;
}

export type CliDoorValueType =
  | "string"
  | "boolean"
  | "integer"
  | "number"
  | "strings";

export interface CliDoorPositional {
  name: string;
  field?: string;
  description?: string;
  required?: boolean;
  variadic?: boolean;
}

export interface CliDoorOption {
  flag: string;
  field?: string;
  type: CliDoorValueType;
  description: string;
  placeholder?: string;
  required?: boolean;
  short?: string;
  default?: string | number | boolean | readonly string[];
  hidden?: boolean;
  negatable?: boolean;
}

export type CliContextField = "threadId" | "projectId" | "cwd";

export interface CliDoorSelf {
  field: string;
  from: CliContextField;
  flag: string;
  description: string;
}

export type CliValue = string | number | boolean | string[] | undefined;

export interface CliDoorDeclined {
  message?: string;
  exitCode?: number;
  refusal?: string;
}

export type CliDoorPrinted = string | readonly string[] | null;

export interface CliValues {
  positionals: Readonly<Record<string, string | string[] | undefined>>;
  options: Readonly<Record<string, CliValue>>;
}

export interface CliDoor<Input = unknown, Output = unknown, Client = unknown> {
  path: readonly string[];
  summary: string;
  description?: string;
  aliases?: readonly string[];
  hidden?: boolean;
  isDefault?: boolean;
  usage?: string;
  helpAfter?: string;
  positionals?: readonly CliDoorPositional[];
  options?: readonly CliDoorOption[];
  self?: CliDoorSelf;
  fixed?: Readonly<Record<string, unknown>>;
  noJson?: boolean;
  json?(output: Output, input: Input): unknown;
  confirm?(input: Input): string | null;
  declined?(input: Input): CliDoorDeclined;
  interrupt?: string;
  prepare?(values: CliValues, client: Client): Input | Promise<Input>;
  run?(input: Input, client: Client): Output | Promise<Output>;
  print?(output: Output, input: Input): CliDoorPrinted;
  failure?(input: Input): string;
  exitCode?(output: Output, input: Input, json: boolean): number;
}

export interface OperationDoors<Input = unknown, Output = unknown> {
  http?: HttpDoor;
  cli?: CliDoor<Input, Output>;
}

export interface Operation<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly kind: OperationKind;
  readonly hooks: HookPolicy;
  readonly internal: boolean;
  readonly description: string | null;
  readonly doors: OperationDoors<Input, Output>;
  readonly serialized: boolean;
  parse(raw: unknown): Input | Promise<Input>;
  checkOutput?(output: unknown): string | null;
  checkVote?(vote: unknown): string | null;
  stopVoting?(vote: unknown): boolean;
  hookFailure?(plugin: string, detail: string): Error;
  finish?(output: unknown, input: Input): Output | Promise<Output>;
}

export interface OperationOptions<Input, Output> {
  name: string;
  kind?: OperationKind;
  hooks?: HookPolicy;
  internal?: boolean;
  description?: string;
  doors?: OperationDoors<Input, Output>;
  serialized?: boolean;
  parse(raw: unknown): Input | Promise<Input>;
  checkOutput?(output: unknown): string | null;
  checkVote?(vote: unknown): string | null;
  stopVoting?(vote: unknown): boolean;
  hookFailure?(plugin: string, detail: string): Error;
  finish?(output: unknown, input: Input): Output | Promise<Output>;
}

export function defineOperation<Input, Output>(
  options: OperationOptions<Input, Output>,
): Operation<Input, Output> {
  const {
    name,
    kind = "read",
    hooks = "rewrite",
    internal = false,
    description = null,
    doors = {},
    serialized = false,
    parse,
    checkOutput,
    checkVote,
    stopVoting,
    hookFailure,
    finish,
  } = options;
  return Object.freeze({
    name,
    kind,
    hooks,
    internal,
    description,
    doors,
    serialized,
    parse,
    ...(checkOutput === undefined ? {} : { checkOutput }),
    ...(checkVote === undefined ? {} : { checkVote }),
    ...(stopVoting === undefined ? {} : { stopVoting }),
    ...(hookFailure === undefined ? {} : { hookFailure }),
    ...(finish === undefined ? {} : { finish }),
  });
}
