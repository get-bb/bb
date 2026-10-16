/** A JSON-safe path segment reported by a Standard Schema validation issue. */
export type PluginRpcIssuePathSegment = string | number;

/** Validator-neutral validation detail carried by an RPC error envelope. */
export interface PluginRpcValidationIssue {
  message: string;
  path?: PluginRpcIssuePathSegment[];
}

/** Stable wire error categories for plugin RPC. */
export type PluginRpcErrorCode =
  | "invalid_json"
  | "invalid_input"
  | "handler_error"
  | "invalid_output"
  | "non_json_result"
  | "unknown_method";

/** Structured RPC failure returned as `{ ok: false, error }`. */
export interface PluginRpcError {
  code: PluginRpcErrorCode;
  message: string;
  issues?: PluginRpcValidationIssue[];
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
> {
  readonly experimental_description?: string;
  /** Requires a core-owned browser request authority; ordinary RPC ingress is refused. */
  readonly experimental_requestAuthority?: boolean;
  readonly input: InputSchema;
  readonly output: OutputSchema;
}

export type PluginRpcContract = Readonly<
  Record<string, PluginRpcMethodContract>
>;

/** Define a shared RPC contract while preserving exact method/schema types. */
export function defineRpcContract<const Contract extends PluginRpcContract>(
  contract: Contract,
): Contract {
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

/** An opaque request capability whose authority comes only from the core registry. */
export interface ExperimentalRequestAuthority {
  readonly __experimentalRequestAuthority: unique symbol;
}

/** A different opaque reference bound to the exact core invocation. */
export interface ExperimentalRequestInvocation {
  readonly __experimentalRequestInvocation: unique symbol;
}

/** Verified browser identity for this invocation, without a login credential or read grant. */
export interface ExperimentalReaderRequestIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly serverId: string;
  readonly pluginId: string;
  readonly rpcMethod: string;
  readonly requestId: string;
  readonly bodySha256: string;
  /** Original deadline in the core monotonic clock domain, never a new budget. */
  readonly deadlineMs: number;
  /** Rechecks finite validity; it does not promise instant logout or atomic delivery. */
  isCurrent(): boolean;
}

/** Second argument of every rpc handler. */
export interface ExperimentalPluginRpcHandlerContext {
  readonly experimental_caller: ExperimentalPluginRpcCaller;
  /** Present only on the private authenticated reader path. Copies are not authority. */
  readonly experimental_requestAuthority?: ExperimentalRequestAuthority;
  /** Core-owned invocation witness paired with the request authority. */
  readonly experimental_invocation?: ExperimentalRequestInvocation;
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
