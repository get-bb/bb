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

type ExperimentalHostScheduling = "shared" | "exclusive";
type ExperimentalHostMethodTarget = {
    readonly kind: "host";
} | {
    readonly kind: "environment";
    readonly scheduling: ExperimentalHostScheduling;
};
interface ExperimentalHostRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> extends PluginRpcMethodContract<InputSchema, OutputSchema> {
    readonly target: ExperimentalHostMethodTarget;
}
interface ExperimentalHostSignalContract<PayloadSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly target: "host" | "environment";
    readonly payload: PayloadSchema;
}
interface ExperimentalHostRpcContract {
    readonly methods: Readonly<Record<string, ExperimentalHostRpcMethodContract>>;
    readonly signals?: Readonly<Record<string, ExperimentalHostSignalContract>>;
}
type ExperimentalHostResolvedTarget = {
    readonly kind: "host";
    readonly hostId: string;
} | {
    readonly kind: "environment";
    readonly hostId: string;
    readonly environmentId: string;
};
interface ExperimentalHostPaths {
    /** Persistent directory scoped to this plugin on this daemon. */
    readonly dataDir: string;
    /** Temporary directory scoped to this host-artifact generation. */
    readonly tempDir: string;
}
type ExperimentalHostWatchChangeType = "create" | "update" | "delete";
interface ExperimentalHostWatchChange {
    readonly path: string;
    readonly type: ExperimentalHostWatchChangeType;
}
type ExperimentalHostWatchEvent = {
    readonly kind: "changed";
    readonly changes: readonly ExperimentalHostWatchChange[];
} | {
    readonly kind: "rescan-required";
} | {
    readonly kind: "watch-error";
    readonly message: string;
};
interface ExperimentalHostWatchOptions {
    /** Absolute directory observed by the daemon's native watcher service. */
    readonly rootPath: string;
    /** Root-relative ignore entries using the native watcher syntax. */
    readonly ignoredPaths: readonly string[];
    /** Quiet period before one coalesced delivery. */
    readonly debounceMs: number;
    /** Maximum time changes may wait while events continue arriving. */
    readonly maxWaitMs: number;
}
interface ExperimentalHostWatchSubscription {
    dispose(): Promise<void>;
}
type ExperimentalHostWatchListener = (event: ExperimentalHostWatchEvent) => void | Promise<void>;
interface ExperimentalHostRpcContext<Contract extends ExperimentalHostRpcContract> {
    readonly target: ExperimentalHostResolvedTarget;
    /** Resolved environment root, or null for a host-targeted method. */
    readonly cwd: string | null;
    /** Aborted when this request is cancelled or its worker is disposed. */
    readonly signal: AbortSignal;
    /** Aborted once for the lifetime of this worker generation. */
    readonly lifecycle: {
        readonly signal: AbortSignal;
    };
    readonly paths: ExperimentalHostPaths;
    readonly signals: ExperimentalHostSignalPublisher<Contract>;
    /**
     * Observe raw filesystem changes through the daemon-owned native watcher.
     * Delivery is serialized and coalesced while the listener is busy. The
     * subscription is also disposed automatically with this host generation.
     */
    experimental_watch(options: ExperimentalHostWatchOptions, listener: ExperimentalHostWatchListener): Promise<ExperimentalHostWatchSubscription>;
}
type ExperimentalHostSignalName<Contract extends ExperimentalHostRpcContract> = keyof NonNullable<Contract["signals"]> & string;
interface ExperimentalHostSignalPublisher<Contract extends ExperimentalHostRpcContract> {
    publish<SignalName extends ExperimentalHostSignalName<Contract>>(signal: SignalName, payload: StandardSchemaV1InferInput<NonNullable<Contract["signals"]>[SignalName]["payload"]>): void;
}
type ExperimentalHostRpcHandlers<Contract extends ExperimentalHostRpcContract> = {
    [MethodName in keyof Contract["methods"]]: (input: StandardSchemaV1InferOutput<Contract["methods"][MethodName]["input"]>, context: ExperimentalHostRpcContext<Contract>) => StandardSchemaV1InferInput<Contract["methods"][MethodName]["output"]> | Promise<StandardSchemaV1InferInput<Contract["methods"][MethodName]["output"]>>;
};
interface ExperimentalHostEntry<Contract extends ExperimentalHostRpcContract = ExperimentalHostRpcContract> {
    readonly experimental_apiVersion: 1;
    readonly contract: Contract;
    readonly handlers: ExperimentalHostRpcHandlers<Contract>;
    readonly dispose?: () => void | Promise<void>;
}
/** Define the single host executable exported by `bb.host`. */
declare function experimental_defineHostEntry<const Contract extends ExperimentalHostRpcContract>(args: {
    contract: Contract;
    handlers: ExperimentalHostRpcHandlers<Contract>;
    dispose?: () => void | Promise<void>;
}): ExperimentalHostEntry<Contract>;

export { experimental_defineHostEntry };
export type { ExperimentalHostEntry, ExperimentalHostPaths, ExperimentalHostResolvedTarget, ExperimentalHostRpcContext, ExperimentalHostRpcHandlers, ExperimentalHostSignalPublisher, ExperimentalHostWatchChange, ExperimentalHostWatchChangeType, ExperimentalHostWatchEvent, ExperimentalHostWatchListener, ExperimentalHostWatchOptions, ExperimentalHostWatchSubscription };
