import type { ContractTagDeclarations } from "./internal/rpc-tags.js";

/** A JSON-safe path segment reported by a Standard Schema validation issue. */
export type PluginRpcIssuePathSegment = string | number;

/** Validator-neutral validation detail carried by an RPC error envelope. */
export interface PluginRpcValidationIssue {
  message: string;
  path?: PluginRpcIssuePathSegment[];
}

const rpcErrorCodes = [
  "forbidden",
  "not_found",
  "conflict",
  "invalid",
  "invalid_json",
  "invalid_input",
  "handler_error",
  "invalid_output",
  "non_json_result",
  "unknown_method",
  "transport_error",
  "invalid_response",
  "unknown_error",
] as const;

/** RPC categories may grow. Handle unknown_error as a fallback for newer server codes. */
export type PluginRpcErrorCode = (typeof rpcErrorCodes)[number];

const callErrorBrand = Symbol.for("@get-bb/plugin-sdk/rpc-call-error");

/** A client RPC failure. Unknown server codes become unknown_error and remain in serverCode. */
export class experimental_PluginRpcCallError extends Error {
  /** Recognizes errors across the packed SDK's separately bundled entries. */
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      Reflect.get(value, callErrorBrand) === true &&
      rpcErrorCodes.some((code) => code === Reflect.get(value, "code")) &&
      typeof Reflect.get(value, "message") === "string"
    );
  }
  readonly code: PluginRpcErrorCode;
  readonly issues?: PluginRpcValidationIssue[];
  readonly status?: number;
  readonly serverCode?: string;

  constructor(args: PluginRpcError & { status?: number; serverCode?: string }) {
    super(args.message);
    this.name = "experimental_PluginRpcCallError";
    Object.defineProperty(this, callErrorBrand, { value: true });
    this.code = args.code;
    this.issues = args.issues;
    this.status = args.status;
    this.serverCode = args.serverCode;
  }

  /** Normalize failures at the RPC boundary; preserves an existing client error. */
  static from(
    error: unknown,
    fallback: PluginRpcErrorCode = "transport_error",
  ): experimental_PluginRpcCallError {
    if (error instanceof experimental_PluginRpcCallError) return error;
    const record = typeof error === "object" && error !== null ? error : {};
    const rawCode = Reflect.get(record, "code");
    const code = rpcErrorCodes.find((value) => value === rawCode);
    const message = Reflect.get(record, "message");
    const status = Reflect.get(record, "status");
    const rawIssues = Reflect.get(record, "issues");
    const issues: PluginRpcValidationIssue[] = [];
    if (Array.isArray(rawIssues))
      for (const issue of rawIssues) {
        if (
          typeof issue !== "object" ||
          issue === null ||
          typeof Reflect.get(issue, "message") !== "string"
        )
          continue;
        const path = Reflect.get(issue, "path");
        if (
          path !== undefined &&
          (!Array.isArray(path) ||
            !path.every(
              (part) =>
                typeof part === "string" ||
                (typeof part === "number" && Number.isFinite(part)),
            ))
        )
          continue;
        issues.push({
          message: Reflect.get(issue, "message"),
          ...(path === undefined ? {} : { path }),
        });
      }
    return new experimental_PluginRpcCallError({
      code: code ?? (typeof rawCode === "string" ? "unknown_error" : fallback),
      message:
        typeof message === "string"
          ? message
          : typeof error === "string"
            ? error
            : "Plugin RPC request failed",
      ...(issues.length === 0 ? {} : { issues }),
      ...(typeof status === "number" ? { status } : {}),
      ...(typeof rawCode === "string" && code === undefined
        ? { serverCode: rawCode }
        : {}),
    });
  }
}

/** Structured RPC failure returned as `{ ok: false, error }`. */
export interface PluginRpcError {
  code: PluginRpcErrorCode;
  message: string;
  issues?: PluginRpcValidationIssue[];
}

const refusalBrand = Symbol.for("@get-bb/plugin-sdk/rpc-refusal");

/** Expected handler refusal; reaches callers without recording a plugin crash. */
export class experimental_PluginRpcRefusal extends Error {
  readonly [refusalBrand] = true;
  readonly code: "forbidden" | "not_found" | "conflict" | "invalid";
  readonly issues?: PluginRpcValidationIssue[];

  constructor(args: {
    code: experimental_PluginRpcRefusal["code"];
    message: string;
    issues?: PluginRpcValidationIssue[];
  }) {
    super(args.message);
    this.name = "experimental_PluginRpcRefusal";
    this.code = args.code;
    this.issues = args.issues;
  }
}

/**
 * The validator-neutral subset of Standard Schema v1 used by plugin contracts.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of BB's public protocol.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | StandardSchemaV1Result<Output>
      | Promise<StandardSchemaV1Result<Output>>;
    readonly jsonSchema?: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?:
    | PropertyKey
    | readonly (PropertyKey | { readonly key: PropertyKey })[];
}

export type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> =
  NonNullable<Schema["~standard"]["types"]>["input"];

export type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> =
  NonNullable<Schema["~standard"]["types"]>["output"];

export interface PluginRpcMethodContract<
  InputSchema extends StandardSchemaV1 = StandardSchemaV1,
  OutputSchema extends StandardSchemaV1 = StandardSchemaV1,
> extends Omit<
  ContractTagDeclarations<
    StandardSchemaV1InferOutput<InputSchema>,
    StandardSchemaV1InferOutput<OutputSchema>
  >,
  "invalidates"
> {
  readonly experimental_description?: string;
  /**
   * Host contracts only. When true and the daemon's response has not arrived
   * within half of the call's transport timeout, bb cancels the call and sends
   * it once more, the retry core uses for its own read-only daemon commands.
   * Declare it only for reads that are safe to run twice.
   */
  readonly experimental_retryable?: boolean;
  readonly input: InputSchema;
  readonly output: OutputSchema;
}

export type PluginRpcContract = Readonly<
  Record<string, PluginRpcMethodContract>
>;

/** Methods callable with only keys and returning one value per string key. */
export type ExperimentalRpcKeyedMethod<Contract extends PluginRpcContract> = {
  [Method in keyof Contract & string]: {
    keys: string[];
  } extends StandardSchemaV1InferInput<Contract[Method]["input"]>
    ? StandardSchemaV1InferOutput<Contract[Method]["input"]> extends {
        keys: string[];
      }
      ? string extends keyof PluginRpcResult<Contract[Method]>
        ? Method
        : never
      : never
    : never;
}[keyof Contract & string];

/** One keyed method's inferred row value. */
export type ExperimentalRpcKeyedValue<Method extends PluginRpcMethodContract> =
  PluginRpcResult<Method> extends Record<string, infer Value> ? Value : never;

type KeyedContractShape<
  Inputs extends Record<string, StandardSchemaV1>,
  Outputs extends Record<string, StandardSchemaV1>,
> = {
  readonly [Method in keyof Inputs]: StandardSchemaV1InferOutput<
    Inputs[Method]
  > extends { keys: string[] }
    ? string extends keyof StandardSchemaV1InferOutput<
        Outputs[Method & keyof Outputs]
      >
      ? unknown
      : { keyTags?: never }
    : { keyTags?: never };
};

type PluginRpcContractDefinition<
  Inputs extends Record<string, StandardSchemaV1>,
  Outputs extends Record<string, StandardSchemaV1>,
> = {
  readonly [Method in keyof Outputs]: { readonly output: Outputs[Method] };
} & {
  readonly [Method in keyof Inputs]: PluginRpcMethodContract<
    Inputs[Method],
    Outputs[Method & keyof Outputs]
  >;
} & NoInfer<KeyedContractShape<Inputs, Outputs>>;

/**
 * Define a shared RPC contract while preserving exact method/schema types.
 * `tags` and `keyTags` receive each method's parsed input and output types.
 * A method declaring keyTags must accept parsed keys: string[] and return a
 * string-indexed record. Writes do not declare what they change: the server
 * calls `bb.rpc.experimental_invalidate` where the data changes, so RPC, CLI,
 * agent-tool and background writes each refresh matching reads once.
 */
export function defineRpcContract<
  const Inputs extends Record<string, StandardSchemaV1>,
  const Outputs extends Record<string, StandardSchemaV1>,
>(
  contract: PluginRpcContractDefinition<Inputs, Outputs>,
): {
  readonly [Method in keyof Inputs]: PluginRpcMethodContract<
    Inputs[Method],
    Outputs[Method & keyof Outputs]
  >;
} & KeyedContractShape<Inputs, Outputs> {
  return contract;
}

/**
 * Who invoked an rpc method. `plugin` means another loaded plugin (or this
 * one) called through its own `bb.sdk.plugins.callRpc`; the host verifies
 * that with a per-load token only the server knows. Every other caller — the
 * app, the `bb` CLI, agents, and bb itself — is `client`.
 */
export type ExperimentalPluginRpcCaller =
  | { readonly kind: "plugin"; readonly pluginId: string }
  | { readonly kind: "client" };

/** Second argument of every rpc handler. */
export interface ExperimentalPluginRpcHandlerContext {
  readonly experimental_caller: ExperimentalPluginRpcCaller;
  /**
   * Aborts when the caller stops waiting (its HTTP request disconnects) or
   * when this plugin instance is reloaded, disabled or removed. A disposing
   * instance's callers still waiting when the dispose drain ends are
   * released with an error, so work finished after that reaches nobody.
   */
  readonly experimental_signal: AbortSignal;
}

export type PluginRpcHandlers<Contract extends PluginRpcContract> = {
  [Method in keyof Contract]: (
    input: StandardSchemaV1InferOutput<Contract[Method]["input"]>,
  ) =>
    | StandardSchemaV1InferInput<Contract[Method]["output"]>
    | Promise<StandardSchemaV1InferInput<Contract[Method]["output"]>>;
};

/**
 * Handlers as `bb.rpc.register` calls them: the validated input, then the
 * call's context. A `PluginRpcHandlers` map is assignable to this type, so
 * handlers that ignore the context keep their one-argument signature.
 */
export type ExperimentalPluginRpcHandlersWithContext<
  Contract extends PluginRpcContract,
> = {
  [Method in keyof Contract]: (
    input: StandardSchemaV1InferOutput<Contract[Method]["input"]>,
    context: ExperimentalPluginRpcHandlerContext,
  ) =>
    | StandardSchemaV1InferInput<Contract[Method]["output"]>
    | Promise<StandardSchemaV1InferInput<Contract[Method]["output"]>>;
};

type PluginRpcCallInput<Method extends PluginRpcMethodContract> =
  StandardSchemaV1InferInput<Method["input"]>;

export type PluginRpcCallArgs<Method extends PluginRpcMethodContract> =
  null extends PluginRpcCallInput<Method>
    ? [input?: PluginRpcCallInput<Method>]
    : [input: PluginRpcCallInput<Method>];

export type PluginRpcResult<Method extends PluginRpcMethodContract> =
  StandardSchemaV1InferOutput<Method["output"]>;
