// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

/**
 * The validator-neutral subset of Standard Schema v1 used by plugin RPC.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of BB's public protocol.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        };
    };
}
type StandardSchemaV1Result<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: readonly StandardSchemaV1Issue[];
};
interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: PropertyKey | readonly (PropertyKey | {
        readonly key: PropertyKey;
    })[];
}
type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
interface PluginRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly input: InputSchema;
    readonly output: OutputSchema;
}
type PluginRpcContract = Readonly<Record<string, PluginRpcMethodContract>>;

interface ExperimentalHostRpcContext {
    /** Aborted when this request is cancelled or its worker is disposed. */
    readonly signal: AbortSignal;
    /** Aborted once for the lifetime of this worker generation. */
    readonly lifecycle: {
        readonly signal: AbortSignal;
    };
}
type ExperimentalHostRpcHandlers<Contract extends PluginRpcContract> = {
    [MethodName in keyof Contract]: (input: StandardSchemaV1InferOutput<Contract[MethodName]["input"]>, context: ExperimentalHostRpcContext) => StandardSchemaV1InferInput<Contract[MethodName]["output"]> | Promise<StandardSchemaV1InferInput<Contract[MethodName]["output"]>>;
};
interface ExperimentalHostEntry<Contract extends PluginRpcContract = PluginRpcContract> {
    readonly experimental_apiVersion: 1;
    readonly contract: Contract;
    readonly handlers: ExperimentalHostRpcHandlers<Contract>;
    readonly dispose?: () => void | Promise<void>;
}
/** Define the single host executable exported by `bb.host`. */
declare function experimental_defineHostEntry<const Contract extends PluginRpcContract>(args: {
    contract: Contract;
    handlers: ExperimentalHostRpcHandlers<Contract>;
    dispose?: () => void | Promise<void>;
}): ExperimentalHostEntry<Contract>;

export { experimental_defineHostEntry };
export type { ExperimentalHostEntry, ExperimentalHostRpcContext, ExperimentalHostRpcHandlers };
