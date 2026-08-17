import type {
  PluginRpcContract,
  PluginRpcResult,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
} from "./rpc-contract.js";

export interface ExperimentalHostCallOptions {
  readonly hostId: string;
  readonly signal?: AbortSignal;
}

export interface ExperimentalHostClient<Contract extends PluginRpcContract> {
  call<MethodName extends keyof Contract & string>(
    method: MethodName,
    input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>,
    options: ExperimentalHostCallOptions,
  ): Promise<PluginRpcResult<Contract[MethodName]>>;
  /**
   * Subscribe to unexpected exits of this plugin's worker on a host daemon.
   * Graceful reload, disable, uninstall, and daemon shutdown do not emit this
   * event. A later call starts a fresh worker.
   */
  experimental_onWorkerExit(
    handler: (event: { readonly hostId: string }) => void | Promise<void>,
  ): () => void;
}

export interface ExperimentalHostRpcContext {
  /** Aborted when this request is cancelled or its worker is disposed. */
  readonly signal: AbortSignal;
  /** Aborted once for the lifetime of this worker generation. */
  readonly lifecycle: { readonly signal: AbortSignal };
}

export type ExperimentalHostRpcHandlers<Contract extends PluginRpcContract> = {
  [MethodName in keyof Contract]: (
    input: StandardSchemaV1InferOutput<Contract[MethodName]["input"]>,
    context: ExperimentalHostRpcContext,
  ) =>
    | StandardSchemaV1InferInput<Contract[MethodName]["output"]>
    | Promise<
        StandardSchemaV1InferInput<Contract[MethodName]["output"]>
      >;
};

export interface ExperimentalHostEntry<
  Contract extends PluginRpcContract = PluginRpcContract,
> {
  readonly experimental_apiVersion: 1;
  readonly contract: Contract;
  readonly handlers: ExperimentalHostRpcHandlers<Contract>;
  readonly dispose?: () => void | Promise<void>;
}

/** Define the single host executable exported by `bb.host`. */
export function experimental_defineHostEntry<
  const Contract extends PluginRpcContract,
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
