// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { ExperimentalHostWatchOptions, ExperimentalHostWatchListener, ExperimentalHostWatchSubscription, PluginRpcContract, ExperimentalHostSignals, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, ExperimentalHostEntry } from '@get-bb/plugin-sdk';

type HostMethodName<Contract extends PluginRpcContract> = keyof Contract & string;
type HostSignalName<Signals extends ExperimentalHostSignals> = keyof Signals & string;
type ExperimentalHostHarnessSignal<Signals extends ExperimentalHostSignals> = {
    [SignalName in HostSignalName<Signals>]: {
        readonly signal: SignalName;
        readonly payload: StandardSchemaV1InferOutput<Signals[SignalName]["payload"]>;
    };
}[HostSignalName<Signals>];
interface ExperimentalCreateHostEntryHarnessOptions {
    readonly experimental_paths?: {
        readonly dataDir: string;
        readonly tempDir: string;
    };
    readonly experimental_watch?: (options: ExperimentalHostWatchOptions, listener: ExperimentalHostWatchListener) => ExperimentalHostWatchSubscription | Promise<ExperimentalHostWatchSubscription>;
}
interface ExperimentalHostEntryHarness<Contract extends PluginRpcContract, Signals extends ExperimentalHostSignals> {
    /** Invoke one handler through the same validation boundaries as the daemon. */
    experimental_call<MethodName extends HostMethodName<Contract>>(method: MethodName, input: StandardSchemaV1InferInput<Contract[MethodName]["input"]>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<StandardSchemaV1InferOutput<Contract[MethodName]["output"]>>;
    /** Validated signals emitted by handlers, in emission order. */
    experimental_getSignals(): readonly ExperimentalHostHarnessSignal<Signals>[];
    /** Number of worker-retention leases currently held by the entry. */
    experimental_getRetainedWorkerLeaseCount(): number;
    /** Aborted before the entry's dispose hook runs. */
    readonly experimental_lifecycleSignal: AbortSignal;
    /** Abort active calls and run the entry's dispose hook once. */
    experimental_dispose(): Promise<void>;
}
/**
 * Test one host entry in-process with the same validation, JSON transport,
 * cancellation, lifecycle, and output-size boundaries as the daemon worker.
 * Process crashes remain an integration concern for PluginHostManager tests.
 */
declare function experimental_createHostEntryHarness<Contract extends PluginRpcContract, Signals extends ExperimentalHostSignals>(entry: ExperimentalHostEntry<Contract, Signals>, harnessOptions?: ExperimentalCreateHostEntryHarnessOptions): ExperimentalHostEntryHarness<Contract, Signals>;

export { experimental_createHostEntryHarness };
export type { ExperimentalCreateHostEntryHarnessOptions, ExperimentalHostEntryHarness, ExperimentalHostHarnessSignal };
