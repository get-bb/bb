import type {
  PluginRpcMethodContract,
  PluginRpcResult,
  StandardSchemaV1,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
} from "./rpc-contract.js";

export type ExperimentalHostScheduling = "shared" | "exclusive";

export type ExperimentalHostMethodTarget =
  | { readonly kind: "host" }
  | {
      readonly kind: "environment";
      readonly scheduling: ExperimentalHostScheduling;
    };

export interface ExperimentalHostRpcMethodContract<
  InputSchema extends StandardSchemaV1 = StandardSchemaV1,
  OutputSchema extends StandardSchemaV1 = StandardSchemaV1,
> extends PluginRpcMethodContract<InputSchema, OutputSchema> {
  readonly target: ExperimentalHostMethodTarget;
}

export interface ExperimentalHostSignalContract<
  PayloadSchema extends StandardSchemaV1 = StandardSchemaV1,
> {
  readonly target: "host" | "environment";
  readonly payload: PayloadSchema;
}

export interface ExperimentalHostRpcContract {
  readonly methods: Readonly<Record<string, ExperimentalHostRpcMethodContract>>;
  readonly signals?: Readonly<Record<string, ExperimentalHostSignalContract>>;
}

/**
 * Define the runtime contract shared by one plugin's server and host entries.
 * The schemas are retained at runtime so both sides validate the wire.
 */
export function experimental_defineHostRpcContract<
  const Contract extends ExperimentalHostRpcContract,
>(contract: Contract): Contract {
  return contract;
}

export type ExperimentalHostInvocationTarget<
  Method extends ExperimentalHostRpcMethodContract,
> = Method["target"]["kind"] extends "host"
  ? { readonly hostId: string }
  : { readonly environmentId: string };

export interface ExperimentalHostCallOptions<
  Method extends ExperimentalHostRpcMethodContract,
> {
  readonly target: ExperimentalHostInvocationTarget<Method>;
  readonly signal?: AbortSignal;
}

export interface ExperimentalHostClient<
  Contract extends ExperimentalHostRpcContract,
> {
  call<MethodName extends keyof Contract["methods"] & string>(
    method: MethodName,
    input: StandardSchemaV1InferInput<Contract["methods"][MethodName]["input"]>,
    options: ExperimentalHostCallOptions<Contract["methods"][MethodName]>,
  ): Promise<PluginRpcResult<Contract["methods"][MethodName]>>;
  /** Subscribe to validated, ephemeral invalidations from this host entry. */
  onSignal<SignalName extends keyof NonNullable<Contract["signals"]> & string>(
    signal: SignalName,
    handler: (
      event: ExperimentalHostSignalEvent<Contract, SignalName>,
    ) => void | Promise<void>,
  ): () => void;
}

export type ExperimentalHostResolvedTarget =
  | { readonly kind: "host"; readonly hostId: string }
  | {
      readonly kind: "environment";
      readonly hostId: string;
      readonly environmentId: string;
    };

export interface ExperimentalHostPaths {
  /** Persistent directory scoped to this plugin on this daemon. */
  readonly dataDir: string;
  /** Temporary directory scoped to this host-artifact generation. */
  readonly tempDir: string;
}

export type ExperimentalHostWatchChangeType = "create" | "update" | "delete";

export interface ExperimentalHostWatchChange {
  readonly path: string;
  readonly type: ExperimentalHostWatchChangeType;
}

export type ExperimentalHostWatchEvent =
  | {
      readonly kind: "changed";
      readonly changes: readonly ExperimentalHostWatchChange[];
    }
  | { readonly kind: "rescan-required" }
  | { readonly kind: "watch-error"; readonly message: string };

export interface ExperimentalHostWatchOptions {
  /** Absolute directory observed by the daemon's native watcher service. */
  readonly rootPath: string;
  /** Root-relative ignore entries using the native watcher syntax. */
  readonly ignoredPaths: readonly string[];
  /** Quiet period before one coalesced delivery. */
  readonly debounceMs: number;
  /** Maximum time changes may wait while events continue arriving. */
  readonly maxWaitMs: number;
}

export interface ExperimentalHostWatchSubscription {
  dispose(): Promise<void>;
}

export type ExperimentalHostWatchListener = (
  event: ExperimentalHostWatchEvent,
) => void | Promise<void>;

export interface ExperimentalHostRpcContext<
  Contract extends ExperimentalHostRpcContract,
> {
  readonly target: ExperimentalHostResolvedTarget;
  /** Resolved environment root, or null for a host-targeted method. */
  readonly cwd: string | null;
  /** Aborted when this request is cancelled or its worker is disposed. */
  readonly signal: AbortSignal;
  /** Aborted once for the lifetime of this worker generation. */
  readonly lifecycle: { readonly signal: AbortSignal };
  readonly paths: ExperimentalHostPaths;
  readonly signals: ExperimentalHostSignalPublisher<Contract>;
  /**
   * Observe raw filesystem changes through the daemon-owned native watcher.
   * Delivery is serialized and coalesced while the listener is busy. The
   * subscription is also disposed automatically with this host generation.
   */
  experimental_watch(
    options: ExperimentalHostWatchOptions,
    listener: ExperimentalHostWatchListener,
  ): Promise<ExperimentalHostWatchSubscription>;
}

type ExperimentalHostSignalName<Contract extends ExperimentalHostRpcContract> =
  keyof NonNullable<Contract["signals"]> & string;

export interface ExperimentalHostSignalEvent<
  Contract extends ExperimentalHostRpcContract,
  SignalName extends ExperimentalHostSignalName<Contract>,
> {
  readonly payload: StandardSchemaV1InferOutput<
    NonNullable<Contract["signals"]>[SignalName]["payload"]
  >;
  readonly target: ExperimentalHostResolvedTarget;
}

export interface ExperimentalHostSignalPublisher<
  Contract extends ExperimentalHostRpcContract,
> {
  publish<SignalName extends ExperimentalHostSignalName<Contract>>(
    signal: SignalName,
    payload: StandardSchemaV1InferInput<
      NonNullable<Contract["signals"]>[SignalName]["payload"]
    >,
  ): void;
}

export type ExperimentalHostRpcHandlers<
  Contract extends ExperimentalHostRpcContract,
> = {
  [MethodName in keyof Contract["methods"]]: (
    input: StandardSchemaV1InferOutput<
      Contract["methods"][MethodName]["input"]
    >,
    context: ExperimentalHostRpcContext<Contract>,
  ) =>
    | StandardSchemaV1InferInput<Contract["methods"][MethodName]["output"]>
    | Promise<
        StandardSchemaV1InferInput<Contract["methods"][MethodName]["output"]>
      >;
};

export interface ExperimentalHostEntry<
  Contract extends ExperimentalHostRpcContract = ExperimentalHostRpcContract,
> {
  readonly experimental_apiVersion: 1;
  readonly contract: Contract;
  readonly handlers: ExperimentalHostRpcHandlers<Contract>;
  readonly dispose?: () => void | Promise<void>;
}

/** Define the single host executable exported by `bb.host`. */
export function experimental_defineHostEntry<
  const Contract extends ExperimentalHostRpcContract,
>(args: {
  contract: Contract;
  handlers: ExperimentalHostRpcHandlers<Contract>;
  dispose?: () => void | Promise<void>;
}): ExperimentalHostEntry<Contract> {
  return {
    experimental_apiVersion: 1,
    contract: args.contract,
    handlers: args.handlers,
    ...(args.dispose === undefined ? {} : { dispose: args.dispose }),
  };
}
