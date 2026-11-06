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

export interface OperationDoors {
  http?: HttpDoor;
}

export interface Operation<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly kind: OperationKind;
  readonly hooks: HookPolicy;
  readonly internal: boolean;
  readonly description: string | null;
  readonly doors: OperationDoors;
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
  doors?: OperationDoors;
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
